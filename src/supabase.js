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

// ── Email + password auth ──
// Stays fully inside the app (incl. installed PWA) — no browser hand-off like
// the magic-link flow, which is why it's the preferred path on iOS home-screen
// installs. Whether signUp requires an email confirmation depends on the
// "Confirm email" setting in Supabase → Authentication → Providers → Email.
export const signInWithPassword = async (email, password) => {
  const { data, error } = await supabase.auth.signInWithPassword({
    email: email.trim(),
    password,
  });
  if (error) {
    console.error("[GigTrack] signInWithPassword failed:", error);
    return { ok: false, error };
  }
  return { ok: true, data };
};

export const signUpWithPassword = async (email, password) => {
  const { data, error } = await supabase.auth.signUp({
    email: email.trim(),
    password,
    options: { emailRedirectTo: window.location.origin },
  });
  if (error) {
    console.error("[GigTrack] signUpWithPassword failed:", error);
    return { ok: false, error };
  }
  // If "Confirm email" is ON, data.session is null until the user confirms.
  // If OFF, a session is returned immediately and the user is signed in.
  return { ok: true, data, needsConfirmation: !data.session };
};

// Send a password-reset email (used from a "forgot password" link).
export const sendPasswordReset = async (email) => {
  const { error } = await supabase.auth.resetPasswordForEmail(email.trim(), {
    redirectTo: window.location.origin,
  });
  if (error) {
    console.error("[GigTrack] sendPasswordReset failed:", error);
    return { ok: false, error };
  }
  return { ok: true };
};

// Set/update the signed-in user's password (works for magic-link users too —
// they get a password for the first time). Requires a live session.
export const updatePassword = async (newPassword) => {
  const { error } = await supabase.auth.updateUser({ password: newPassword });
  if (error) {
    console.error("[GigTrack] updatePassword failed:", error);
    return { ok: false, error };
  }
  return { ok: true };
};
// `profile` shape: { name, region, weeklyGoal, kmPref, startOdo, isPro, isGuest, showScoring }
// NOTE: fuel_eff / fuel_price columns still exist in the DB but are unused —
// the fuel cost estimator was removed (stale price silently corrupted net earnings).
// Lightweight credit-only update — avoids the full-profile upsert clobbering
// other fields when we just want to bump the screenshot balance.
export const saveScreenshotCredits = async (credits) => {
  try {
    const { data: { user } } = await supabase.auth.getUser();
    if (!user) return { ok: false, error: "no_auth" };
    const { error } = await supabase
      .from("profiles")
      .update({ screenshot_credits: credits })
      .eq("id", user.id);
    if (error) { console.warn("[GigTrack] saveScreenshotCredits error:", error.message); return { ok: false, error }; }
    return { ok: true };
  } catch (e) { console.warn("[GigTrack] saveScreenshotCredits threw:", e); return { ok: false, error: e }; }
};

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
      start_odo:    profile.startOdo ?? null,
      show_scoring: profile.showScoring ?? true,
    };
    // Beta plan + screenshot credits — only include when provided so a partial
    // save (e.g. just credits) doesn't overwrite other fields with defaults.
    if (profile.plan !== undefined)             row.plan = profile.plan;
    if (profile.isBeta !== undefined)           row.is_beta = !!profile.isBeta;
    if (profile.screenshotCredits !== undefined) row.screenshot_credits = profile.screenshotCredits;
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

// Atomically increments screenshot_imports_used by `amount` (default 1) and
// returns the new total. Server-side, so it can't be tampered with by the
// client. Screenshots spend 1; a CSV bulk import spends 10 (credit model §0.6).
// Returns the new count, or null on failure.
export const incrementScreenshotImportsUsed = async (amount = 1) => {
  console.log("[GigTrack] incrementScreenshotImportsUsed called, amount:", amount);
  try {
    const { data, error } = await supabase.rpc("increment_screenshot_imports", { p_amount: amount });
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

// ─── SCREENSHOT CREDIT PURCHASE (Stripe) ──────────────────────────────────
// Calls the create-checkout-session Edge Function, which validates the pack
// server-side, creates a Stripe Checkout Session, records a pending purchase,
// and returns the hosted checkout URL. The browser NEVER grants credits — it
// only opens the payment page; the stripe-webhook function grants credits after
// Stripe confirms payment. Returns { url } on success, or { error } on failure.
export const startCreditCheckout = async (packId) => {
  try {
    const { data, error } = await supabase.functions.invoke("create-checkout-session", {
      body: { packId },
    });
    if (error) {
      console.warn("[GigTrack] startCreditCheckout error:", error.message);
      return { error: error.message || "Checkout failed" };
    }
    if (!data?.url) {
      return { error: data?.error || "No checkout URL returned" };
    }
    return { url: data.url };
  } catch (e) {
    console.warn("[GigTrack] startCreditCheckout threw:", e);
    return { error: String(e) };
  }
};

// ─── PURCHASE HISTORY ─────────────────────────────────────────────────────
// Reads the current user's COMPLETED credit purchases, newest first. RLS
// already restricts rows to the caller (purchases_select_own); we also filter
// to status='completed' so pending/failed checkouts don't show. Read-only —
// users can read their own purchases but never write them. Returns [] on error.
export const fetchPurchaseHistory = async () => {
  try {
    const { data: { user } } = await supabase.auth.getUser();
    if (!user) return [];
    const { data, error } = await supabase
      .from("purchases")
      .select("pack_id, credits, amount_cents, currency, completed_at")
      .eq("status", "completed")
      .order("completed_at", { ascending: false });
    if (error) {
      console.warn("[GigTrack] fetchPurchaseHistory error:", error.message);
      return [];
    }
    return Array.isArray(data) ? data : [];
  } catch (e) {
    console.warn("[GigTrack] fetchPurchaseHistory threw:", e);
    return [];
  }
};
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

// ─── LOCAL BENCHMARKS ─────────────────────────────────────────────────────
// Real zone benchmark over the last 7 completed days, via the get_zone_benchmark
// DB function (security definer, aggregates only). Returns null when the zone has
// fewer than 3 distinct drivers (privacy gate) or on error — caller shows the
// "building" state. Shape: { hourly, perDel, score, shifts } as strings/number.
// ── Tier 1: real bucket benchmark ──
// Aggregates real shifts across a set of granular region ids (a "bucket") over a
// rolling window. The app computes which region ids belong to the bucket and
// passes them in, so bucket logic lives in one place. Returns null when the
// server-side gate isn't met (not enough shifts) → UI shows an honest empty state.
export const fetchBucketBenchmark = async (regionIds, days = 30, minShifts = 5) => {
  if (!regionIds || regionIds.length === 0) return null;
  try {
    const { data, error } = await supabase.rpc("get_zone_benchmark_v2", {
      p_regions: regionIds,
      p_days: days,
      p_min_shifts: minShifts,
    });
    if (error) {
      console.warn("[GigTrack] fetchBucketBenchmark error:", error.message);
      return null;
    }
    const row = Array.isArray(data) ? data[0] : data;
    if (!row) return null; // gate not met → not enough data
    return {
      avgHourly:    row.avg_hourly    != null ? Number(row.avg_hourly)    : null,
      medianHourly: row.median_hourly != null ? Number(row.median_hourly) : null,
      perDel:       row.avg_per_del   != null ? Number(row.avg_per_del)   : null,
      score:        row.avg_score     != null ? Number(row.avg_score)     : null,
      topHourly:    row.top_hourly    != null ? Number(row.top_hourly)    : null,
      shifts:       row.shift_count ?? 0,
    };
  } catch (e) {
    console.warn("[GigTrack] fetchBucketBenchmark threw:", e);
    return null;
  }
};

// ── Tier 2: real percentile ("you earn more than X% of drivers here") ──
// Given the user's own hourly rate and the region ids in their bucket, returns
// what % of shifts in that bucket earned less. null when the gate isn't met.
export const fetchZonePercentile = async (regionIds, hourly, days = 30, minShifts = 2) => {
  if (!regionIds || regionIds.length === 0 || hourly == null) return null;
  try {
    const { data, error } = await supabase.rpc("get_zone_percentile_v2", {
      p_regions: regionIds,
      p_hourly: hourly,
      p_days: days,
      p_min_shifts: minShifts,
    });
    if (error) { console.warn("[GigTrack] fetchZonePercentile error:", error.message); return null; }
    const row = Array.isArray(data) ? data[0] : data;
    if (!row) return null;
    return { percentile: row.percentile ?? null, shifts: row.shift_count ?? 0 };
  } catch (e) {
    console.warn("[GigTrack] fetchZonePercentile threw:", e);
    return null;
  }
};

// ── Tier 2: real per-state bucket leaderboard ──
// Pass a state code ('QLD'); SQL derives buckets and ranks them by median $/hr.
// Returns [] when no buckets clear the gate.
export const fetchStateLeaderboard = async (state, days = 30, minShifts = 2, limit = 8) => {
  if (!state) return [];
  try {
    const { data, error } = await supabase.rpc("get_state_leaderboard_v2", {
      p_state: state,
      p_days: days,
      p_min_shifts: minShifts,
      p_limit: limit,
    });
    if (error) { console.warn("[GigTrack] fetchStateLeaderboard error:", error.message); return []; }
    if (!Array.isArray(data)) return [];
    return data.map(row => ({
      bucketKey: row.bucket_key,
      median: row.median_hourly != null ? Number(row.median_hourly) : null,
      shifts: row.shift_count ?? 0,
    }));
  } catch (e) {
    console.warn("[GigTrack] fetchStateLeaderboard threw:", e);
    return [];
  }
};

// ── Tier 5: real state-wide busiest platform ──
// Returns { label, pct, shifts } for the most-driven platform in the state over
// the window, or null when the gate isn't met (app shows an honest empty state).
export const fetchStatePlatformSplit = async (state, days = 30, minShifts = 2) => {
  if (!state) return null;
  try {
    const { data, error } = await supabase.rpc("get_state_platform_split_v2", {
      p_state: state,
      p_days: days,
      p_min_shifts: minShifts,
    });
    if (error) { console.warn("[GigTrack] fetchStatePlatformSplit error:", error.message); return null; }
    if (!Array.isArray(data) || data.length === 0) return null;
    const top = data[0]; // SQL orders by shift_count desc
    const label = top.platform === "uber_eats" ? "Uber Eats"
                : top.platform === "doordash"  ? "DoorDash"
                : "Both";
    return { label, pct: top.pct ?? null, shifts: top.shift_count ?? 0 };
  } catch (e) {
    console.warn("[GigTrack] fetchStatePlatformSplit threw:", e);
    return null;
  }
};

// ── Tier 3: real "best days to drive" (median $/hr per weekday) ──
// Returns a Mon..Sun array of { median, shifts } (index 0 = Monday), or null
// when the gate isn't met. Uses shift DATE only — no start time needed.
export const fetchZoneDayOfWeek = async (regionIds, days = 30, minShifts = 2) => {
  if (!regionIds || regionIds.length === 0) return null;
  try {
    const { data, error } = await supabase.rpc("get_zone_day_of_week", {
      p_regions: regionIds,
      p_days: days,
      p_min_shifts: minShifts,
    });
    if (error) { console.warn("[GigTrack] fetchZoneDayOfWeek error:", error.message); return null; }
    if (!Array.isArray(data) || data.length === 0) return null;
    // SQL returns dow 0=Sun..6=Sat. Map to Mon-first array (0=Mon..6=Sun).
    const monFirst = Array.from({ length: 7 }, () => ({ median: null, shifts: 0 }));
    const toMon = (dow) => (dow + 6) % 7; // Sun(0)->6, Mon(1)->0, ... Sat(6)->5
    for (const row of data) {
      const i = toMon(row.dow);
      monFirst[i] = { median: row.median_hourly != null ? Number(row.median_hourly) : null, shifts: row.shift_count ?? 0 };
    }
    return monFirst;
  } catch (e) {
    console.warn("[GigTrack] fetchZoneDayOfWeek threw:", e);
    return null;
  }
};

// ── National: overall median, shift count, peak day ──
export const fetchNationalOverview = async (days = 30, minShifts = 2) => {
  try {
    const { data, error } = await supabase.rpc("get_national_overview", { p_days: days, p_min_shifts: minShifts });
    if (error) { console.warn("[GigTrack] fetchNationalOverview error:", error.message); return null; }
    const row = Array.isArray(data) ? data[0] : data;
    if (!row) return null;
    return {
      median: row.median_hourly != null ? Number(row.median_hourly) : null,
      shifts: row.shift_count ?? 0,
      peakDow: row.peak_dow ?? null, // 0=Sun..6=Sat
    };
  } catch (e) { console.warn("[GigTrack] fetchNationalOverview threw:", e); return null; }
};

// ── National: per-state/territory leaderboard ──
export const fetchNationalStates = async (days = 30, minShifts = 2) => {
  try {
    const { data, error } = await supabase.rpc("get_national_states", { p_days: days, p_min_shifts: minShifts });
    if (error) { console.warn("[GigTrack] fetchNationalStates error:", error.message); return []; }
    if (!Array.isArray(data)) return [];
    return data.map(r => ({
      stateKey: r.state_key,
      median: r.median_hourly != null ? Number(r.median_hourly) : null,
      shifts: r.shift_count ?? 0,
    }));
  } catch (e) { console.warn("[GigTrack] fetchNationalStates threw:", e); return []; }
};

export const fetchZoneBenchmark = async (region) => {
  if (!region) return null;
  try {
    const { data, error } = await supabase.rpc("get_zone_benchmark", { p_region: region });
    if (error) {
      console.warn("[GigTrack] fetchZoneBenchmark error:", error.message);
      return null;
    }
    // RPC returns an array of rows; the gate means 0 rows = not enough drivers.
    const row = Array.isArray(data) ? data[0] : data;
    if (!row) return null;
    return {
      hourly: row.avg_hourly != null ? Number(row.avg_hourly).toFixed(2) : null,
      perDel: row.avg_per_del != null ? Number(row.avg_per_del).toFixed(2) : null,
      score:  row.avg_score  != null ? Number(row.avg_score).toFixed(1)  : null,
      shifts: row.shift_count ?? 0,
    };
  } catch (e) {
    console.warn("[GigTrack] fetchZoneBenchmark threw:", e);
    return null;
  }
};

// ─── ACCOUNT DELETION ─────────────────────────────────────────────────────
// Permanently deletes the CURRENT user's shifts, presence, profile and auth
// account via the delete_my_account() security-definer function (a client can't
// delete its own auth.users row). Returns { ok } — caller should sign out and
// wipe local data regardless, but should NOT claim success if ok is false.
export const deleteMyAccount = async () => {
  try {
    const { error } = await supabase.rpc("delete_my_account");
    if (error) {
      console.warn("[GigTrack] deleteMyAccount error:", error.message);
      return { ok: false, error };
    }
    return { ok: true };
  } catch (e) {
    console.warn("[GigTrack] deleteMyAccount threw:", e);
    return { ok: false, error: e };
  }
};

// Australia-wide benchmark aggregate. Companion to fetchZoneBenchmark — used as
// CONTEXT when a user's own zone doesn't have enough shifts yet (common when the
// user base is spread nationally). Returns null when the national gate isn't met.
// NOTE: this is deliberately NOT a substitute for the local number — the UI must
// always label it "Australia-wide" so a driver never mistakes it for their zone.
export const fetchNationalBenchmark = async () => {
  try {
    const { data, error } = await supabase.rpc("get_national_benchmark");
    if (error) {
      console.warn("[GigTrack] fetchNationalBenchmark error:", error.message);
      return null;
    }
    const row = Array.isArray(data) ? data[0] : data;
    if (!row) return null;
    return {
      hourly: row.avg_hourly  != null ? Number(row.avg_hourly).toFixed(2)  : null,
      perDel: row.avg_per_del != null ? Number(row.avg_per_del).toFixed(2) : null,
      shifts: row.shift_count ?? 0,
    };
  } catch (e) {
    console.warn("[GigTrack] fetchNationalBenchmark threw:", e);
    return null;
  }
};
