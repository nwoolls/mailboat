import { useState } from "react";
import {
  type Appearance,
  APPEARANCE_STORAGE_KEY,
  appearanceVars,
  parseAppearance,
} from "../model/appearance";

/** Puts the appearance on the page (CSS variables on the root element). */
export function applyAppearance(a: Appearance) {
  for (const [name, value] of Object.entries(appearanceVars(a)))
    document.documentElement.style.setProperty(name, value);
}

export function savedAppearance(): Appearance {
  return parseAppearance(localStorage.getItem(APPEARANCE_STORAGE_KEY));
}

/** The appearance settings; changes show at once and are remembered. */
export function useAppearance(): [Appearance, (next: Appearance) => void] {
  const [appearance, setAppearance] = useState(savedAppearance);
  const change = (next: Appearance) => {
    setAppearance(next);
    applyAppearance(next);
    localStorage.setItem(APPEARANCE_STORAGE_KEY, JSON.stringify(next));
  };
  return [appearance, change];
}
