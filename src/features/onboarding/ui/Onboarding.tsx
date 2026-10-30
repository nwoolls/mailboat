import { useState } from "react";
import type { Account, OAuthSetup } from "../../../platform/tauri/bindings";
import { APP_NAME } from "../../../shared/lib/brand";
import { CheckIcon } from "../../../shared/ui/icons";
import { nextStage, type Stage, STAGES } from "../model/onboarding";
import { AccountsStage } from "./AccountsStage";
import { GoogleStage } from "./GoogleStage";
import { onboarding, updateProgress } from "./progress";
import { WelcomeStage } from "./WelcomeStage";
import { YoursStage } from "./YoursStage";

const RAIL: { stage: Stage; label: string }[] = [
  { stage: "google", label: "Google Cloud" },
  { stage: "accounts", label: "Gmail accounts" },
  { stage: "yours", label: "Make it yours" },
];

/**
 * The first launch, shown instead of the mail until it's finished: the
 * welcome, then a rail of the stages on the left and one at a time on
 * the right. Progress is saved, so quitting halfway comes back to it.
 */
export function Onboarding({
  setup,
  accounts,
}: {
  setup: OAuthSetup | undefined;
  accounts: Account[];
}) {
  const progress = onboarding.use();
  const configured = setup?.configured ?? false;
  // The project in use: the client file's, or the one made by the command.
  const projectId = setup?.projectId ?? progress.projectId;
  // Whether the last move went back, so the stage slides in from the left.
  const [back, setBack] = useState(false);
  const stage = progress.stage;

  const go = (to: Stage) => {
    setBack(STAGES.indexOf(to) < STAGES.indexOf(stage));
    updateProgress({ stage: to });
  };
  const next = () => {
    const to = nextStage(stage, configured);
    if (to) go(to);
    else updateProgress({ finished: true });
  };
  // A stage can be opened once the ones before it are done.
  const reachable = (s: Stage) =>
    s === "google" || (s === "accounts" && configured) || (s === "yours" && accounts.length > 0);

  if (stage === "welcome")
    return (
      <div className="flex h-full flex-col bg-glass-panel">
        <div data-tauri-drag-region className="h-11 shrink-0" />
        <div key="welcome" className="onb-stage min-h-0 flex-1 px-3 pb-3">
          <WelcomeStage onNext={next} />
        </div>
      </div>
    );

  const at = RAIL.findIndex((r) => r.stage === stage);
  return (
    <div className="flex h-full bg-glass-panel">
      <nav aria-label="Setup" className="flex w-56 shrink-0 flex-col bg-glass-sidebar">
        <div data-tauri-drag-region className="h-11 shrink-0" />
        <div className="px-5 pt-4 pb-6 text-[13px] font-semibold text-content/70">
          Set up {APP_NAME}
        </div>
        <ol className="space-y-1 px-3">
          {RAIL.map((r, i) => {
            const done = i < at;
            const current = i === at;
            return (
              <li key={r.stage}>
                <button
                  type="button"
                  aria-current={current ? "step" : undefined}
                  disabled={!current && !reachable(r.stage)}
                  onClick={() => go(r.stage)}
                  className={`relative flex w-full items-center gap-3 rounded-lg px-2 py-2 text-left text-[13px] transition-colors duration-150 disabled:cursor-default ${
                    current
                      ? "bg-selection font-medium"
                      : "text-content/60 enabled:hover:bg-selection-subtle"
                  }`}
                >
                  <span
                    className={`flex size-5 shrink-0 items-center justify-center rounded-full text-[11px] ${
                      done
                        ? "bg-accent text-white"
                        : current
                          ? "bg-content text-background-base"
                          : "bg-selection-strong text-content/50"
                    }`}
                  >
                    {done ? <CheckIcon size={11} strokeWidth={3} /> : i + 1}
                  </span>
                  {r.label}
                </button>
              </li>
            );
          })}
        </ol>
      </nav>
      <main className="flex min-w-0 flex-1 flex-col">
        <div data-tauri-drag-region className="h-11 shrink-0" />
        <div className="min-h-0 flex-1 overflow-y-auto px-10 pb-10">
          <div
            key={stage}
            data-back={back || undefined}
            className="onb-stage mx-auto max-w-[44rem] pt-6"
          >
            {stage === "google" && (
              <GoogleStage
                progress={progress}
                configured={configured}
                projectId={setup?.projectId ?? null}
                onNext={next}
              />
            )}
            {stage === "accounts" && (
              <AccountsStage
                accounts={accounts}
                projectId={projectId}
                onNext={next}
                onFix={() => go("google")}
              />
            )}
            {stage === "yours" && <YoursStage onFinish={next} />}
          </div>
        </div>
      </main>
    </div>
  );
}
