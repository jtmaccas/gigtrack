import { supabase } from "./supabase.js";

// Maps a trip object from local format → Supabase row format.
// Keep this in sync with the `shifts` table schema in Supabase.
function tripToRow(trip, userId) {
  return {
    id:            trip.id,
    user_id:       userId,
    ts:            trip.ts,
    platform:      trip.platform || null,

    base:          trip.base ?? 0,
    tip:           trip.tip ?? 0,
    bonus:         trip.bonus ?? 0,
    total_earned:  trip.totalEarned ?? 0,

    t_del:         trip.tDel ?? 0,
    t_wait:        trip.tWait ?? 0,
    total_min:     trip.totalMin ?? 0,
    total_hrs:     trip.totalHrs ?? 0,
    active_min:    trip.activeMin ?? null,
    active_mins:   trip.activeMins ?? null,

    km_del:        trip.kmDel ?? 0,
    km_wait:       trip.kmWait ?? 0,
    total_km:      trip.totalKm ?? 0,
    active_km:     trip.activeKm ?? null,

    dels:          trip.dels ?? 0,
    expenses:      trip.expenses ?? 0,

    hourly:        trip.hourly ?? null,
    per_del:       trip.perDel ?? null,
    per_km:        trip.perKm ?? null,
    ratio_t:       trip.ratioT ?? null,
    ratio_k:       trip.ratioK ?? null,
    score:         trip.score ?? null,
    deduction:     trip.deduction ?? null,

    notes:         trip.notes ?? null,
  };
}

// Push a single shift to Supabase (upsert by id).
// Returns { ok: true } on success, { ok: false, error } on failure.
export async function syncShift(trip) {
  try {
    const { data: { user } } = await supabase.auth.getUser();
    if (!user) return { ok: false, error: "no_auth" };

    const row = tripToRow(trip, user.id);
    const { error } = await supabase
      .from("shifts")
      .upsert(row, { onConflict: "id" });

    if (error) {
      console.warn("[GigTrack] syncShift failed:", error.message);
      return { ok: false, error };
    }
    return { ok: true };
  } catch (e) {
    console.warn("[GigTrack] syncShift threw:", e.message);
    return { ok: false, error: e };
  }
}
