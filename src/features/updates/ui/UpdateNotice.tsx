import { APP_NAME } from "../../../shared/lib/brand";
import { notesPreview, percent, showNotice } from "../model/update";
import { installUpdate, putOffUpdate, usePutOffUpdates, useUpdateState } from "./updateStore";

/**
 * A new version, in a glass notice at the top right (as the sign-in code and
 * signed-out notices): what it is, and "Install and restart" or "Later".
 * Never modal, and nothing is installed without the click. "Later" puts it
 * off until the next launch.
 */
export function UpdateNotice() {
  const state = useUpdateState();
  const putOff = usePutOffUpdates();
  if (!showNotice(state, putOff)) return null;
  if (state.kind !== "available" && state.kind !== "installing") return null;
  const notes = notesPreview(state.notes);

  return (
    <section
      aria-label="Update available"
      role="status"
      className="notice-card w-[min(320px,calc(100vw-24px))] overflow-hidden rounded-xl"
    >
      <div className="px-3 py-2.5">
        <div className="text-[12px] font-semibold">Update available</div>
        <div className="text-[12px] text-content/85">
          {APP_NAME} {state.version}
        </div>
        {notes && (
          <p className="selectable mt-1 text-[11px] whitespace-pre-line text-content/50">{notes}</p>
        )}
        {state.kind === "installing" ? <Progress state={state} /> : <Actions state={state} />}
      </div>
    </section>
  );
}

function Actions({ state }: { state: { version: string; error?: string } }) {
  return (
    <>
      {state.error && <p className="selectable mt-2 text-[11px] text-danger">{state.error}</p>}
      <div className="mt-2 flex items-center gap-2">
        <button
          type="button"
          onClick={() => void installUpdate()}
          className="flex h-7 items-center rounded-md bg-accent px-2.5 text-[12px] font-medium text-white hover:brightness-110"
        >
          Install and restart
        </button>
        <button
          type="button"
          onClick={() => putOffUpdate(state.version)}
          className="h-7 rounded-md px-2 text-[12px] text-content/60 hover:bg-selection hover:text-content"
        >
          Later
        </button>
      </div>
    </>
  );
}

function Progress({ state }: { state: { downloaded: number; total: number | null } }) {
  const done = percent(state.downloaded, state.total);
  return (
    <div className="mt-2">
      <div
        role="progressbar"
        aria-label="Downloading the update"
        aria-valuemin={0}
        aria-valuemax={100}
        aria-valuenow={done ?? undefined}
        className="h-1 overflow-hidden rounded-full bg-content/10"
      >
        <div
          className={`h-full rounded-full bg-accent ${done === null ? "w-1/3 animate-pulse" : ""}`}
          style={done === null ? undefined : { width: `${done}%` }}
        />
      </div>
      <p className="mt-1 text-[11px] text-content/50">
        {done === null ? "Downloading…" : `Downloading… ${done}%`} The app restarts when it’s done.
      </p>
    </div>
  );
}
