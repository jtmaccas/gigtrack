// src/screenshotImport.js
// Handles the screenshot → base64 → Edge Function pipeline.

import { supabase } from "./supabase.js";

const FUNCTION_URL = `${import.meta.env.VITE_SUPABASE_URL}/functions/v1/parse-shift-screenshot`;

// Reads a File/Blob and returns { base64, mediaType }
export function fileToBase64(file) {
  return new Promise((resolve, reject) => {
    const reader = new FileReader();
    reader.onload = () => {
      // reader.result is "data:image/png;base64,XXXX"
      const result = reader.result;
      const match = /^data:([^;]+);base64,(.+)$/.exec(result);
      if (!match) {
        reject(new Error("Could not read file"));
        return;
      }
      resolve({ mediaType: match[1], base64: match[2] });
    };
    reader.onerror = () => reject(reader.error || new Error("Read failed"));
    reader.readAsDataURL(file);
  });
}

// Calls the parse-shift-screenshot Edge Function with the user's auth token.
// Returns { ok: true, parsed: {...} } or { ok: false, error: "..." }.
export async function parseShiftScreenshot(file) {
  console.log("[GigTrack] parseShiftScreenshot: starting for", file.name);
  try {
    // 1. Get auth token from current session
    const { data: { session }, error: sessionError } = await supabase.auth.getSession();
    if (sessionError || !session) {
      return { ok: false, error: "Not signed in" };
    }

    // 2. Convert file to base64
    const { base64, mediaType } = await fileToBase64(file);
    console.log("[GigTrack] parseShiftScreenshot: file encoded, size", base64.length, "chars");

    // 3. POST to Edge Function
    const response = await fetch(FUNCTION_URL, {
      method: "POST",
      headers: {
        "Content-Type": "application/json",
        "Authorization": `Bearer ${session.access_token}`,
      },
      body: JSON.stringify({
        image_base64: base64,
        image_media_type: mediaType,
      }),
    });

    if (!response.ok) {
      const errText = await response.text();
      console.error("[GigTrack] parseShiftScreenshot HTTP error:", response.status, errText);
      return { ok: false, error: `Server returned ${response.status}`, details: errText };
    }

    const data = await response.json();

    if (data.error) {
      console.error("[GigTrack] parseShiftScreenshot returned error:", data.error);
      return { ok: false, error: data.error };
    }

    console.log("[GigTrack] parseShiftScreenshot OK:", data.parsed);
    return { ok: true, parsed: data.parsed, usage: data.usage };

  } catch (e) {
    console.error("[GigTrack] parseShiftScreenshot threw:", e);
    return { ok: false, error: e.message || "Unknown error" };
  }
}

// Maps the parsed Edge Function response to the localStorage prefill format
// expected by NewTripScreen (via gt_voice_prefill key).
export function parsedToPrefill(parsed) {
  if (!parsed) return {};
  const prefill = {};
  if (parsed.total_earned != null)    prefill.earned   = parsed.total_earned;
  if (parsed.tips != null)            prefill.tips     = parsed.tips;
  if (parsed.bonuses != null)         prefill.bonus    = parsed.bonuses;
  if (parsed.deliveries != null)      prefill.dels     = parsed.deliveries;
  if (parsed.online_minutes != null)  prefill.mins     = parsed.online_minutes;
  // active_minutes maps to its own field — NewTripScreen reads activeMins via timer prefill path,
  // but we'll fold it into mins for now; user can adjust on the form.
  if (parsed.distance_km != null)     prefill.km       = parsed.distance_km;
  if (parsed.platform != null)        prefill.platform = parsed.platform;
  return prefill;
}
