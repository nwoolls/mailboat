import { APP_NAME } from "../../../shared/lib/brand";
import { useCacheResetNotice, useDismissCacheResetNotice } from "../../../shared/lib/queries";
import { PLATFORM } from "../../../shared/lib/platform";
import { resetWords } from "../model/cache";

/**
 * Shown once, after a start that set an unreadable mail cache aside and
 * began a new one because its key was gone from the keychain. Shown over
 * onboarding too, which is where a reset lands (the new cache has no
 * accounts), so it carries no sign-in button of its own.
 */
export function CacheResetNotice() {
  const shown = useCacheResetNotice();
  const dismiss = useDismissCacheResetNotice();
  if (!shown.data) return null;
  const words = resetWords(PLATFORM, APP_NAME);
  return (
    <section
      aria-label={words.title}
      role="status"
      className="notice-card w-[min(320px,calc(100vw-24px))] overflow-hidden rounded-xl"
    >
      <div className="px-3 py-2.5">
        <div className="text-[12px] font-semibold">{words.title}</div>
        <p className="mt-0.5 text-[12px] text-content/85">{words.body}</p>
        <div className="mt-2 flex justify-end">
          <button
            type="button"
            onClick={() => dismiss.mutate()}
            className="flex h-7 items-center rounded-md bg-accent px-2.5 text-[12px] font-medium text-white hover:brightness-110"
          >
            Got it
          </button>
        </div>
      </div>
    </section>
  );
}
