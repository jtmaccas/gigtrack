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
  "shift_date": <string or null>,       // shift date in ISO format YYYY-MM-DD if visible; null if not shown or shows "Today"/relative
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
- "week_start"/"week_end": read the week date-range header (e.g. "20 Jul - 26 Jul")
  and convert BOTH ends to ISO YYYY-MM-DD using the YEAR rule below. Watch month
  boundaries when the range spans two months (e.g. "28 Dec - 4 Jan").
- "days": include a day ONLY if the screenshot shows that day had activity —
  a non-zero bar, or a listed dash/entry for that date. Skip days with no bar /
  no activity (a driver's day off is not a day to catch up).
  * DOORDASH: the weekly view usually LISTS each dash with its date and dollar
    amount. For each date shown, SUM all that date's amounts into ONE day entry
    and put the total in "earned". (e.g. two dashes on Mar 26 of 11.97 + 19.58 →
    { "date": "2026-03-26", "earned": 31.55 }.)
  * UBER EATS: the weekly bar chart does NOT print per-day dollar amounts — only
    bar heights. So for UE, list each day that has a (non-zero) bar with
    "earned": null. Derive each day's date from the bar's day-number + the week
    range (same month-boundary logic as week_start/week_end). Do NOT invent
    dollar amounts from bar heights — "earned" is null for every UE day.
- "week_totals": extract the week aggregate figures shown (total earned, total
  trips/deliveries, total online/active time). Leave any not shown as null.
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
  * YEAR (applies to ALL dates — single shift_date AND weekly week_start/week_end/days): UE/DoorDash screens rarely show a year, so infer it from TODAY'S DATE (given below). Rule: the shift happened in the MOST RECENT occurrence of that month/day on or before today — a shift screenshot is always in the past, never the future. Reason like this: "Today is 2026-06-15. The screenshot shows 11 January. When did 11 January most recently occur on or before today? January 2026 already passed this year, so it's 2026-01-11. But if the screenshot showed 11 September, September 2026 hasn't happened yet this year, so the most recent September was 2025 → 2025-09-11." So: if the month/day is LATER in the year than today, use LAST year; if it's EARLIER than or equal to today, use THIS year. Never return a future date. If genuinely unsure, still return your best YYYY-MM-DD rather than null.
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
        system: SYSTEM_PROMPT + `\n\nTODAY'S DATE is ${new Date().toISOString().slice(0,10)} (YYYY-MM-DD). Use this as the anchor for the YEAR rule above.`,
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
