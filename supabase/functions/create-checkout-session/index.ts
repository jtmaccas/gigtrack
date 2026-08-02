// supabase/functions/create-checkout-session/index.ts
//
// Creates a Stripe Checkout Session for a one-time screenshot-credit pack.
// The browser sends only a pack id ("pack20"/"pack50"/"pack100"); price and credits are
// looked up SERVER-SIDE here, so the browser can never dictate the amount.
//
// Auth: requires a valid Supabase JWT in the Authorization header.
// Grants NO credits — it only opens the payment page. Credits are granted later
// by the stripe-webhook function after Stripe confirms payment.

import { createClient } from "https://esm.sh/@supabase/supabase-js@2";
import Stripe from "https://esm.sh/stripe@14?target=deno";

const STRIPE_SECRET_KEY = Deno.env.get("STRIPE_SECRET_KEY");
const SUPABASE_URL      = Deno.env.get("SUPABASE_URL");
const SUPABASE_ANON_KEY = Deno.env.get("SUPABASE_ANON_KEY");

const corsHeaders = {
  "Access-Control-Allow-Origin": "*",
  "Access-Control-Allow-Headers": "authorization, x-client-info, apikey, content-type",
  "Access-Control-Allow-Methods": "POST, OPTIONS",
};

// Server-side pack catalog — the ONLY source of truth for price + credits.
// Keep in sync with SCREENSHOT_PACKS in App.jsx (same ids, same credits).
//
// PRICES UPDATED (credit model §0.6): 20/$2.99 · 50/$5.99 · 100/$9.99.
// A Stripe Price amount is immutable, so new prices = NEW Price objects with
// NEW price_... ids. Create three new Prices in the Stripe dashboard (in the
// SAME mode you deploy to) at 299 / 599 / 999 AUD cents, then paste their ids
// below in place of the REPLACE_ME_* placeholders. amountCents is already the
// new value — it feeds the pending-purchase row / receipt, so it MUST match the
// Price amount you set in Stripe.
const PACKS: Record<string, { priceId: string; credits: number; amountCents: number }> = {
  pack20:  { priceId: "REPLACE_ME_price_20_299",  credits: 20,  amountCents: 299 },
  pack50:  { priceId: "REPLACE_ME_price_50_599",  credits: 50,  amountCents: 599 },
  pack100: { priceId: "REPLACE_ME_price_100_999", credits: 100, amountCents: 999 },
};

Deno.serve(async (req) => {
  // CORS preflight
  if (req.method === "OPTIONS") {
    return new Response("ok", { headers: corsHeaders });
  }

  if (req.method !== "POST") {
    return new Response("Method not allowed", { status: 405, headers: corsHeaders });
  }

  try {
    // 1. Verify auth — same pattern as parse-shift-screenshot.
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

    // 2. Validate the requested pack against the server-side catalog.
    const body = await req.json();
    const { packId } = body;
    const pack = PACKS[packId];
    if (!pack) {
      return jsonResponse({ error: "Unknown pack" }, 400);
    }

    // 3. Create the Stripe Checkout Session (one-time payment).
    const stripe = new Stripe(STRIPE_SECRET_KEY!, { apiVersion: "2024-06-20" });

    // Where Stripe returns the user after paying / cancelling. Uses the request
    // origin so it works from localhost, a Vercel preview, or production.
    const origin = req.headers.get("origin") || "https://gigtrackapp.vercel.app";

    const session = await stripe.checkout.sessions.create({
      mode: "payment",
      line_items: [{ price: pack.priceId, quantity: 1 }],
      success_url: `${origin}/?checkout=success&session_id={CHECKOUT_SESSION_ID}`,
      cancel_url:  `${origin}/?checkout=cancelled`,
      metadata: {
        user_id: user.id,
        pack_id: packId,
        credits: String(pack.credits),
      },
    });

    // 4. Record a 'pending' purchase row (SECURITY DEFINER helper; runs as the
    //    user, so it can only ever create a row for THIS user).
    const { error: insErr } = await supabase.rpc("create_pending_purchase", {
      p_pack_id: packId,
      p_credits: pack.credits,
      p_amount_cents: pack.amountCents,
      p_session_id: session.id,
    });
    if (insErr) {
      console.error("create_pending_purchase failed:", insErr.message);
      // Not fatal to the user flow; the webhook has a metadata fallback.
    }

    // 5. Return the Checkout URL for the browser to redirect to.
    return jsonResponse({ url: session.url });

  } catch (e) {
    console.error("create-checkout-session error:", e);
    return jsonResponse({ error: "Could not start checkout", details: String(e) }, 500);
  }
});

function jsonResponse(body: unknown, status = 200) {
  return new Response(JSON.stringify(body), {
    status,
    headers: { ...corsHeaders, "Content-Type": "application/json" },
  });
}
