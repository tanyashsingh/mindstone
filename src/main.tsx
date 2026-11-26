import { StrictMode } from "react";
import { createRoot } from "react-dom/client";
import "@fontsource-variable/newsreader/opsz.css";
import "./styles.css";
import { App } from "./App";
import { ErrorBoundary } from "./components/ErrorBoundary";

createRoot(document.getElementById("root")!).render(
  <StrictMode>
    <ErrorBoundary label="Mindstone">
      <App />
    </ErrorBoundary>
  </StrictMode>,
);

// Installed web app (phones): cache the app for offline use. Not in the desktop app or during development.
if (import.meta.env.PROD && /^https?:$/.test(location.protocol) && "serviceWorker" in navigator) {
  void navigator.serviceWorker.register(`./sw.js?v=${encodeURIComponent(__APP_VERSION__)}`).catch((e) => console.warn("[Mindstone] offline support unavailable", e));
}
