// supabase/functions/stripe-webhook/index.ts
//
// Receives payment-confirmation events FROM STRIPE (not from the browser) and
// grants screenshot credits. This is the ONLY place credits are granted.
//
// SECURITY: anyone can POST to this URL, so the first thing we do is verify
// Stripe's cryptographic signature using STRIPE_WEBHOOK_SECRET. A request
// without a valid signature is rejected — no signature, no credits.
//
// Uses the SERVICE ROLE key (server-only superpower) to call the idempotent
// grant_screenshot_credits() DB function. Idempotency means Stripe can safely
// deliver the same event twice without double-granting.
//
// SECRETS USED (set via `supabase secrets set`, never in code):
//   STRIPE_SECRET_KEY          — sk_test_... (to construct the Stripe client)
//   STRIPE_WEBHOOK_SECRET      — whsec_...  (to verify the signature)
//   SUPABASE_URL               — auto-provided
//   SUPABASE_SERVICE_ROLE_KEY  — auto-provided; grants credits server-side

import { createClient } from "https://esm.sh/@supabase/supabase-js@2";
import Stripe from "https://esm.sh/stripe@14?target=deno";

const STRIPE_SECRET_KEY         = Deno.env.get("STRIPE_SECRET_KEY");
const STRIPE_WEBHOOK_SECRET     = Deno.env.get("STRIPE_WEBHOOK_SECRET");
const SUPABASE_URL              = Deno.env.get("SUPABASE_URL");
const SUPABASE_SERVICE_ROLE_KEY = Deno.env.get("SUPABASE_SERVICE_ROLE_KEY");

Deno.serve(async (req) => {
  // No CORS block here: this endpoint is called by Stripe's servers, not a
  // browser, so it never triggers a browser preflight.

  if (req.method !== "POST") {
    return new Response("Method not allowed", { status: 405 });
  }

  // 1. Read the RAW body. Signature verification needs the exact bytes Stripe
  //    sent — parsing to JSON first would break the check.
  const rawBody = await req.text();
  const signature = req.headers.get("stripe-signature");

  if (!signature) {
    return new Response("Missing stripe-signature header", { status: 400 });
  }

  const stripe = new Stripe(STRIPE_SECRET_KEY!, { apiVersion: "2024-06-20" });

  // 2. Verify the signature. If this throws, the request is not genuinely from
  //    Stripe (or the secret is wrong) — reject it.
  let event: Stripe.Event;
  try {
    event = await stripe.webhooks.constructEventAsync(
      rawBody,
      signature,
      STRIPE_WEBHOOK_SECRET!,
    );
  } catch (err) {
    console.error("Signature verification failed:", (err as Error).message);
    return new Response("Invalid signature", { status: 400 });
  }

  // 3. We only care about a completed checkout. Ignore everything else (but
  //    return 200 so Stripe doesn't keep retrying events we don't need).
  if (event.type !== "checkout.session.completed") {
    return new Response(JSON.stringify({ received: true, ignored: event.type }), {
      status: 200,
      headers: { "Content-Type": "application/json" },
    });
  }

  const session = event.data.object as Stripe.Checkout.Session;

  // Only grant if the session was actually paid (safety belt).
  if (session.payment_status !== "paid") {
    return new Response(JSON.stringify({ received: true, unpaid: true }), {
      status: 200,
      headers: { "Content-Type": "application/json" },
    });
  }

  const sessionId = session.id;                                   // cs_...
  const paymentId = (session.payment_intent as string) || sessionId; // pi_...

  // 4. Grant credits via the idempotent DB function, using the SERVICE ROLE key
  //    (bypasses RLS; only the server has this key). This is the single point
  //    where credits are added.
  const admin = createClient(SUPABASE_URL!, SUPABASE_SERVICE_ROLE_KEY!);

  const { data, error } = await admin.rpc("grant_screenshot_credits", {
    p_session_id: sessionId,
    p_payment_id: paymentId,
  });

  if (error) {
    console.error("grant_screenshot_credits error:", error.message);
    // Return 500 so Stripe RETRIES later — a transient DB issue shouldn't lose
    // the user's credits. Idempotency makes the retry safe.
    return new Response("Grant failed", { status: 500 });
  }

  console.log(`Webhook processed ${sessionId}: ${data}`); // 'granted' | 'already_granted' | 'no_such_purchase'

  return new Response(JSON.stringify({ received: true, result: data }), {
    status: 200,
    headers: { "Content-Type": "application/json" },
  });
});
