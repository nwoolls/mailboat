import { localStore } from "../../../shared/lib/localStore";
import { parseTextSize, TEXT_SIZE_STORAGE_KEY, textZoom } from "../model/textSize";

/** The chosen text size, shared by the window. */
export const textSize = localStore(TEXT_SIZE_STORAGE_KEY, parseTextSize);

/** The zoom for the chosen text size; re-renders when it changes. */
export function useTextZoom(): number {
  return textZoom(textSize.use());
}
