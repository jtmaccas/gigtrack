# GigTrack — Project Handoff

_Last updated: alpha 0.17.161 (app) · GigTrack Ops Phase 1 + Tier 1 + Tier 2 (full) live · August 2026_

This document is the single source of truth for the GigTrack project. It exists so a fresh chat (or a new collaborator) can get fully up to speed without re-deriving context. Read it top to bottom before making changes.

---

## 1. What GigTrack is

**GigTrack is a Progressive Web App (PWA) for Australian gig-economy delivery drivers** — specifically Uber Eats and DoorDash drivers. It helps them track shift earnings, calculate their ATO tax deductions, score their shifts, and benchmark their earnings against other drivers in their area.

It's built and run by **Jaden**, a solo developer based in Brisbane who drives for these platforms himself — so product decisions are informed by real driving experience.

- **Live app:** https://gigtrackapp.vercel.app
- **Repo:** `jtmaccas/gigtrack` (public, GitHub)
- **Local project root:** `C:\Users\jaden\Downloads\gigtrack-vite\gigtrack-vite`
- **Status:** Alpha, launched nationally across Australia. Stripe payments are LIVE.

### The core value proposition
A driver opens the app, logs each shift (by timer, manual entry, or importing a screenshot/spreadsheet), and immediately sees: what they earned per hour and per delivery, their ATO tax deduction for that shift, a score against their own targets, and — the standout feature — how their earnings compare to other real drivers in their specific zone. No other tool gives Australian delivery drivers honest, local, peer benchmarks.

---

## 2. Who it's for and how they use it

The target user is an **Australian Uber Eats / DoorDash driver** who wants to:
- Know if they're actually earning well or getting underpaid (benchmarks answer this).
- Have their tax deductions sorted automatically for the ATO (cents-per-km method).
- Keep a clean record of every shift without spreadsheet faff.

**Typical first session:** sign up → set a weekly earnings goal → bulk-import their driving history from a CSV/Excel export (fills the app with real data instantly) → see their populated home screen, shift log, and benchmarks. From then on they log new shifts as they go, usually via screenshot import (fastest) or manual entry.

---

## 3. Feature set (current)

### Shift logging
- **Manual entry** — enter earnings, online time, distance, deliveries. A lighter form shows just the essentials with an "Add detail" button for tips, active time, notes.
- **Live timer** — start when going online, stop when finishing. (Note: GPS auto-tracking is disabled — see constraints.)
- **Screenshot import** — photograph an earnings summary from Uber/DoorDash; Claude Vision (via a Supabase Edge Function) reads the numbers and pre-fills a shift. Costs 1 credit.
- **Weekly catch-up** — import a weekly summary screenshot; the app creates a resumable task on the home screen to log each day of that week. Costs 2 credits.
- **Bulk import (CSV/Excel)** — map columns once, import an entire history at once. Costs 5 credits. Deliberately cheap because it's ~$0 API cost (client-side parse) and its job is onboarding data density.

### Insights & analysis
- **Home screen** — weekly earnings, goal progress, three hero stats (Online time / Deliveries / Avg per delivery), a zone benchmark card, and recent shifts.
- **Shift Log** — full history, sortable, with per-shift detail screens (score, vs-average comparison, ATO deduction breakdown).
- **Benchmarks** — compare your earnings to other real drivers in your zone / state / nationally. Shows your percentile, zone median, top-10%, best days to drive, and $/delivery. Built entirely on real logged shifts — no fabricated data.
- **Scoring** — each shift scored against user-set targets (hourly rate, per-delivery, active KM%, active time%). Display can be toggled off; calculations always run.

### Tax (ATO)
- Automatic **cents-per-km deduction** using the correct per-financial-year rate (91c/km for FY2026-27 per LI 2026/19), capped at 5,000 work-related km/year.
- **Always uses total (online) km** — this is the ATO-compliant figure for delivery drivers, since every km driven while working (including between-job travel) is work-related. (A former "Active/Total km" toggle was removed — it could cause under-claiming.)
- **PDF export** — a tidy ATO shift report (jsPDF + jspdf-autotable) for tax time.

### Other
- **In-app "How to use GigTrack" guide** — hero-square feature grid in Settings, matching the "Add to home screen" style, explaining each feature.
- **PWA install help** — per-platform "add to home screen" instructions.
- **Credit purchase** — buy credit packs via Stripe (live).
- **Feedback form** — Google Form (also linked from the crash screen).

---

## 4. Business / plan model

**One credits-only plan. Everyone is permanently unlocked. Credits are the only paid mechanic.**

- New signups get **10 free credits** (`FREE_SCREENSHOT_CREDITS = 10`).
- Credit costs: **screenshot = 1, weekly = 2, CSV = 5** (`CREDIT_COST_SCREENSHOT/WEEKLY/CSV`, near line 140 of App.jsx).
- The funnel logic: **fill → hook → habit → convert.** A new user CSV-imports their history (−5), fills the app with real data, still has ~5 credits left to form the screenshot-logging habit before needing to pay.
- Credits are charged **only on a successful result**, never on a failed attempt (bias failures to Jaden's cost, never the user's).

### Credit packs (Stripe, LIVE)
- pack20 = 20 credits, **$2.99** — `price_1U0TcAD5GMnveSsOMWVsxFo2` (299c)
- pack50 = 50 credits, **$5.99** — `price_1U0TcMD5GMnveSsOoMvDOSzV` (599c)
- pack100 = **150 credits** (early-user promo, was 100), **$9.99** — `price_1U0TcZD5GMnveSsO6p4z9Pjt` (999c)

**⚠️ EARLY-USER PROMO — pack100 grants 150 credits for the same $9.99 (was 100).** The Stripe Price is unchanged ($9.99); only the *granted credit count* was bumped, so it's a pure "more credits, same price" bonus. **To end the promo you must revert it in THREE places (they must stay in sync):**
1. `create-checkout-session/index.ts` → `PACKS.pack100.credits` back to `100`. (This is the authoritative grant amount — the webhook grants whatever the checkout wrote into the `purchases` row.)
2. `src/App.jsx` → the `SCREENSHOT_PACKS` pack100 entry: `credits: 100`, `label: "100 credits"`, and drop the `strikeCredits` / `bonusBadge` fields (they drive the ~~100~~ strikethrough + "+50% BONUS" tag on the card).
3. **Stripe Dashboard → Products** → the $9.99 product's Name ("150 GigTrack Credits") and Description (mentions "pay for 100, get 50 bonus"). Product ≠ Price, so editing the name/description is free and instant and doesn't touch the price.

There is a leftover Pro/free model in the codebase (`isPro`, `BETA_MODE`) but it is **superseded** — a forced `unlocked = true` is passed to every screen so all former gates read as unlocked. See §8 for the audit.

---

## 5. Tech stack & architecture

- **Frontend:** React 18 + Vite. **All UI lives in one file: `src/App.jsx`** (~707KB, ~12,500 lines). Coral "Daylight" theme.
- **Entry:** `src/main.jsx` → wraps `<App/>` in `src/ErrorBoundary.jsx` (app-wide crash screen).
- **Backend:** Supabase — auth, Postgres (with RLS), and Edge Functions.
- **Hosting:** Vercel (auto-deploys on push to `main`).
- **Payments:** Stripe (LIVE).
- **AI:** Anthropic Claude Vision API, called via a Supabase Edge Function, for screenshot parsing.
- **PDF:** jsPDF + jspdf-autotable.

### Key files
- `src/App.jsx` — all UI, all screens, the REGIONS/zone data, rate tables, credit logic. **This is 95% of the app.**
- `src/supabase.js` — auth helpers, `saveProfile`, `updatePassword`, `sendPasswordReset`, `incrementScreenshotImportsUsed`, etc.
- `src/main.jsx` — entry point.
- `src/ErrorBoundary.jsx` — crash screen (with Email support + Send feedback links).
- `src/cloudSync.js` — sync helpers.
- `supabase/functions/parse-shift-screenshot/index.ts` — Claude Vision screenshot parser.
- `supabase/functions/create-checkout-session/index.ts` — Stripe checkout (has the live price ids).
- `supabase/functions/stripe-webhook/index.ts` — grants credits on payment.
- `WEEKLY_CATCHUP_PLAN.md` — plan doc for the weekly catch-up feature.
- `GIGTRACK_HANDOFF.md` — this file (local only, not in repo).

### Supabase
- **Project ref:** `kpdhdlxuoatmwqdnrcbd`
- **Tables:** `shifts`, `profiles`, `presence`, `purchases` (all RLS owner-only, audited).
- RLS audit passed: shifts/profiles/presence confirmed owner-only.

---

## 6. Zones / benchmarks system

Benchmarks are grouped into geographic **zones**. As of now there are **186 zones** covering every state and territory — capital-city suburbs through to regional hubs — so drivers compare like-with-like (e.g. Byron Bay isn't benchmarked against Wagga Wagga).

- Each zone has: a REGIONS entry (`{ id, label, state, group }`) **and** a matching rate entry (`{ hourly, perDel, score }`). Every zone must have both — integrity is "regions count == rates count, no orphans."
- **Every state has a "Regional (other)" catch-all** except ACT (which is entirely urban Canberra). This guarantees any driver anywhere can pick a zone.
- **Beta counting buckets:** because real user density is low during beta, sparse zones are grouped for *presence counting* via `BUCKET_COLLAPSE_TO_CITY` and `BUCKET_MERGE` (e.g. all far-regional QLD zones count together as `qld-regional`), while each keeps its own label and benchmark. This is controlled by `BETA_ZONE_BUCKETS`; post-beta each zone stands alone.
- **Zone IDs are stable** — never rename an existing ID (it orphans logged shifts); only add new ones or change labels.

**Benchmark honesty is non-negotiable.** All fabricated benchmark data was removed long ago. Empty/insufficient zones show empty states, never fake numbers. Abuse filters applied (`total_hrs >= 0.9`, `hourly <= 75`, `total_earned >= 4`). Constants: `BENCHMARK_WINDOW_DAYS = 30`, `BENCHMARK_MIN_SHIFTS = 2`.

---

## 7. Key constants (near top of `src/App.jsx`)

| Constant | Value | Meaning |
|---|---|---|
| `CURRENT_VERSION` | `"ALPHA 0.17.159"` | ~line 1115. Bump per commit. |
| `FREE_SCREENSHOT_CREDITS` | `10` | Free credits on signup (~line 131) |
| `CREDIT_COST_SCREENSHOT` | `1` | ~line 140 |
| `CREDIT_COST_WEEKLY` | `2` | ~line 141 |
| `CREDIT_COST_CSV` | `5` | ~line 142 |
| `BETA_MODE` | `true` | Leave true. Controls onboarding flow — do not touch. |
| `LIVE_DRIVERS_ENABLED` | `false` | Live-drivers presence off until real concurrent density. Benchmarks ARE live. |
| `TIMER_GPS_ENABLED` | `false` | PWA can't background-sample GPS. Hard constraint. |

---

## 8. Current state & what's been done

**Live version: ALPHA 0.17.159.**

### Recently completed (0.17.161)
- **Shift provenance + timezone-proof dates (Tier 2b):** every shift now records `shift_date` (the driver's own local calendar date — correct in any Australian timezone) and `source` (`screenshot`/`csv`/`manual`). Invisible to drivers; powers the GigTrack Ops dashboard (§13). Weekly-catch-up shifts save as manual/screenshot (see §12 limitation). Files: `App.jsx` (`handleSaved` + `buildTripFromCsvRow`), `cloudSync.js` (`tripToRow`/`rowToTrip`).

### Recently completed (0.17.160)
- **Password-reset refresh fix:** a durable `gt_pending_password_reset` localStorage flag now survives a page refresh, so following a reset link and refreshing keeps you on the forced set-password screen instead of silently logging in. Flag is set on the `PASSWORD_RECOVERY` event, restored on boot, and cleared ONLY on a successful `updatePassword`. (Delivered — confirm pushed.)

### Recently completed (0.17.159)
- **Early-user promo:** pack100 now grants **150 credits for the same $9.99** (was 100). The $9.99 card shows ~~100~~ **150 credits** with a **+50% BONUS** tag (the old "Best value" pill was dropped in favour of the strikethrough). See §4 for the three-place unwind when the promo ends. Stripe Price unchanged; only the granted count changed.
- **Paywall retitled "Screenshot credits" → "Credits"** and its subtext reworked: now "You have N credits left. Use them for screenshot, weekly and CSV imports." (credits aren't screenshot-only — they cover screenshot/weekly/CSV).
- **Paywall footer reworked** — the old "Everything else is free during beta. Screenshots use AI… that's all we charge for." line was stale (implied AI was the only cost, and referenced beta). Now: "Everything in GigTrack is unlocked. Credits are only used for imports — screenshots, weekly catch-ups and spreadsheet uploads — which help cover the cost of reading them. Nothing else is charged."

### Recently completed (0.15 → 0.17)
- **National zone expansion** — grew from ~130 to **186 zones**; split Sunshine Coast, Darling Downs; added Wide Bay, FNQ, Mount Isa, Mackay/Whitsundays (QLD); Central Coast, Blue Mountains + 6 regionals (NSW); Casey corridor + 6 regionals (VIC); 5 regionals (SA); 4 hubs (WA); North West (TAS); South Coast NSW; per-state "Regional (other)" catch-alls.
- **Settings flattened** — removed the collapsible "Advanced" section; Weekly Goal, ATO rate, Scoring Targets all promoted into Preferences. Removed the dead "Currency" row.
- **Distance Unit toggle removed** — ATO deduction now always uses total (work-related) km, the compliant method. Fixed a bug where per-shift detail could under-claim.
- **Weekly goal reset bug fixed** — root cause was a stale Pro/free gate in the Settings save handler (`if(isPro){...}else{ onWeeklyGoal(800) }`) that forced 800 on every save. Removed the gate. (Also a supabase.js partial-sync guard.)
- **In-app "How to use GigTrack" guide** added.
- **Password reset overhaul** — (a) debounced "Forgot password?" (Sending… state + 30s cooldown) so it can't fire multiple emails; (b) catch Supabase `PASSWORD_RECOVERY` event and force a non-dismissable "Set a new password" screen, so a reset link can't act as a silent magic-link login.
- **Crash screen (ErrorBoundary)** — now shows Email support (`gigtracksupport@gmail.com`, pre-filled with the captured error message) + Send feedback (Google Form) links.

### Earlier foundational work (pre-0.15)
- Security hardening: single `wipeUserData()` prefix-based localStorage wipe; `_owner` stamps + `gt_last_user_id` switch detection (cross-account contamination defense on shared devices); UUID-leaking logs removed; full RLS audit.
- Benchmarks: all fabricated data removed, real SQL aggregation functions, abuse filters.
- Stripe: full end-to-end, then taken LIVE (see §9).
- PDF export rebuilt with jsPDF (replacing a broken `window.print()` flow that trapped iOS PWA users).
- PWA install help + one-time install nudge.
- Weekly catch-up import (built to real data).

### isPro-gate audit (done, clean)
A full sweep confirmed: the only *harmful* stale Pro/free gate was the weekly-goal one (now fixed). All other `isPro` references either receive `unlocked=true` (so behave correctly), are dead code that never renders, or are legitimate plan-tracking. No feature is silently broken. Cosmetic dead code (benchmark lock states, inert props) is left alone — removing it is "parked Pass 3" work gated on `BETA_MODE`, and touching it risks the onboarding flow.

---

## 9. Stripe (LIVE) — critical deploy note

Stripe went live and is proven end-to-end (real payment auto-granted credits; refund worked).

**⚠️ CRITICAL DEPLOY GOTCHA:** the `stripe-webhook` Edge Function MUST always be deployed with the `--no-verify-jwt` flag:
```
npx supabase functions deploy stripe-webhook --no-verify-jwt
```
Without it, Supabase's JWT-by-default blocks Stripe's webhook (401 "Missing authorization header") and **credits silently stop granting**. This was a real go-live bug. `create-checkout-session` does NOT use the flag (it's called with a Supabase auth token from the app).

- **Webhook URL:** `https://kpdhdlxuoatmwqdnrcbd.supabase.co/functions/v1/stripe-webhook`
- **Event:** `checkout.session.completed` only.
- Live price ids are in `create-checkout-session/index.ts` (see §4).

---

## 10. Development workflow (IMPORTANT — read before delivering code)

### The environment
- Jaden uses **PowerShell** on Windows. Use `curl.exe` not `curl`.
- **GitHub raw URLs are the source of truth** for current file state. Pull from `https://raw.githubusercontent.com/jtmaccas/gigtrack/main/src/App.jsx` before editing.
- Git instructions are always given as **separate code blocks**.

### Version / build numbering
- Format: `ALPHA 0.MINOR.BUILD` (e.g. 0.17.158).
- **Jaden controls the minor version roll** (e.g. 0.16 → 0.17) and is the **source of truth on the build count** (he checks GitHub). If the count drifts, he gives the correct number to resync.
- Increment BUILD by 1 per commit, include it in the commit message, and update `CURRENT_VERSION` (~line 1111).
- When rolling a new minor version, add a matching `CHANGELOG` entry at the top of the `CHANGELOG` array (grouped by minor version, e.g. `"ALPHA 0.17"`). The "What's new" modal shows the top entry.

### Mandatory validation gate (before every delivery)
Run all three, from the project root:
```
node ./check_babel.cjs src/App.jsx
node ./jsxcheck.cjs src/App.jsx
npx eslint src/App.jsx --no-config-lookup --config eslint.config.mjs
```
- **GOTCHA:** installing ESLint knocks out `@babel/core`. Reinstall after eslint:
  `npm install --no-save @babel/core @babel/preset-react @babel/preset-env @babel/traverse @babel/types`
- The only expected/allowed lint error is a pre-existing `URLSearchParams` no-undef (~line 11xxx) — leave it.
- For Edge Functions (TS): `node ./tscheck.cjs <path>` (needs `@babel/preset-typescript`).
- **The gate does NOT catch React Rules-of-Hooks violations** — those only surface at runtime. Be careful placing `useState` before any early `return` in a component. (This caused a real crash once — hooks placed after `if (!open) return null`.)

### ⚠️ File-copy / delivery discipline (this has caused real problems repeatedly)
This is the single biggest recurring source of pain. Read carefully:
- The `cp` to `/mnt/user-data/outputs` has **silently failed before**, delivering stale content. **ALWAYS verify at the DESTINATION** after copying (grep the version string + `wc -c` the size).
- Jaden's Downloads folder has had **stale old App.jsx files** (e.g. a 371KB June version) that once got copied over the real file and pushed, turning the live app green/broken.
- Browser downloads sometimes **don't fire at all** — Jaden ends up copying an old file thinking it's new.
- **Therefore, before every push, Jaden must confirm BOTH at the destination:**
  ```
  Select-String -Path src\App.jsx -Pattern 'CURRENT_VERSION ='
  (Get-Item src\App.jsx).Length
  ```
  and check the version string AND the byte size match what was delivered. For a fix that must be present, also `Select-String` for a unique marker of that fix (e.g. `PASSWORD_RECOVERY`).
- App.jsx is currently ~707KB. If a downloaded "App.jsx" is ~371KB or ~577KB, it's a stale old file — do not use it.

### Delivery checklist (what to always include)
1. The updated file(s), verified at the outputs destination (version + size).
2. Git add/commit/push instructions as a **separate code block**, with the build number in the commit message.
3. Local test reminder where relevant (`npm run dev` → `localhost:5173`).
4. Destination-verification commands for Jaden to run before pushing.

---

## 11. Design principles & hard-won lessons

- **Benchmark honesty is non-negotiable.** Never fabricate stats. Empty states over fake data. This also means: never seed fake shifts to make the app look busier — it poisons the live benchmarks and would backfire on a skeptical audience.
- **Security by structure, not vigilance.** A single prefix-based wipe beats multiple manual wipe lists; `_owner` stamps beat ad-hoc checks.
- **Feature removal over broken features.** The fuel-cost estimator was cut (stale prices silently corrupt net earnings). A misleading setting (the Distance Unit toggle) was removed rather than left confusing.
- **PWA constraints are hard limits.** No background GPS. `window.print()` traps iOS PWA users. Architect around these, not against them. (The logbook tax method is parked for a future native app precisely because it needs background GPS.)
- **Charge only on success.** Never charge a credit for a failed import.
- **ATO compliance matters and isn't tax advice.** The cents-per-km method uses total work km; the PDF disclaims it isn't tax advice and to confirm with a registered agent.

---

## 12. Open items / roadmap

### Near-term / backlog
- **✅ DONE (0.17.161) — App write-path change: `shift_date` + `source` stamped on new shifts.** The app now writes both columns on every shift-creation path. Implementation: `cloudSync.js` `tripToRow`/`rowToTrip` map both fields (the single DB choke point every path flows through); in `App.jsx`, `handleSaved` sets `shift_date` (driver's local date via `localDateStr`) and infers `source` (`imported_from_screenshot` → `screenshot`, else `manual`) — this covers manual/screenshot/timer; `buildTripFromCsvRow` sets `shift_date` + `source='csv'`. **Known limitation:** weekly catch-up does NOT produce a `weekly` source — it creates per-day *tasks* that are then logged via the normal manual/screenshot flow, so those shifts save as `manual`/`screenshot`. Separating `weekly` would mean threading a flag through the task system (bigger job, deferred). So the source breakdown shows screenshot/csv/manual (+ unknown for pre-0.17.161 history), not weekly. Dates are now timezone-correct for all states going forward (Ops already reads the column via the hybrid).
- **Refund request form** — Jaden is adding refund requests to the feedback form. Suggested dropdown reasons: charged-but-credits-didn't-arrive (highest priority), import-didn't-work, accidental purchase, bought-but-can't-use-feature, duplicate charge, not-satisfied, other. Pair with free-text for purchase date/amount.
- Shift-log search / filter.
- Notes field on shifts.
- Notification reminders.

### Parked / future
- **Logbook tax method** — deferred to a future native (Apple/Android) app, where background GPS makes automatic business/personal trip tracking viable. Not feasible in a PWA.
- **Live Drivers presence** — stays off (`LIVE_DRIVERS_ENABLED = false`) until real concurrent-user density. Benchmarks are already live nationally.
- **Pro/free cleanup (Pass 3)** — removing the dead `PremiumPaywallScreen`, onboarding choose/paywall modes, and last "Upgrade to Pro" strings. Parked, gated on `BETA_MODE`'s fate. Don't touch the onboarding flow.
- **GigTrack Ops Phase 2 (Stripe revenue) + Phase 3 (Google Forms unactioned)** — see §13. Phase 2 needs a server-side Edge Function (Stripe secret key must never touch client). UX skin for Ops still undecided (previewed coral-on-dark / clean-light / warm-editorial / data-dense; currently on data-dense green).
- **Ops: MFA + deploy** — Ops currently runs locally only (`npm run dev`). Fast-follow: deploy as a real repo + Vercel with Supabase MFA, so it's reachable (incl. phone) rather than local-only.
- Wants: Australia map for benchmark scouting, badges/achievements, abuse-detection bot.

### Housekeeping reminders
- Delete stale App.jsx files from Jaden's Downloads to stop the copy confusion.
- Confirm `gigtracksupport@gmail.com` inbox is real and monitored (now surfaced on the crash screen).
- Supabase free tier: main binding constraint is the 7-day idle pause (reliability) — upgrade to Pro (~$25/mo) around launch/growth, not for capacity.

---

## 13. GigTrack Ops (admin dashboard) — SEPARATE PROJECT

A private, admin-only dashboard for Jaden to see how the app is doing at a glance.
**Separate from the driver app on purpose** — its own project/folder, its own deploy,
admin logic never ships in the driver app's public bundle. Reads the SAME Supabase
project (`kpdhdlxuoatmwqdnrcbd`) through admin-only functions gated by an allowlist.

### Where it lives / how to run
- Local Vite + React project (same stack as the app): `gigtrack-admin/` (folder on Jaden's machine, unzipped from delivery). NOT yet a GitHub repo or deployed — runs locally only for now.
- Run: `cd gigtrack-admin` → `npm run dev` → **http://localhost:5174** (5174 so it won't clash with the app's 5173). Sign in with an allowlisted admin account.
- Config: `.env` holds `VITE_SUPABASE_URL` (filled) + `VITE_SUPABASE_ANON_KEY` (Jaden pasted his anon key; gitignored). Anon key is public-safe; the DB gate is what protects data.
- Files: `src/App.jsx` (dashboard), `src/supabaseClient.js`, `src/regions.js` (zone id→label/state, extracted from app REGIONS), `src/styles.css` (dark "telemetry" theme — deliberately unlike the coral app so admin ≠ driver view at a glance).

### Access / security model
- **Admin allowlist (two accounts)**, hardcoded in the SQL `is_admin()` function:
  - `bf380800-506b-421f-9e99-48ed2d5ae0d2` — jtmcintosh1440@gmail.com (primary, private)
  - `e7d90198-8566-4350-960b-99e945e2632c` — gigtracksupport@gmail.com (backup)
- Every `admin_*` SQL function is `SECURITY DEFINER` (reads across all users, bypassing RLS) but calls `is_admin()` first and raises `not authorised` for anyone else. Elevated access, gated by "are you Jaden?". Same safe pattern as `grant_screenshot_credits`.
- In the Supabase SQL editor `auth.uid()` is NULL, so calling `admin_*` there raises `not authorised` — that's the gate working, not a bug. Test via the app while signed in, or use read-only equivalents.
- MFA is planned (fast-follow, once deployed) — not yet in place.

### SQL (applied in Supabase — files delivered)
Run order: `admin_tier1.sql` → `admin_tier2a.sql` (both idempotent, `create or replace`).
- `is_admin()` — allowlist gate.
- `admin_overview_range(p_start, p_end)` — users (total + new-in-range), shifts, active drivers, gross/hours/km, active zones.
- `admin_shifts_by_platform(p_start, p_end)` — Uber vs DoorDash: shifts, share, drivers, gross, hours.
- `admin_shifts_by_geography(p_start, p_end)` — zone rollup (client groups by state via regions.js).
- `admin_growth(p_start, p_end)` — daily new users + shifts, zero-filled.
- `admin_import_source(p_start, p_end)` — source breakdown (mostly `unknown` until the app writes `source`).

### Phase / Tier status
- **Phase 1 (DONE, live):** top-line + geography + growth, allowlist-gated. Verified against real data (104 shifts, Brisbane + Parramatta).
- **Tier 1 (DONE, live):** date-range picker (7d / 30d / 90d / This month / All time / Custom) driving everything; added by-platform breakdown and hours/km cards.
- **Tier 2 Step A (DONE, safe half):** added `shifts.shift_date` (date) + `shifts.source` (text), backfilled `shift_date` from `ts` (Brisbane), backfilled `source='screenshot'` for the 1 flagged shift (rest `unknown`). Dashboard functions repointed to hybrid `COALESCE(shift_date, brisbane(ts))`. **Invisible on current data** (all-Brisbane history → same dates), lays groundwork for multi-timezone correctness.
- **Tier 2 Step B (DONE, 0.17.161 — the app write-path change):** app now stamps `shift_date` + `source` on new shifts (see §12 for implementation detail + the weekly-source limitation). Dates are timezone-correct for all states going forward; source breakdown becomes real (screenshot/csv/manual) for shifts logged from 0.17.161 on.
- **Phase 2 (Stripe revenue) / Phase 3 (Forms):** future. Phase 2 MUST be a server-side Edge Function (Stripe secret key never client-side).

### TIMEZONE — important
- Shifts store `ts` as **local midnight converted to UTC**, so a raw `ts::date` lands a day EARLY for Brisbane (UTC+10). All Ops date logic uses `(ts AT TIME ZONE 'Australia/Brisbane')::date` (or the hybrid with `shift_date`) so Ops agrees with what the app shows drivers.
- The app itself derives shift dates in the **driver's device timezone** (`localDateStr`). As of 0.17.161 the app stores this as `shift_date` and Ops reads it via the hybrid, so dates are now correct across timezones (WA UTC+8, and Oct–Apr daylight saving where NSW/VIC/etc. → UTC+11 while QLD stays +10). Pre-0.17.161 shifts use the Brisbane-backfilled `shift_date` (correct, since all history was Brisbane-logged).


---

_End of handoff. When in doubt: pull from GitHub raw, run the validation gate, verify at the destination, and let Jaden confirm version + byte size before pushing._
