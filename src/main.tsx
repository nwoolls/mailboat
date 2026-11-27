import { StrictMode } from "react";
import { createRoot } from "react-dom/client";
import { App } from "./app/App";
import { CacheProblemScreen } from "./features/cache/ui/CacheProblemScreen";
import { commands } from "./platform/tauri/bindings";
import { IS_TAURI } from "./platform/tauri/ipc";
import { applyAppearance, savedAppearance } from "./features/settings/ui/useAppearance";
import { APP_NAME } from "./shared/lib/brand";
import { PLATFORM } from "./shared/lib/platform";
import "./styles/index.css";

document.title = APP_NAME;
// Per-system styles (Windows' scrollbars, Linux's solid window) key off
// this; see index.css.
document.documentElement.dataset.platform = PLATFORM;
// Before the first paint, so saved transparency never flashes the default.
applyAppearance(savedAppearance());

const root = createRoot(document.getElementById("root")!);
// When the mail cache couldn't be opened (the keychain didn't answer, or
// another copy holds it), the window shows only that; nothing else loads.
void (IS_TAURI ? commands.startupProblem() : Promise.resolve(null)).then((problem) => {
  root.render(
    <StrictMode>{problem ? <CacheProblemScreen problem={problem} /> : <App />}</StrictMode>,
  );
});
