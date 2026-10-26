// First, so settings saved under their old names are there to read.
import "./shared/lib/carryOver";
import { StrictMode } from "react";
import { createRoot } from "react-dom/client";
import { App } from "./app/App";
import { applyAppearance, savedAppearance } from "./features/settings/ui/useAppearance";
import { IS_MAC } from "./shared/lib/platform";
import "./styles/index.css";

// Windows-only styles (scrollbars, no bounce) key off this; see index.css.
document.documentElement.dataset.platform = IS_MAC ? "mac" : "windows";
// Before the first paint, so saved transparency never flashes the default.
applyAppearance(savedAppearance());

createRoot(document.getElementById("root")!).render(
  <StrictMode>
    <App />
  </StrictMode>,
);
