// supabase/functions/parse-shift-screenshot/index.ts
//
// Receives a base64 screenshot from an authenticated user and returns
// structured shift data parsed by Claude Sonnet 4.5 vision.
//
// Auth: requires a valid Supabase JWT in the Authorization header.
// Cost: ~$0.01-0.02 per call (Claude vision pricing).

import { createClient } from "https://esm.sh/@supabase/supabase-js@2";

const ANTHROPIC_API_KEY = Deno.env.get("ANTHROPIC_API_KEY");
const SUPABASE_URL      = Deno.env.get("SUPABASE_URL");
const SUPABASE_ANON_KEY = Deno.env.get("SUPABASE_ANON_KEY");

const corsHeaders = {
  "Access-Control-Allow-Origin": "*",
  "Access-Control-Allow-Headers": "authorization, x-client-info, apikey, content-type",
  "Access-Control-Allow-Methods": "POST, OPTIONS",
};

// Today's date anchored to AUSTRALIAN time, not the server's UTC. GigTrack is
// AU-only, and the YEAR rule below resolves a bare month/day (e.g. "1 Aug") to
// its most-recent past occurrence — so the anchor must be the driver's local
// "today". A UTC anchor is up to a day behind for a UTC+10 user in the evening,
// which would mis-resolve a shift dated today/yesterday near the boundary. We
// use Australia/Brisbane: it's UTC+10 year-round (no DST), the safest single
// anchor for an all-AU app (southern states are +10/+11, never behind Brisbane).
function auTodayISO(): string {
  // en-CA formats as YYYY-MM-DD, which is already the shape we want.
  return new Intl.DateTimeFormat("en-CA", {
    timeZone: "Australia/Brisbane",
    year: "numeric", month: "2-digit", day: "2-digit",
  }).format(new Date());
}

// Snap a "YYYY-MM-DD" date to the most-recent occurrence of its month/day on or
// before AU-today. The model supplies month/day (it read them off the image);
// we OWN the year. If the input's month/day, placed in today's year, lands after
// today, it must belong to last year (a shift is never in the future). Returns
// the corrected ISO string, or the original if it can't be parsed.
function snapYearToPast(iso: string): string {
  if (typeof iso !== "string") return iso;
  const m = /^(\d{4})-(\d{2})-(\d{2})$/.exec(iso.trim());
  if (!m) return iso;
  const mm = m[2], dd = m[3];
  const today = auTodayISO();               // YYYY-MM-DD in Brisbane
  const [ty, tm, td] = today.split("-");
  const thisYear = Number(ty);
  // Compare month/day as a zero-padded MMDD string — no Date object, no TZ risk.
  const year = (mm + dd) > (tm + td) ? thisYear - 1 : thisYear;
  return `${year}-${mm}-${dd}`;
}

// Parse "YYYY-MM-DD" → { y, mm, dd, mmdd } or null.
function ymd(iso: string): { y: number; mm: string; dd: string; mmdd: string } | null {
  if (typeof iso !== "string") return null;
  const m = /^(\d{4})-(\d{2})-(\d{2})$/.exec(iso.trim());
  return m ? { y: Number(m[1]), mm: m[2], dd: m[3], mmdd: m[2] + m[3] } : null;
}

// Given an ALREADY-corrected anchor (the week's start) and another date in the
// same week, derive that date's year so the week stays contiguous. A weekly is a
// 7-day block, so a later date either shares the anchor's year, or — if its
// month/day is SMALLER than the anchor's (the block crossed 1 Jan) — is the
// anchor's year + 1. This prevents a New-Year week from being split across two
// years (the bug of snapping each date independently against today).
function yearRelativeTo(anchorIso: string, iso: string): string {
  const a = ymd(anchorIso);
  const b = ymd(iso);
  if (!a || !b) return iso;
  const year = b.mmdd < a.mmdd ? a.y + 1 : a.y;
  return `${year}-${b.mm}-${b.dd}`;
}

// Apply year correction to every date field a parsed result can carry.
// Single-shift: snap the one date independently. Weekly: snap week_start to the
// past, then derive week_end and each day RELATIVE to it so the block never
// splits across a year boundary. Mutates in place.
function correctYears(parsed: any): void {
  if (!parsed || typeof parsed !== "object") return;

  // Single shift — one standalone date, no range to preserve.
  if (typeof parsed.shift_date === "string") {
    parsed.shift_date = snapYearToPast(parsed.shift_date);
  }

  // Weekly — anchor on week_start (earliest, unambiguously past), derive rest.
  if (typeof parsed.week_start === "string") {
    const anchor = snapYearToPast(parsed.week_start);
    parsed.week_start = anchor;
    if (typeof parsed.week_end === "string") {
      parsed.week_end = yearRelativeTo(anchor, parsed.week_end);
    }
    if (Array.isArray(parsed.days)) {
      for (const d of parsed.days) {
        if (d && typeof d.date === "string") d.date = yearRelativeTo(anchor, d.date);
      }
    }
  } else {
    // No week_start (shouldn't happen for a weekly, but be safe): fall back to
    // independent snapping so dates are at least individually plausible.
    if (typeof parsed.week_end === "string") parsed.week_end = snapYearToPast(parsed.week_end);
    if (Array.isArray(parsed.days)) {
      for (const d of parsed.days) {
        if (d && typeof d.date === "string") d.date = snapYearToPast(d.date);
      }
    }
  }
}

// The prompt that tells Claude what to extract.
// Strict JSON output, with null for missing fields so the app can show "Not found".
//
// TWO MODES. The screenshot is EITHER a single-shift summary OR a whole-week
// summary. First CLASSIFY which, then return the matching shape. The "type"
// field is the discriminator the app branches on. Single-shift behaviour is
// unchanged from before (same fields) — weekly is the added mode.
const SYSTEM_PROMPT = `You are a data extraction assistant for a gig delivery driver app.

The user uploads a screenshot from Uber Eats or DoorDash. It is ONE of:
  (A) a SINGLE-SHIFT summary — one session/day's earnings, OR
  (B) a WEEKLY summary — a whole week at once, typically a bar chart of 7 days
      with a week total, and NO single day selected/highlighted.

STEP 1 — CLASSIFY. Decide if this is a single shift or a whole week.
  * WEEKLY signals: a week date-range header (e.g. "5 Jan - 12 Jan"); a row of
    ~7 bars, none darker/selected than the others; a total labelled as a week/
    "This week"; a per-day list covering multiple dates.
  * SINGLE signals: exactly ONE day's figures; on a UE bar chart, ONE bar is
    DARK/SOLID blue (selected) and the totals refer to that selected day; a
    DoorDash single-dash summary.
  * If a UE weekly screen has ONE dark-blue selected bar, that is a SINGLE shift
    for the selected day (existing behaviour) — NOT a weekly. A weekly is when
    NO single day is selected and the figures are week aggregates.

STEP 2 — EXTRACT the matching shape.

Do not guess. Do not infer. Only return what is clearly shown. Return null for
anything not clearly visible. Return ONLY the JSON object — no markdown, no
commentary.

────────────────────────────────────────────────────────────────────────────
SHAPE A — SINGLE SHIFT (use when type is "single"):

{
  "type": "single",
  "total_earned": <number or null>,    // total dollars earned this shift
  "tips": <number or null>,             // tips dollar amount (if shown separately)
  "bonuses": <number or null>,          // promotions/quests/bonuses (if shown separately)
  "deliveries": <integer or null>,     // count of deliveries completed
  "online_minutes": <integer or null>,  // total online time in minutes
  "active_minutes": <integer or null>,  // active delivery time in minutes (often labeled "active time")
  "distance_km": <number or null>,      // total distance in kilometers (online distance / driving total)
  "active_km": <number or null>,        // active delivery distance in km (when shown — usually only on UE)
  "platform": <"uber_eats" | "doordash" | "both" | null>,
  "shift_date": <string or null>,       // shift date in ISO format YYYY-MM-DD (apply the YEAR rule below); null only if no date is visible at all
  "start_time": <string or null>        // shift START time in 24-hour HH:MM if clearly shown; null if not visible
}

────────────────────────────────────────────────────────────────────────────
SHAPE B — WEEKLY SUMMARY (use when type is "weekly"):

{
  "type": "weekly",
  "platform": <"uber_eats" | "doordash" | "both" | null>,
  "week_start": <string or null>,   // ISO YYYY-MM-DD, first day of the week range
  "week_end": <string or null>,     // ISO YYYY-MM-DD, last day of the week range
  "days": [                          // ONE entry per day that has ANY activity that week
    { "date": <string YYYY-MM-DD>, "earned": <number or null> }
  ],
  "week_totals": {
    "earned": <number or null>,       // week total dollars
    "deliveries": <integer or null>,  // week total deliveries/trips (DoorDash: deliveries; UE: trips)
    "online_hrs": <string or null>,   // week online time as shown, e.g. "44h39m"
    "active_hrs": <string or null>    // week active time as shown, e.g. "43h22m"
  }
}

WEEKLY EXTRACTION RULES (read carefully — the two platforms differ):
- "week_start"/"week_end": read the week date-range header (e.g. "20 July - 27 July",
  "24 Mar - 30 Mar") and convert BOTH ends to ISO YYYY-MM-DD using the YEAR rule
  below. Watch month boundaries when the range spans two months (e.g.
  "28 Dec - 4 Jan"). NOTE: the header range is the CALENDAR week; the actual days
  WITH ACTIVITY (in "days") may be fewer — e.g. a "20 July - 27 July" header with
  bars only on 20-26. That's expected; the header sets week_start/week_end, the
  bars/list set which days go in "days".
- Currency: strip ALL currency symbols and letters — "$", "A$", "AU$", "AUD" —
  and return plain numbers (e.g. "A$19.58" → 19.58, "$1,902.02" → 1902.02).
- "days": include a day ONLY if the screenshot shows that day had activity —
  a non-zero bar, or a listed dash/entry for that date. Skip days with no bar /
  no activity (a driver's day off is not a day to catch up).
  * DOORDASH: the weekly view LISTS each dash separately, by weekday+date, with
    its own dollar amount (e.g. "Wednesday, Mar 26  A$11.97"). The SAME DATE can
    appear on MULTIPLE rows (two dashes that day). SUM all rows sharing a date
    into ONE "days" entry with the total in "earned" (e.g. Mar 26: 11.97 + 19.58
    → { "date": "2026-03-26", "earned": 31.55 }; Mar 28: 23.33 + 12.44 → 35.77).
    IMPORTANT: extract ONLY the dash rows actually VISIBLE in the screenshot. The
    list may be scrolled/cut off — do NOT invent rows to make the day totals
    reach the week total, and do NOT assume how many dashes a day had beyond what
    is shown. Put the week total in week_totals.earned regardless.
  * UBER EATS: the weekly bar chart does NOT print per-day dollar amounts — only
    bar heights, above a day number + weekday (e.g. "20 Mon", "25 Sat"). So for
    UE, list each day that has a (non-zero) bar with "earned": null. Derive each
    day's date from the bar's day-number + the week range (same month-boundary
    logic as week_start/week_end). Do NOT invent dollar amounts from bar heights
    — "earned" is null for every UE day.
- "week_totals": extract the week aggregate figures shown. Map by platform:
  * UE "Stats": Online → online_hrs, Active → active_hrs, Trips → deliveries,
    and the big top total → earned. (Ignore "Points".)
  * DoorDash: "Dash time" → online_hrs, "Active time" → active_hrs,
    "Completed deliveries" → deliveries, the big top total → earned.
  Leave any not shown as null.
- Order "days" chronologically (earliest date first).

Field-specific notes (SHAPE A — single shift — unless noted otherwise):
- SCOPE CONSISTENCY (important): in a single-shift extraction, all numeric fields must describe the SAME period. On a UE screen with ONE dark-blue SELECTED bar, the big total, Stats (Online/Active/Trips) and Breakdown (Net fare/Promotions) all refer to that SELECTED DAY — extract those day figures, paired with that day's "shift_date". (If NO day is selected and the figures are week aggregates, that's SHAPE B weekly, not this.) Never mix a single day's date with week-aggregate numbers.
- All currency values: numbers only, no $ signs (e.g. 55.20 not "$55.20")
- "online_minutes" and "active_minutes": convert hours/minutes formats to total minutes (e.g. "1h 25m" → 85)
- "distance_km" is total/online distance; "active_km" is just the active delivery distance. UE sometimes shows both.
- "platform": "uber_eats" for Uber Eats branding, "doordash" for DoorDash red/branding. Use null if unclear.
- "shift_date": the date of the SELECTED day, in ISO format YYYY-MM-DD.
  * DOORDASH: usually shows a clear date label — extract it (e.g. "Jun 8" → "2026-06-08"). If it only says "Today"/"Yesterday" or shows no date, return null.
  * UBER EATS (important — read carefully): UE earnings screens often show a WEEK at a time with a bar chart, and do NOT print the selected date as plain text. You must DERIVE it:
    1. Read the week range at the TOP CENTRE of the screen (e.g. "5 Jan - 12 Jan", "28 Dec - 4 Jan"). This gives you the month(s) and the span of days.
    2. Look at the BAR CHART below it. Each bar sits above a day number (5, 6, 7...) with a weekday letter/name (Mon, Tue...).
    3. Find the SELECTED bar: it is DARK/SOLID BLUE. Unselected bars are LIGHT/PALE BLUE or grey. There is normally exactly one dark-blue selected bar.
    4. Take the day NUMBER directly under that dark-blue bar.
    5. Combine that day number with the correct month from the week range. WATCH MONTH BOUNDARIES: if the week range spans two months (e.g. "28 Dec - 4 Jan") then low day numbers (1-4) belong to the LATER month (Jan) and high numbers (28-31) to the EARLIER month (Dec). For "5 Jan - 12 Jan" all days are January.
    6. Example: week "5 Jan - 12 Jan", dark-blue bar is above "11" (Sun) → 11 January → "2026-01-11".
    * If NO bar is dark-blue/selected, or you cannot confidently identify the selected day, return null. Do not guess a day.
  * YEAR (applies to ALL dates — single shift_date AND weekly week_start/week_end/days): UE/DoorDash screens rarely show a year, so infer it from the actual "TODAY'S DATE" value provided at the VERY END of this prompt. IGNORE any example dates written in these instructions — they are illustrations only; the single source of truth for "today" is the TODAY'S DATE line below. Rule: a shift screenshot is always in the PAST, never the future, so each date is the MOST RECENT occurrence of that month/day on or before today. Procedure: (1) take the date's month/day; (2) first try THIS year (the year from TODAY'S DATE); (3) if that produces a date AFTER today, subtract one year; otherwise keep this year. Equivalent shortcut: if the month/day falls LATER in the calendar year than today's month/day, use LAST year; if it's EARLIER THAN OR EQUAL to today's month/day, use THIS year. Worked logic (do this with the REAL today, not any example): "today's month/day is M/D; the screenshot shows month/day X. Is X after M/D? If yes → last year. If no → this year." Never return a future date. If genuinely unsure, still return your best YYYY-MM-DD rather than null.
- "start_time" (single only): the time the shift/dash STARTED, in 24-hour HH:MM (e.g. "5:30 PM" → "17:30", "9:05 AM" → "09:05"). DoorDash often shows a dash start time or a time range like "5:30 PM - 9:45 PM" — use the FIRST/start time. If only an end time or no time is shown, return null. Do not guess.
- If the screenshot is NOT a gig delivery shift/earnings summary at all, return {"type":"single"} with all other fields null.

Return ONLY the JSON object. No explanation. No markdown fences.`;

Deno.serve(async (req) => {
  // CORS preflight
  if (req.method === "OPTIONS") {
    return new Response("ok", { headers: corsHeaders });
  }

  if (req.method !== "POST") {
    return new Response("Method not allowed", { status: 405, headers: corsHeaders });
  }

  try {
    // 1. Verify auth
    const authHeader = req.headers.get("Authorization");
    if (!authHeader) {
      return jsonResponse({ error: "Missing Authorization header" }, 401);
    }

    const supabase = createClient(SUPABASE_URL!, SUPABASE_ANON_KEY!, {
      global: { headers: { Authorization: authHeader } },
    });
    const { data: { user }, error: authError } = await supabase.auth.getUser();
    if (authError || !user) {
      return jsonResponse({ error: "Unauthorized" }, 401);
    }

    // 2. Parse request body — expect { image_base64, image_media_type }
    const body = await req.json();
    const { image_base64, image_media_type } = body;
    if (!image_base64 || !image_media_type) {
      return jsonResponse({ error: "Missing image_base64 or image_media_type" }, 400);
    }
    const validTypes = ["image/jpeg", "image/png", "image/webp", "image/gif"];
    if (!validTypes.includes(image_media_type)) {
      return jsonResponse({ error: `Unsupported image type: ${image_media_type}` }, 400);
    }

    // 3. Call Claude vision API
    const anthropicResponse = await fetch("https://api.anthropic.com/v1/messages", {
      method: "POST",
      headers: {
        "Content-Type": "application/json",
        "x-api-key": ANTHROPIC_API_KEY!,
        "anthropic-version": "2023-06-01",
      },
      body: JSON.stringify({
        model: "claude-sonnet-4-5",
        max_tokens: 1024,
        system: SYSTEM_PROMPT + `\n\nTODAY'S DATE is ${auTodayISO()} (YYYY-MM-DD). Use this as the anchor for the YEAR rule above.`,
        messages: [{
          role: "user",
          content: [
            {
              type: "image",
              source: {
                type: "base64",
                media_type: image_media_type,
                data: image_base64,
              },
            },
            {
              type: "text",
              text: "Extract the shift data from this screenshot. Return only JSON.",
            },
          ],
        }],
      }),
    });

    if (!anthropicResponse.ok) {
      const errorText = await anthropicResponse.text();
      console.error("Anthropic API error:", anthropicResponse.status, errorText);
      return jsonResponse(
        { error: "AI parsing failed", details: errorText },
        500,
      );
    }

    const aiData = await anthropicResponse.json();
    const rawText = aiData.content?.[0]?.text || "";

    // 4. Parse Claude's JSON response. Strip any markdown fences just in case.
    const cleanedText = rawText
      .replace(/^```json\s*/i, "")
      .replace(/^```\s*/i, "")
      .replace(/```\s*$/i, "")
      .trim();

    let parsed;
    try {
      parsed = JSON.parse(cleanedText);
    } catch (e) {
      console.error("Failed to parse Claude response as JSON:", cleanedText);
      return jsonResponse(
        { error: "AI returned invalid format", raw: cleanedText },
        500,
      );
    }

    // 4b. YEAR CORRECTION (deterministic — do NOT trust the model for this).
    // The model must READ the month/day (needs vision), but the YEAR is pure
    // arithmetic: a shift is always in the past, so each date snaps to the most
    // recent occurrence of its month/day on or before AU-today. We recompute the
    // year in code for every date field, overriding whatever year the model
    // guessed. This makes the "2025 vs 2026" class of bug impossible regardless
    // of prompt adherence.
    correctYears(parsed);

    // 5. Return the structured fields + metadata
    return jsonResponse({
      ok: true,
      parsed,
      usage: {
        input_tokens: aiData.usage?.input_tokens,
        output_tokens: aiData.usage?.output_tokens,
      },
    });

  } catch (e) {
    console.error("Edge function error:", e);
    return jsonResponse({ error: "Internal error", details: String(e) }, 500);
  }
});

function jsonResponse(body: unknown, status = 200) {
  return new Response(JSON.stringify(body), {
    status,
    headers: { ...corsHeaders, "Content-Type": "application/json" },
  });
}
