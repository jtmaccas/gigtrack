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
  "shift_date": <string or null>        // shift date in ISO format YYYY-MM-DD if visible; null if not shown or shows "Today"/relative
}

Field-specific notes:
- All currency values: numbers only, no $ signs (e.g. 55.20 not "$55.20")
- "online_minutes" and "active_minutes": convert hours/minutes formats to total minutes (e.g. "1h 25m" → 85)
- "distance_km" is total/online distance; "active_km" is just the active delivery distance. UE sometimes shows both.
- "platform": "uber_eats" for Uber Eats branding, "doordash" for DoorDash red/branding. Use null if unclear.
- "shift_date": only extract if a clear date is shown (e.g. "Jun 8" → "2026-06-08"). If it says "Today" or "Yesterday" or no date is visible, return null.
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
