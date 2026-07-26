import React from "react";
import ReactDOM from "react-dom/client";
import App from "./App.jsx";
import { registerSW } from "virtual:pwa-register";
import { reportNeedRefresh } from "./pwaUpdate.js";

// Register the service worker. With registerType: "prompt", onNeedRefresh fires
// when a new version is waiting — we hand updateSW to the app so the banner's
// "Refresh" button can activate it. onOfflineReady intentionally unused (no toast).
//
// iOS PWA caveat: an installed home-screen app has no pull-to-refresh and iOS
// keeps it suspended rather than cold-starting, so the default "check on load"
// almost never runs. We add our own update checks below:
//   1. When the app returns to the foreground (visibilitychange) — the main one,
//      since users reopen the app far more often than they cold-start it.
//   2. On a periodic timer while the app is open (belt-and-braces; frozen while
//      backgrounded, which is why (1) does the heavy lifting).
const UPDATE_CHECK_MS = 60 * 60 * 1000; // hourly while open

const updateSW = registerSW({
  onNeedRefresh() {
    reportNeedRefresh(updateSW);
  },
  onRegisteredSW(swUrl, registration) {
    if (!registration) return;

    const check = () => {
      // registration.update() asks the browser to re-fetch the SW and, if it
      // changed, install it → fires onNeedRefresh above. Safe to call often.
      registration.update().catch(() => { /* offline or transient — ignore */ });
    };

    // Check shortly after launch (covers the cold-start case too).
    setTimeout(check, 3000);

    // Periodic check while the app is open/foregrounded.
    setInterval(() => {
      if (document.visibilityState === "visible") check();
    }, UPDATE_CHECK_MS);

    // The key iOS trigger: re-check every time the app is brought back to the
    // foreground. Debounced so rapid tab switches don't spam the network.
    let lastCheck = 0;
    document.addEventListener("visibilitychange", () => {
      if (document.visibilityState !== "visible") return;
      const now = Date.now();
      if (now - lastCheck < 60 * 1000) return; // at most once a minute
      lastCheck = now;
      check();
    });
  },
});

// Reset default page margins
const style = document.createElement("style");
style.textContent = `
  *, *::before, *::after { box-sizing: border-box; }
  html, body { margin: 0; padding: 0; height: 100%; }
  body { font-family: 'Inter', -apple-system, BlinkMacSystemFont, sans-serif; -webkit-tap-highlight-color: transparent; }
  #root { height: 100%; }
`;
document.head.appendChild(style);

ReactDOM.createRoot(document.getElementById("root")).render(
  <React.StrictMode>
    <App />
  </React.StrictMode>
);
