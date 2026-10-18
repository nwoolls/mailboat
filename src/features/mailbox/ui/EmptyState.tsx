import { useCallback, useEffect, useRef, useState } from "react";
import {
  ArchiveIcon,
  DraftIcon,
  type IconProps,
  ImportantIcon,
  LabelIcon,
  SearchIcon,
  SentIcon,
  SpamIcon,
  StarIcon,
  ThumbsUpIcon,
  TrashIcon,
} from "../../../shared/ui/icons";
import type { EmptyIcon, EmptyState as EmptyStateModel } from "../model/emptyState";
import {
  approach,
  GLOW_FOLLOW_SECONDS,
  GLOW_LINGER_SECONDS,
  GLOW_RETURN_SECONDS,
} from "../model/glow";
import { useFeatureFlags } from "../../../shared/lib/featureFlags";
import { SandScreensaver, useScreensaver } from "./SandScreensaver";

const ICONS: Record<EmptyIcon, (props: IconProps) => React.ReactNode> = {
  caughtUp: ThumbsUpIcon,
  search: SearchIcon,
  star: StarIcon,
  important: ImportantIcon,
  sent: SentIcon,
  draft: DraftIcon,
  spam: SpamIcon,
  trash: TrashIcon,
  archive: ArchiveIcon,
  label: LabelIcon,
};

/**
 * What an empty list shows: an icon, a line of copy and a drifting glow.
 * The glow spans the whole list card (title row included, behind its text)
 * and rests behind the icon. With the pointer anywhere over the card it
 * centres on the cursor; when the pointer leaves it lingers there a moment,
 * then eases back to its path.
 *
 * The icon sits exactly at the centre and the words hang below it, so a
 * longer or shorter message never moves the icon. The rise plays once,
 * when the list turns empty; switching to another empty view (Drafts to a
 * label) only cross-fades the glyph and words in place. `swapKey` names
 * what's shown, so typing a search doesn't count as a change.
 *
 * After a minute without input, sand pours over it (`SandScreensaver`),
 * heaping on the icon and words; when the icon's heap grows, it shrugs it
 * off with a nod. The glow fades out while the sand plays. Both are behind
 * feature flags (Settings → Advanced).
 */
export function EmptyState({ state, swapKey }: { state: EmptyStateModel; swapKey: string }) {
  const Icon = ICONS[state.icon];
  const flags = useFeatureFlags();
  const { anchorRef, pullRef, glowRef } = useGlowPull(flags.emptyGlow);
  const iconRef = useRef<HTMLDivElement>(null);
  const wordsRef = useRef<HTMLDivElement>(null);
  const screensaver = useScreensaver(flags.sandscape);
  const [shrugs, setShrugs] = useState(0);
  const shrug = useCallback(() => setShrugs((n) => n + 1), []);
  const iconMotion =
    shrugs > 0 ? "empty-shrug" : state.icon === "caughtUp" ? "empty-nod" : "empty-swap";
  return (
    <div ref={anchorRef} className="flex flex-1 items-center justify-center px-8">
      {/* Positioned against the card (.panel), not this box, so it can
          reach under the title row; z-index -1 keeps it behind text. */}
      {flags.emptyGlow && (
        <div
          ref={pullRef}
          aria-hidden
          className="empty-glow-pull"
          data-screensaver={screensaver !== "off" || undefined}
        >
          <div ref={glowRef} className="empty-glow" />
        </div>
      )}
      {screensaver !== "off" && (
        <SandScreensaver
          areaRef={anchorRef}
          iconRef={iconRef}
          wordsRef={wordsRef}
          closing={screensaver === "closing"}
          onShrug={shrug}
        />
      )}
      <div className="empty-rise relative flex flex-col items-center text-center">
        <div
          ref={iconRef}
          className="flex h-14 w-14 items-center justify-center rounded-2xl bg-selection-subtle text-content/80 ring-1 ring-stroke"
        >
          <span key={`${swapKey}:${shrugs}`} className={iconMotion}>
            <Icon size={26} strokeWidth={1.5} />
          </span>
        </div>
        <div
          ref={wordsRef}
          key={swapKey}
          className="empty-swap absolute top-full left-1/2 mt-4 w-80 max-w-[80vw] -translate-x-1/2"
        >
          <p className="text-[15px] font-semibold">{state.title}</p>
          {state.detail && <p className="mt-1 text-content/60">{state.detail}</p>}
        </div>
      </div>
    </div>
  );
}

/**
 * Drives the glow from pointer events on the enclosing card. Once per
 * animation frame it moves the glow's wrapper towards its target: while
 * the pointer is over the card, the pointer minus the drift animation's
 * current offset (so the glow centres on the cursor and only its gentle
 * size change carries on). After the pointer leaves it keeps that target
 * for GLOW_LINGER_SECONDS, then aims for zero, gliding back onto its usual
 * path, after which the loop stops. Pointer moves only update the target,
 * so nothing re-renders and no transition restarts.
 */
function useGlowPull(enabled: boolean) {
  const anchorRef = useRef<HTMLDivElement>(null);
  const pullRef = useRef<HTMLDivElement>(null);
  const glowRef = useRef<HTMLDivElement>(null);

  useEffect(() => {
    const anchor = anchorRef.current;
    const pull = pullRef.current;
    const card = anchor?.closest<HTMLElement>(".panel");
    if (!enabled || !anchor || !pull || !card) return;
    const m = { x: 0, y: 0, cx: 0, cy: 0, attracted: false, leftAt: 0, frame: 0, last: 0 };

    // Rest the glow behind the icon, which sits below the card's centre
    // by half the title row's height.
    const placeAtRest = () => {
      const a = anchor.getBoundingClientRect();
      const c = card.getBoundingClientRect();
      pull.style.setProperty("--glow-rest-x", `${a.left + a.width / 2 - (c.left + c.width / 2)}px`);
      pull.style.setProperty("--glow-rest-y", `${a.top + a.height / 2 - (c.top + c.height / 2)}px`);
    };
    placeAtRest();
    const resize = new ResizeObserver(placeAtRest);
    resize.observe(card);

    const tick = (now: number) => {
      const dt = Math.min((now - m.last) / 1000, 0.1);
      m.last = now;
      const lingering = !m.attracted && now - m.leftAt < GLOW_LINGER_SECONDS * 1000;
      if (!m.attracted && !lingering) pull.dataset.attracted = "false";
      let tx = 0;
      let ty = 0;
      if (m.attracted || lingering) {
        const drift = driftOffset(glowRef.current);
        tx = m.cx - drift.x;
        ty = m.cy - drift.y;
      }
      const tau = m.attracted || lingering ? GLOW_FOLLOW_SECONDS : GLOW_RETURN_SECONDS;
      m.x = approach(m.x, tx, dt, tau);
      m.y = approach(m.y, ty, dt, tau);
      pull.style.transform = `translate3d(${m.x}px, ${m.y}px, 0)`;
      // While attracted the drift keeps moving, so keep following.
      const settled = !m.attracted && !lingering && Math.abs(m.x) < 0.5 && Math.abs(m.y) < 0.5;
      m.frame = settled ? 0 : requestAnimationFrame(tick);
    };
    const run = () => {
      if (m.frame) return;
      m.last = performance.now();
      m.frame = requestAnimationFrame(tick);
    };

    const onMove = (e: PointerEvent) => {
      if (window.matchMedia("(prefers-reduced-motion: reduce)").matches) return;
      // Relative to where the glow rests (behind the icon).
      const a = anchor.getBoundingClientRect();
      m.cx = e.clientX - (a.left + a.width / 2);
      m.cy = e.clientY - (a.top + a.height / 2);
      m.attracted = true;
      pull.dataset.attracted = "true";
      run();
    };
    const onLeave = () => {
      m.attracted = false;
      m.leftAt = performance.now();
      run();
    };
    card.addEventListener("pointermove", onMove);
    card.addEventListener("pointerleave", onLeave);
    return () => {
      card.removeEventListener("pointermove", onMove);
      card.removeEventListener("pointerleave", onLeave);
      resize.disconnect();
      cancelAnimationFrame(m.frame);
    };
  }, [enabled]);

  return { anchorRef, pullRef, glowRef };
}

/** Where the drift animation has the glow right now, from its centre. */
function driftOffset(glow: HTMLElement | null): { x: number; y: number } {
  if (!glow) return { x: 0, y: 0 };
  const transform = getComputedStyle(glow).transform;
  if (!transform || transform === "none") return { x: 0, y: 0 };
  const m = new DOMMatrixReadOnly(transform);
  return { x: m.m41, y: m.m42 };
}
