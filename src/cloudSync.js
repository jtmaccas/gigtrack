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
  console.log("[GigTrack] syncShift called for trip id:", trip.id);
  try {
    const { data: { user } } = await supabase.auth.getUser();
    if (!user) {
      console.warn("[GigTrack] syncShift: no auth user");
      return { ok: false, error: "no_auth" };
    }
    console.log("[GigTrack] syncShift: auth user", user.id);

    const row = tripToRow(trip, user.id);
    console.log("[GigTrack] syncShift: sending row", row);

    const { data, error } = await supabase
      .from("shifts")
      .upsert(row, { onConflict: "id" })
      .select();

    if (error) {
      console.error("[GigTrack] syncShift FAILED:", error.message, error);
      return { ok: false, error };
    }
    console.log("[GigTrack] syncShift OK:", data);
    return { ok: true };
  } catch (e) {
    console.error("[GigTrack] syncShift THREW:", e);
    return { ok: false, error: e };
  }
}

// Delete a shift from Supabase by id.
// RLS ensures the user can only delete their own shifts.
export async function deleteShiftCloud(id) {
  console.log("[GigTrack] deleteShiftCloud called for id:", id);
  try {
    const { data: { user } } = await supabase.auth.getUser();
    if (!user) {
      console.warn("[GigTrack] deleteShiftCloud: no auth user");
      return { ok: false, error: "no_auth" };
    }

    const { error } = await supabase
      .from("shifts")
      .delete()
      .eq("id", id);

    if (error) {
      console.error("[GigTrack] deleteShiftCloud FAILED:", error.message, error);
      return { ok: false, error };
    }
    console.log("[GigTrack] deleteShiftCloud OK");
    return { ok: true };
  } catch (e) {
    console.error("[GigTrack] deleteShiftCloud THREW:", e);
    return { ok: false, error: e };
  }
}
