import { StrictMode } from "react";
import { createRoot } from "react-dom/client";
import { App } from "./app/App";
import { applyAppearance, savedAppearance } from "./features/settings/ui/useAppearance";
import "./styles/index.css";

// Before the first paint, so saved transparency never flashes the default.
applyAppearance(savedAppearance());

createRoot(document.getElementById("root")!).render(
  <StrictMode>
    <App />
  </StrictMode>,
);
