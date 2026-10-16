import { StrictMode } from "react";
import { createRoot } from "react-dom/client";
import { App } from "./app/App";
import { applySavedGlassBoost } from "./features/layout/ui/glass";
import "./styles/index.css";

applySavedGlassBoost();

createRoot(document.getElementById("root")!).render(
  <StrictMode>
    <App />
  </StrictMode>,
);
