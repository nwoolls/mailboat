import { useState } from "react";
import { GLASS_BOOST_STORAGE_KEY, glassScale, parseGlassBoost } from "../model/glass";

/** Sets the factor the stylesheet multiplies every glass tint by. */
export function applyGlassBoost(boost: number) {
  document.documentElement.style.setProperty("--glass-scale", String(glassScale(boost)));
}

/** Applies the saved transparency; called once at startup. */
export function applySavedGlassBoost() {
  applyGlassBoost(parseGlassBoost(localStorage.getItem(GLASS_BOOST_STORAGE_KEY)));
}

/** The transparency setting, remembered across launches. */
export function useGlassBoost(): [number, (boost: number) => void] {
  const [boost, setBoost] = useState(() =>
    parseGlassBoost(localStorage.getItem(GLASS_BOOST_STORAGE_KEY)),
  );
  const set = (next: number) => {
    setBoost(next);
    localStorage.setItem(GLASS_BOOST_STORAGE_KEY, String(next));
    applyGlassBoost(next);
  };
  return [boost, set];
}
