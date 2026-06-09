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

// Sign in anonymously (creates a new anonymous user if one doesn't exist)
export const signInAnonymouslyIfNeeded = async () => {
  const { data: { user } } = await supabase.auth.getUser();
  if (user) return user;
  const { data, error } = await supabase.auth.signInAnonymously();
  if (error) {
    console.error("[GigTrack] Anonymous sign-in failed:", error);
    return null;
  }
  return data.user;
};

// Send a magic link to the given email.
// If the user is currently signed in anonymously, Supabase will automatically
// upgrade that anonymous session to the real account when they click the link.
export const sendMagicLink = async (email) => {
  const redirectTo = window.location.origin; // works for localhost and Vercel
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

// Sign out — clears the local session and creates a fresh anonymous one.
export const signOut = async () => {
  const { error } = await supabase.auth.signOut();
  if (error) console.warn("[GigTrack] signOut error:", error);
  // Create a fresh anonymous session so the app stays usable
  await supabase.auth.signInAnonymously();
};
