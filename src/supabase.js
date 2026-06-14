import { createClient } from "@supabase/supabase-js";

const supabaseUrl     = import.meta.env.VITE_SUPABASE_URL;
const supabaseAnonKey = import.meta.env.VITE_SUPABASE_ANON_KEY;

if (!supabaseUrl || !supabaseAnonKey) {
  console.warn(
    "[GigTrack] Supabase env vars missing. Cloud sync will be disabled.\n" +
    "Set VITE_SUPABASE_URL and VITE_SUPABASE_ANON_KEY in your .env file."
  );
}

export const supabase = createClient(supabaseUrl || "", supabaseAnonKey || "", {
  auth: {
    autoRefreshToken: true,
    persistSession: true,
    detectSessionInUrl: true,
    storageKey: "gt_supabase_auth",
  },
});

// Quick helper to get the current user (or null)
export const getCurrentUser = async () => {
  const { data: { user } } = await supabase.auth.getUser();
  return user;
};

// Sign in anonymously (DEPRECATED — kept as no-op for backward compat).
// The app now requires real sign-in via magic link.
export const signInAnonymouslyIfNeeded = async () => {
  const { data: { user } } = await supabase.auth.getUser();
  return user; // null if not signed in — caller routes to welcome screen
};

// Send a magic link to the given email.
// New users get created automatically (shouldCreateUser: true).
export const sendMagicLink = async (email) => {
  const redirectTo = window.location.origin;
  const { error } = await supabase.auth.signInWithOtp({
    email,
    options: {
      emailRedirectTo: redirectTo,
      shouldCreateUser: true,
    },
  });
  if (error) {
    console.error("[GigTrack] sendMagicLink failed:", error);
    return { ok: false, error };
  }
  return { ok: true };
};

// Sign out — clears the local session entirely.
// User is bounced back to the Welcome screen.
export const signOut = async () => {
  const { error } = await supabase.auth.signOut();
  if (error) console.warn("[GigTrack] signOut error:", error);
};

// Save the user's profile to Supabase (upsert by user id).
// `profile` shape: { name, region, weeklyGoal, kmPref, fuelEff, fuelPrice, startOdo, isPro, isGuest, showScoring }
export const saveProfile = async (profile) => {
  console.log("[GigTrack] saveProfile called", profile);
  try {
    const { data: { user } } = await supabase.auth.getUser();
    if (!user) {
      console.warn("[GigTrack] saveProfile: no auth user");
      return { ok: false, error: "no_auth" };
    }
    const row = {
      id:           user.id,
      name:         profile.name ?? null,
      email:        user.email ?? null,
      region:       profile.region ?? null,
      km_pref:      profile.kmPref ?? "active",
      weekly_goal:  profile.weeklyGoal ?? 800,
      is_pro:       !!profile.isPro,
      is_guest:     !!profile.isGuest,
      fuel_eff:     profile.fuelEff ?? null,
      fuel_price:   profile.fuelPrice ?? null,
      start_odo:    profile.startOdo ?? null,
      show_scoring: profile.showScoring ?? true,
    };
    const { error } = await supabase
      .from("profiles")
      .upsert(row, { onConflict: "id" });
    if (error) {
      console.error("[GigTrack] saveProfile FAILED:", error.message);
      return { ok: false, error };
    }
    console.log("[GigTrack] saveProfile OK");
    return { ok: true };
  } catch (e) {
    console.error("[GigTrack] saveProfile THREW:", e);
    return { ok: false, error: e };
  }
};

// Fetch the current user's profile from Supabase.
// Returns the row or null if not found.
export const fetchProfile = async () => {
  console.log("[GigTrack] fetchProfile called");
  try {
    const { data: { user } } = await supabase.auth.getUser();
    if (!user) {
      console.warn("[GigTrack] fetchProfile: no auth user");
      return null;
    }
    const { data, error } = await supabase
      .from("profiles")
      .select("*")
      .eq("id", user.id)
      .maybeSingle();
    if (error) {
      console.warn("[GigTrack] fetchProfile error:", error.message);
      return null;
    }
    console.log("[GigTrack] fetchProfile OK:", data);
    return data;
  } catch (e) {
    console.warn("[GigTrack] fetchProfile threw:", e);
    return null;
  }
};

// Atomically increments screenshot_imports_used and returns the new total.
// Server-side, so it can't be tampered with by the client.
// Returns the new count, or null on failure.
export const incrementScreenshotImportsUsed = async () => {
  console.log("[GigTrack] incrementScreenshotImportsUsed called");
  try {
    const { data, error } = await supabase.rpc("increment_screenshot_imports");
    if (error) {
      console.warn("[GigTrack] incrementScreenshotImportsUsed error:", error.message);
      return null;
    }
    console.log("[GigTrack] incrementScreenshotImportsUsed OK, new count:", data);
    return data;
  } catch (e) {
    console.warn("[GigTrack] incrementScreenshotImportsUsed threw:", e);
    return null;
  }
};

// ─── LIVE DRIVER PRESENCE ─────────────────────────────────────────────────
// Liveness window: a row counts as "live" if online AND last_seen within this
// many minutes. TUNABLE BETA KNOB — on PWA the heartbeat only fires in
// foreground, so a driver who's heads-down delivering goes silent until they
// reopen the app. A longer window bridges those gaps (fewer false absences) at
// the cost of more "ghosts" (finished drivers lingering). Starting at 30 for
// the PWA beta; dial DOWN if counts look inflated, UP if drivers report the
// count showed empty when others were really out. Native (background heartbeat)
// could later drop this back toward 5–10.
export const PRESENCE_LIVE_MINUTES = 30;

// Upsert the current user's presence row. Pass online=true on go-online and on
// heartbeat; online=false on go-offline. Fire-and-forget; returns ok boolean.
export const updatePresence = async ({ zone, platform, online }) => {
  try {
    const { data: { user } } = await supabase.auth.getUser();
    if (!user) return false;
    const { error } = await supabase.from("presence").upsert({
      user_id:   user.id,
      zone:      zone || null,
      platform:  platform || null,
      online:    !!online,
      last_seen: new Date().toISOString(),
    }, { onConflict: "user_id" });
    if (error) {
      console.warn("[GigTrack] updatePresence error:", error.message);
      return false;
    }
    return true;
  } catch (e) {
    console.warn("[GigTrack] updatePresence threw:", e);
    return false;
  }
};

// Count live drivers in a zone, split by platform.
// Returns { total, ue, dd } — "both" counts toward UE and DD and total.
// total counts distinct online drivers (both = 1 driver). Returns null on error.
export const fetchZonePresence = async (zone) => {
  if (!zone) return null;
  try {
    const cutoff = new Date(Date.now() - PRESENCE_LIVE_MINUTES * 60 * 1000).toISOString();
    const { data, error } = await supabase
      .from("presence")
      .select("platform")
      .eq("zone", zone)
      .eq("online", true)
      .gte("last_seen", cutoff);
    if (error) {
      console.warn("[GigTrack] fetchZonePresence error:", error.message);
      return null;
    }
    const rows = data || [];
    let ue = 0, dd = 0;
    for (const r of rows) {
      if (r.platform === "uber_eats" || r.platform === "both") ue += 1;
      if (r.platform === "doordash"  || r.platform === "both") dd += 1;
    }
    return { total: rows.length, ue, dd };
  } catch (e) {
    console.warn("[GigTrack] fetchZonePresence threw:", e);
    return null;
  }
};
