import { APP_NAME } from "../../../shared/lib/brand";
import { CheckIcon } from "../../../shared/ui/icons";
import type { GuideStepId } from "../model/onboarding";

/**
 * A drawing of a Google page, with the thing to press glowing. Drawn, not
 * screenshotted: Google redesigns these pages often, and a sketch of the
 * shape (a field, a choice, a button) stays true for longer and matches
 * the app's look.
 */
type Part =
  | { kind: "field"; label: string; value: string }
  | { kind: "choice"; label: string; options: string[]; chosen: string }
  | { kind: "list"; items: string[] }
  | { kind: "status"; label: string; value: string }
  | { kind: "note"; text: string }
  | { kind: "button"; label: string; glow?: boolean; quiet?: boolean };

const SKETCHES: Record<GuideStepId, { title: string; parts: Part[] }> = {
  project: {
    title: "New project",
    parts: [
      { kind: "field", label: "Project name", value: APP_NAME },
      { kind: "field", label: "Location", value: "No organisation" },
      { kind: "button", label: "Create", glow: true },
    ],
  },
  apis: {
    title: "Enable access to APIs",
    parts: [
      { kind: "list", items: ["Gmail API", "People API", "Google Calendar API"] },
      { kind: "button", label: "Enable", glow: true },
    ],
  },
  branding: {
    title: "Google Auth Platform · Get started",
    parts: [
      { kind: "field", label: "App name", value: APP_NAME },
      { kind: "field", label: "User support email", value: "you@gmail.com" },
      { kind: "choice", label: "Audience", options: ["Internal", "External"], chosen: "External" },
      { kind: "button", label: "Create", glow: true },
    ],
  },
  publish: {
    title: "Audience",
    parts: [
      { kind: "status", label: "Publishing status", value: "Testing" },
      { kind: "button", label: "Publish app", glow: true },
    ],
  },
  client: {
    title: "Create OAuth client ID",
    parts: [
      { kind: "field", label: "Application type", value: "Desktop app" },
      { kind: "field", label: "Name", value: APP_NAME },
      { kind: "note", text: "OAuth client created" },
      { kind: "button", label: "Download JSON", glow: true },
    ],
  },
};

export function ConsoleSketch({ step }: { step: GuideStepId }) {
  const sketch = SKETCHES[step];
  return <SketchWindow title={sketch.title} parts={sketch.parts} />;
}

/**
 * What Google shows at the first sign-in, drawn in advance: its warning
 * about an unverified app (your own), and the boxes to tick.
 */
export function SignInSketches() {
  return (
    <div className="grid grid-cols-2 gap-3">
      <SketchWindow
        title="Google hasn’t verified this app"
        parts={[
          { kind: "note", text: "The app is requesting access to sensitive info…" },
          { kind: "button", label: "Back to safety", quiet: true },
          { kind: "button", label: `Advanced → Go to ${APP_NAME} (unsafe)`, glow: true },
        ]}
      />
      <SketchWindow
        title={`${APP_NAME} wants access`}
        parts={[
          { kind: "list", items: ["Select all", "Read, compose and send email", "Contacts"] },
          { kind: "button", label: "Continue", glow: true },
        ]}
      />
    </div>
  );
}

function SketchWindow({ title, parts }: { title: string; parts: Part[] }) {
  return (
    <div
      aria-hidden
      className="overflow-hidden rounded-lg bg-background-raised text-[11px] ring-1 ring-stroke select-none"
    >
      <div className="flex items-center gap-1.5 border-b border-stroke px-2.5 py-1.5">
        <span className="size-1.5 rounded-full bg-content/20" />
        <span className="size-1.5 rounded-full bg-content/20" />
        <span className="size-1.5 rounded-full bg-content/20" />
        <span className="ml-1.5 truncate text-content/50">{title}</span>
      </div>
      <div className="space-y-2 p-3">
        {parts.map((part, i) => (
          <SketchPart key={i} part={part} />
        ))}
      </div>
    </div>
  );
}

function SketchPart({ part }: { part: Part }) {
  switch (part.kind) {
    case "field":
      return (
        <div>
          <div className="text-[10px] text-content/45">{part.label}</div>
          <div className="mt-0.5 truncate rounded border border-content/12 px-1.5 py-1 text-content/80">
            {part.value}
          </div>
        </div>
      );
    case "choice":
      return (
        <div>
          <div className="text-[10px] text-content/45">{part.label}</div>
          <div className="mt-1 flex gap-3">
            {part.options.map((o) => (
              <span key={o} className="flex items-center gap-1 text-content/70">
                <span
                  className={`size-2.5 rounded-full border ${
                    o === part.chosen ? "border-accent bg-accent" : "border-content/30"
                  }`}
                />
                {o}
              </span>
            ))}
          </div>
        </div>
      );
    case "list":
      return (
        <ul className="space-y-1">
          {part.items.map((item) => (
            <li key={item} className="flex items-center gap-1.5 text-content/75">
              <span className="flex size-3 items-center justify-center rounded-[3px] bg-accent text-white">
                <CheckIcon size={9} strokeWidth={3} />
              </span>
              {item}
            </li>
          ))}
        </ul>
      );
    case "status":
      return (
        <div className="flex items-center justify-between">
          <span className="text-content/55">{part.label}</span>
          <span className="rounded-full bg-warn/15 px-1.5 py-0.5 text-[10px] text-warn">
            {part.value}
          </span>
        </div>
      );
    case "note":
      return <div className="text-content/55">{part.text}</div>;
    case "button":
      return (
        <div className="flex justify-end">
          <span
            className={`rounded px-2 py-1 ${
              part.quiet
                ? "text-content/45"
                : `bg-accent font-medium text-white ${part.glow ? "onb-glow" : ""}`
            }`}
          >
            {part.label}
          </span>
        </div>
      );
  }
}
