import React from "react";
import ReactDOM from "react-dom/client";
import App from "./App.jsx";
import { registerSW } from "virtual:pwa-register";
import { reportNeedRefresh } from "./pwaUpdate.js";

// Register the service worker. With registerType: "prompt", onNeedRefresh fires
// when a new version is waiting — we hand updateSW to the app so the banner's
// "Refresh" button can activate it. onOfflineReady intentionally unused (no toast).
const updateSW = registerSW({
  onNeedRefresh() {
    reportNeedRefresh(updateSW);
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
