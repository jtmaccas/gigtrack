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
// `profile` shape: { name, region, weeklyGoal, kmPref, fuelEff, fuelPrice, startOdo, isPro, isGuest }
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
