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
const SYSTEM_PROMPT = `You are a data extraction assistant for a gig delivery driver app.

The user uploads a screenshot of a shift-summary screen from Uber Eats or DoorDash
(the screen shown to drivers at the end of a session, summarizing earnings).

Extract the following fields. If a field is not visible or unclear, return null.
Do not guess. Do not infer. Only return what is clearly shown.

Required output format — strict JSON, no markdown, no commentary:

{
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

Field-specific notes:
- SCOPE CONSISTENCY (important): all numeric fields must describe the SAME period. On UE weekly screens a single day is usually selected (one dark-blue bar) and the big total, Stats (Online/Active/Trips) and Breakdown (Net fare/Promotions) shown all refer to that SELECTED DAY — extract those day figures, paired with that day's "shift_date". If instead the screen is clearly showing a whole-week total with NO single day selected, that is a week summary: still extract the totals, but return "shift_date": null (a week total can't be pinned to one day). Never mix a single day's date with week-aggregate numbers.
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
  * YEAR: UE/DoorDash rarely show a year. Infer the most plausible recent year for the date (a date that would be in the future is almost certainly the previous year). If genuinely unsure of the year, still return your best YYYY-MM-DD rather than null.
- "start_time": the time the shift/dash STARTED, in 24-hour HH:MM (e.g. "5:30 PM" → "17:30", "9:05 AM" → "09:05"). DoorDash often shows a dash start time or a time range like "5:30 PM - 9:45 PM" — use the FIRST/start time. If only an end time or no time is shown, return null. Do not guess.
- If the screenshot is NOT a gig delivery shift summary, return all fields as null.

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
        system: SYSTEM_PROMPT,
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
