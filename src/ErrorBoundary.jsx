import React from "react";

// App-wide error boundary. In a single large component, any uncaught render
// error would otherwise blank the whole screen with no recovery path. This
// catches it, shows a calm "reload" screen in the Daylight palette, and logs
// the error so it can be diagnosed. Styles are inline (not from App's CSS
// template) because the crash may be inside App itself.
export default class ErrorBoundary extends React.Component {
  constructor(props) {
    super(props);
    this.state = { hasError: false };
  }

  static getDerivedStateFromError() {
    return { hasError: true };
  }

  componentDidCatch(error, info) {
    // Log for diagnosis. Kept intentionally minimal — no user data.
    console.error("[GigTrack] Uncaught render error:", error, info?.componentStack);
  }

  handleReload = () => {
    // Full reload — re-runs boot/auth and rehydrates from Supabase. Local data
    // is untouched; this only recovers the UI from a bad render.
    window.location.reload();
  };

  render() {
    if (!this.state.hasError) return this.props.children;

    const dark = typeof window !== "undefined" &&
      window.matchMedia && window.matchMedia("(prefers-color-scheme: dark)").matches;
    const bg = dark ? "#1B1815" : "#FBF7F1";
    const text = dark ? "#F5EFE7" : "#1B1A17";
    const muted = dark ? "#A89E90" : "#8A8071";
    const coral = "#F0562E";

    return (
      <div style={{
        minHeight: "100vh", display: "flex", flexDirection: "column",
        alignItems: "center", justifyContent: "center", padding: "32px 26px",
        background: bg, fontFamily: "'Inter', -apple-system, sans-serif", textAlign: "center",
      }}>
        <div style={{ fontSize: "40px", marginBottom: "16px" }}>🛠️</div>
        <div style={{ fontSize: "17px", fontWeight: 800, color: text, marginBottom: "8px" }}>
          Something went wrong
        </div>
        <div style={{ fontSize: "13px", color: muted, lineHeight: 1.55, maxWidth: "300px", marginBottom: "26px" }}>
          GigTrack hit an unexpected error. Your data is safe — reloading usually fixes it.
        </div>
        <button
          onClick={this.handleReload}
          style={{
            padding: "14px 28px", background: coral, color: "#FFFFFF",
            border: "none", borderRadius: "13px", cursor: "pointer",
            fontFamily: "'Inter', sans-serif", fontSize: "14px", fontWeight: 700,
          }}
        >Reload GigTrack</button>
      </div>
    );
  }
}
