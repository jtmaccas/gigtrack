// Bridges the vite-plugin-pwa service-worker update signal into the React app.
// main.jsx registers the SW and calls setNeedRefresh(true) + stashes the
// updateSW function here when a new version is waiting. App.jsx subscribes via
// onNeedRefresh() to show the update banner, and calls applyUpdate() on tap.

let _updateSW = null;          // function from registerSW; activates the waiting SW
let _needRefresh = false;      // latched true once an update is detected
const _listeners = new Set();  // App.jsx subscribers

// Called by main.jsx when the SW reports a waiting update.
export function reportNeedRefresh(updateSW) {
  _updateSW = updateSW;
  _needRefresh = true;
  _listeners.forEach((cb) => {
    try { cb(true); } catch { /* ignore */ }
  });
}

// App.jsx subscribes to update notifications. Returns an unsubscribe fn.
// Fires immediately if an update was already detected before subscribing
// (covers the race where the SW updates before React mounts).
export function onNeedRefresh(cb) {
  _listeners.add(cb);
  if (_needRefresh) {
    try { cb(true); } catch { /* ignore */ }
  }
  return () => _listeners.delete(cb);
}

// Activates the waiting service worker. vite-plugin-pwa's updateSW(true)
// reloads the page once the new SW takes control.
export function applyUpdate() {
  if (_updateSW) _updateSW(true);
  else window.location.reload(); // fallback if registration didn't expose updateSW
}
