import { useRef } from "react";
import { APP_NAME } from "../../../shared/lib/brand";
import { LockIcon } from "../../../shared/ui/icons";
import { BUILT_IN_ICON } from "../../settings/model/appIcon";
import { previewFor } from "../../settings/ui/AppIconPicker";
import { ScreensaverCanvas } from "../../screensaver/ui/ScreensaverCanvas";

/**
 * The first screen: the app's icon and name over the koi pond (the
 * Toybox's screensaver; the fish swim round the words), one line on
 * privacy, and one button.
 */
export function WelcomeStage({ onNext }: { onNext: () => void }) {
  const areaRef = useRef<HTMLDivElement>(null);
  const iconRef = useRef<HTMLDivElement>(null);
  const wordsRef = useRef<HTMLDivElement>(null);
  return (
    <div className="panel relative h-full overflow-hidden">
      <div ref={areaRef} className="absolute inset-0" />
      <ScreensaverCanvas
        sceneId="koi"
        palette="ocean"
        areaRef={areaRef}
        iconRef={iconRef}
        wordsRef={wordsRef}
        closing={false}
        onNod={() => {}}
      />
      <div className="relative flex h-full flex-col items-center justify-center px-8 text-center">
        <div ref={iconRef} className="onb-rise">
          <img
            src={previewFor(BUILT_IN_ICON)}
            alt=""
            draggable={false}
            className="size-24 drop-shadow-xl"
          />
        </div>
        <div ref={wordsRef} className="onb-rise mt-6" style={{ animationDelay: "120ms" }}>
          <h1 className="text-[32px] font-semibold tracking-tight">Welcome to {APP_NAME}</h1>
          <p className="mt-2 text-[15px] text-content/65">
            All your Gmail accounts, in one calm inbox.
          </p>
        </div>
        <div
          className="onb-rise mt-10 flex flex-col items-center gap-5"
          style={{ animationDelay: "240ms" }}
        >
          <button
            type="button"
            autoFocus
            onClick={onNext}
            className="rounded-lg bg-accent px-6 py-2.5 text-[15px] font-medium text-white shadow-lg"
          >
            Get started
          </button>
          <p className="flex max-w-sm items-start gap-2 text-left text-[12px] text-content/55">
            <LockIcon size={14} className="mt-px shrink-0" />
            Straight from Google to your computer. Nothing in between.
          </p>
        </div>
      </div>
    </div>
  );
}
