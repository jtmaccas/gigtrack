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

// One-shot reconciliation on app boot.
// Fetches cloud-side shift IDs for the current user, then pushes
// any local shifts that aren't yet in the cloud.
// Quiet on failure — will retry next boot.
export async function reconcileShifts(localTrips) {
  console.log("[GigTrack] reconcileShifts: starting…");
  try {
    const { data: { user } } = await supabase.auth.getUser();
    if (!user) {
      console.warn("[GigTrack] reconcileShifts: no auth user, skipping");
      return { ok: false, pushed: 0 };
    }

    // Fetch all cloud shift IDs for this user
    const { data: cloudRows, error } = await supabase
      .from("shifts")
      .select("id")
      .eq("user_id", user.id);

    if (error) {
      console.warn("[GigTrack] reconcileShifts: cloud query failed", error.message);
      return { ok: false, pushed: 0 };
    }

    const cloudIds = new Set((cloudRows || []).map(r => r.id));
    const toPush = (localTrips || []).filter(t => !cloudIds.has(t.id));

    if (toPush.length === 0) {
      console.log("[GigTrack] reconcileShifts: nothing to push, all up to date");
      return { ok: true, pushed: 0 };
    }

    console.log(`[GigTrack] reconcileShifts: pushing ${toPush.length} shifts…`);

    let pushed = 0;
    for (const trip of toPush) {
      const r = await syncShift(trip);
      if (r.ok) pushed++;
    }

    console.log(`[GigTrack] reconcileShifts: pushed ${pushed}/${toPush.length}`);
    return { ok: true, pushed };
  } catch (e) {
    console.warn("[GigTrack] reconcileShifts: threw", e.message);
    return { ok: false, pushed: 0 };
  }
}

// Maps a Supabase row back to a local trip object.
// Reverse of tripToRow — restores camelCase field names.
function rowToTrip(row) {
  return {
    id:           row.id,
    ts:           row.ts,
    platform:     row.platform || null,
    base:         row.base ?? 0,
    tip:          row.tip ?? 0,
    bonus:        row.bonus ?? 0,
    totalEarned:  row.total_earned ?? 0,
    tDel:         row.t_del ?? 0,
    tWait:        row.t_wait ?? 0,
    totalMin:     row.total_min ?? 0,
    totalHrs:     row.total_hrs ?? 0,
    activeMin:    row.active_min ?? null,
    activeMins:   row.active_mins ?? null,
    kmDel:        row.km_del ?? 0,
    kmWait:       row.km_wait ?? 0,
    totalKm:      row.total_km ?? 0,
    activeKm:     row.active_km ?? null,
    dels:         row.dels ?? 0,
    expenses:     row.expenses ?? 0,
    hourly:       row.hourly ?? null,
    perDel:       row.per_del ?? null,
    perKm:        row.per_km ?? null,
    ratioT:       row.ratio_t ?? null,
    ratioK:       row.ratio_k ?? null,
    score:        row.score ?? null,
    deduction:    row.deduction ?? null,
    notes:        row.notes ?? null,
    _synced:      true,
  };
}

// Fetch all shifts for the current user from Supabase.
// Returns an array of local-format trip objects, or [] on failure.
export async function fetchAllShifts() {
  console.log("[GigTrack] fetchAllShifts: starting…");
  try {
    const { data: { user } } = await supabase.auth.getUser();
    if (!user) {
      console.warn("[GigTrack] fetchAllShifts: no auth user");
      return [];
    }
    const { data, error } = await supabase
      .from("shifts")
      .select("*")
      .eq("user_id", user.id)
      .order("ts", { ascending: false });
    if (error) {
      console.warn("[GigTrack] fetchAllShifts error:", error.message);
      return [];
    }
    const trips = (data || []).map(rowToTrip);
    console.log(`[GigTrack] fetchAllShifts: ${trips.length} shifts`);
    return trips;
  } catch (e) {
    console.warn("[GigTrack] fetchAllShifts threw:", e.message);
    return [];
  }
}
