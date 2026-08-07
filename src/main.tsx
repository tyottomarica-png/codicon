import { StrictMode } from "react";
import { createRoot } from "react-dom/client";
import App from "./App";
import { Hud } from "./components/Hud";
import "./styles.css";

// The overlay is a second BrowserWindow onto the same bundle; ?view=hud picks which surface to
// mount so the packaged app stays a single-entry Vite build.
const view = new URLSearchParams(window.location.search).get("view");
if (view === "hud") document.body.classList.add("hud-body");

createRoot(document.getElementById("root")!).render(
  <StrictMode>
    {view === "hud" ? <Hud /> : <App />}
  </StrictMode>,
);
