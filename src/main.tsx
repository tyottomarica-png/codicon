import { StrictMode } from "react";
import { createRoot } from "react-dom/client";
import App from "./App";
import { Hud } from "./components/Hud";
import { WheelOverlay } from "./components/WheelOverlay";
import "./styles.css";

// The overlays are extra BrowserWindows onto the same bundle; ?view= picks which surface to mount
// so the packaged app stays a single-entry Vite build.
const view = new URLSearchParams(window.location.search).get("view");
if (view === "hud") document.body.classList.add("hud-body");
if (view === "wheel") document.body.classList.add("wheel-body");

createRoot(document.getElementById("root")!).render(
  <StrictMode>
    {view === "hud" ? <Hud /> : view === "wheel" ? <WheelOverlay /> : <App />}
  </StrictMode>,
);
