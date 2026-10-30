import { useQueryClient } from "@tanstack/react-query";
import { useState } from "react";
import { type CheckedClient, commands } from "../../../platform/tauri/bindings";
import { unwrap } from "../../../platform/tauri/ipc";
import { APP_NAME } from "../../../shared/lib/brand";
import { keys } from "../../../shared/lib/queries";
import { showToast } from "../../../shared/lib/toast";
import {
  CheckIcon,
  CopyIcon,
  ExternalIcon,
  FileIcon,
  TerminalIcon,
  ViewingIcon,
} from "../../../shared/ui/icons";
import {
  consoleUrl,
  currentStep,
  gcloudCommand,
  type GooglePath,
  type GuideStepId,
  makeProjectId,
  type Progress,
  stepsFor,
  toggleStep,
} from "../model/onboarding";
import { ClientDrop } from "./ClientDrop";
import { ConsoleSketch } from "./ConsoleSketch";
import { updateProgress } from "./progress";

type StepText = { title: string; body: React.ReactNode; copy?: [string, string][] };

const STEPS: Record<GuideStepId, StepText> = {
  project: {
    title: "Create a Google Cloud project",
    body: (
      <>
        A project is a free space in Google Cloud that holds your own sign-in for {APP_NAME}. No
        billing account or card is needed. Name it, leave the location as it is, and press{" "}
        <b>Create</b>.
      </>
    ),
    copy: [["Project name", APP_NAME]],
  },
  apis: {
    title: "Turn on the Gmail, People and Calendar APIs",
    body: (
      <>
        These let {APP_NAME} read and send your mail, suggest addresses from your contacts and
        answer invitations. The page lists all three: check the project at the top is the one you
        just made, then press <b>Next</b> and <b>Enable</b>.
      </>
    ),
  },
  branding: {
    title: "Set up the sign-in screen",
    body: (
      <>
        Press <b>Get started</b>. Give the app a name, pick your own email for support and contact,
        choose <b>External</b> as the audience, agree to Google’s policy and press <b>Create</b>.
        Only you will ever see this screen.
      </>
    ),
    copy: [
      ["App name", APP_NAME],
      ["Audience", "External"],
    ],
  },
  users: {
    title: "Add your Gmail addresses as test users",
    body: (
      <>
        Open <b>Audience</b>. Under <b>Test users</b>, press <b>Add users</b> and enter each Gmail
        address you’ll use in {APP_NAME}. Leave <b>Publishing status</b> on <b>Testing</b>, since
        publishing isn’t needed here. Google may ask you to sign in again about once a week.
      </>
    ),
  },
  client: {
    title: "Create and download OAuth credentials",
    body: (
      <>
        Choose <b>Desktop app</b> as the application type, name it and press <b>Create</b>. Then
        press <b>Download JSON</b> in the box that appears, straight away: Google shows the secret
        only this once.
      </>
    ),
    copy: [
      ["Application type", "Desktop app"],
      ["Name", APP_NAME],
    ],
  },
};

/**
 * Set up the user's own Google Cloud project: its OAuth client, by guided
 * steps, by Google's command-line tool, or from a file they already have.
 * Ends when Rust has a client.
 */
export function GoogleStage({
  progress,
  configured,
  projectId,
  onNext,
}: {
  progress: Progress;
  configured: boolean;
  /** The project of the client already in use, when its file says. */
  projectId: string | null;
  onNext: () => void;
}) {
  const qc = useQueryClient();
  const [client, setClient] = useState<CheckedClient | null>(null);
  const saved = (c: CheckedClient) => {
    setClient(c);
    void qc.invalidateQueries({ queryKey: keys.oauthSetup });
  };
  // Giving another file after one was saved (this time or before).
  const [replacing, setReplacing] = useState(false);
  const path = progress.path;

  if (client || (configured && !replacing))
    return (
      <Connected
        project={client?.projectId ?? projectId}
        onNext={onNext}
        onReplace={() => {
          setClient(null);
          setReplacing(true);
          if (path === null) updateProgress({ path: "have" });
        }}
      />
    );

  if (path === null) return <ChoosePath />;

  const steps = path === "have" ? [] : stepsFor(path);
  const current = currentStep(progress.done, path);
  return (
    <div className="space-y-5">
      <header>
        <h1 className="text-[22px] font-semibold tracking-tight">
          Set up your Google Cloud project
        </h1>
        <p className="mt-1 text-content/60">
          {path === "have"
            ? "Give the credentials file you downloaded from Google Cloud."
            : "About 10 minutes in Google Cloud, once. Each button opens the right page."}{" "}
          <button
            type="button"
            className="text-accent hover:underline"
            onClick={() => updateProgress({ path: null })}
          >
            Change
          </button>
        </p>
      </header>
      {path === "gcloud" && <GcloudCard progress={progress} />}
      {steps.length > 0 && (
        <ol className="space-y-2">
          {steps.map((step, i) => (
            <StepCard
              key={step}
              step={step}
              number={i + 1}
              open={step === current}
              done={progress.done.includes(step)}
              projectId={path === "gcloud" ? progress.projectId : null}
              onToggle={() => updateProgress({ done: toggleStep(progress.done, step) })}
            />
          ))}
        </ol>
      )}
      {(path === "have" || current === null || current === "client") && (
        <section className="onb-rise">
          {path !== "have" && (
            <h2 className="mb-2 text-[13px] font-medium text-content/70">
              Last, give the credentials to {APP_NAME}
            </h2>
          )}
          <ClientDrop onSaved={saved} />
        </section>
      )}
    </div>
  );
}

function ChoosePath() {
  const choose = (path: GooglePath) =>
    updateProgress({
      path,
      ...(path === "gcloud" ? { projectId: makeProjectId(APP_NAME, Math.random) } : {}),
    });
  const options: {
    path: GooglePath;
    icon: typeof FileIcon;
    title: string;
    detail: string;
    tag?: string;
  }[] = [
    {
      path: "guide",
      icon: ViewingIcon,
      title: "Guide me",
      detail: "Five short steps in Google Cloud, each with a button to the right page.",
      tag: "Recommended",
    },
    {
      path: "gcloud",
      icon: TerminalIcon,
      title: "Use Google’s command-line tool",
      detail: "For people who already have gcloud installed. One command does the first two steps.",
      tag: "Advanced",
    },
    {
      path: "have",
      icon: FileIcon,
      title: "I already have my OAuth credentials",
      detail:
        "You created a Desktop app OAuth client in Google Cloud and downloaded its credentials file.",
    },
  ];
  return (
    <div className="space-y-5">
      <header>
        <h1 className="text-[22px] font-semibold tracking-tight">
          Set up your Google Cloud project
        </h1>
        <p className="mt-1 text-content/60">
          {APP_NAME} signs in through a small project in your own Google Cloud account. It’s private
          to you, free (no card needed), and takes about 10 minutes, once. It covers all your Gmail
          accounts, work or personal.
        </p>
      </header>
      <div className="grid gap-2">
        {options.map(({ path, icon: Icon, title, detail, tag }, i) => (
          <button
            key={path}
            type="button"
            onClick={() => choose(path)}
            autoFocus={i === 0}
            className="group flex items-center gap-3.5 rounded-xl bg-selection-subtle p-4 text-left ring-1 ring-stroke transition-colors duration-150 outline-none hover:bg-selection focus-visible:ring-accent"
          >
            <span className="flex size-9 shrink-0 items-center justify-center rounded-lg bg-selection text-content/70">
              <Icon size={18} strokeWidth={1.6} />
            </span>
            <span>
              <span className="block font-medium">
                {title}
                {tag && (
                  <span
                    className={`ml-2 text-[11px] ${i === 0 ? "text-accent" : "text-content/45"}`}
                  >
                    {tag}
                  </span>
                )}
              </span>
              <span className="block text-[12px] text-content/55">{detail}</span>
            </span>
          </button>
        ))}
      </div>
    </div>
  );
}

function StepCard({
  step,
  number,
  open,
  done,
  projectId,
  onToggle,
}: {
  step: GuideStepId;
  number: number;
  open: boolean;
  done: boolean;
  projectId: string | null;
  onToggle: () => void;
}) {
  const text = STEPS[step];
  const [peek, setPeek] = useState(false);
  const shown = open || peek;
  return (
    <li
      className={`rounded-xl ring-1 transition-colors duration-200 ${
        open ? "bg-selection-subtle ring-stroke" : "ring-transparent"
      }`}
    >
      <button
        type="button"
        onClick={() => !open && setPeek((p) => !p)}
        aria-expanded={shown}
        className="flex w-full items-center gap-3 px-4 py-2.5 text-left"
      >
        <span
          className={`flex size-6 shrink-0 items-center justify-center rounded-full text-[12px] ${
            done ? "onb-tick bg-accent text-white" : "bg-selection text-content/60"
          }`}
        >
          {done ? <CheckIcon size={13} strokeWidth={2.5} /> : number}
        </span>
        <span className={`font-medium ${done && !shown ? "text-content/50" : ""}`}>
          {text.title}
        </span>
      </button>
      {shown && (
        <div className="onb-rise grid grid-cols-[1fr_18rem] gap-5 px-4 pt-1 pb-4 pl-13">
          <div className="space-y-3">
            <p className="text-[13px] leading-relaxed text-content/70">{text.body}</p>
            {text.copy && (
              <div className="flex flex-wrap gap-1.5">
                {text.copy.map(([label, value]) => (
                  <CopyChip key={label} label={label} value={value} />
                ))}
              </div>
            )}
            <div className="flex items-center gap-2 pt-1">
              <button
                type="button"
                onClick={() => void unwrap(commands.linkOpen(consoleUrl(step, projectId)))}
                className="flex items-center gap-1.5 rounded-md bg-accent px-3 py-1.5 text-[12px] font-medium text-white"
              >
                Open in Google Cloud <ExternalIcon size={13} />
              </button>
              <button
                type="button"
                onClick={() => {
                  setPeek(false);
                  onToggle();
                }}
                className="rounded-md px-3 py-1.5 text-[12px] text-content/70 hover:bg-selection"
              >
                {done ? "Not done yet" : "Done"}
              </button>
            </div>
          </div>
          <ConsoleSketch step={step} />
        </div>
      )}
    </li>
  );
}

function GcloudCard({ progress }: { progress: Progress }) {
  // Made when the path was chosen.
  const projectId = progress.projectId ?? "";
  const command = gcloudCommand(projectId, APP_NAME);
  return (
    <div className="space-y-2 rounded-xl bg-selection-subtle p-4 ring-1 ring-stroke">
      <p className="text-[13px] text-content/70">
        Open Terminal (Mac) or PowerShell (Windows) and run this, once you’ve signed in with{" "}
        <code>gcloud auth login</code>. It creates the project <code>{projectId}</code> and turns on
        the Gmail, People and Calendar APIs.
      </p>
      <div className="flex items-start gap-2 rounded-lg bg-background-base/60 p-2.5">
        <code className="selectable flex-1 font-mono text-[11px] leading-relaxed break-all">
          {command}
        </code>
        <CopyButton value={command} label="Copy command" />
      </div>
      <p className="text-[12px] text-content/50">
        Google’s tool can’t make the sign-in screen, add test users or create a Desktop client, so
        those are below, each opening on this project.
      </p>
    </div>
  );
}

/** A value Google asks for, copied with a click. */
function CopyChip({ label, value }: { label: string; value: string }) {
  return (
    <button
      type="button"
      onClick={() => copy(value)}
      title={`Copy “${value}”`}
      className="flex items-center gap-1.5 rounded-md bg-selection px-2 py-1 text-[12px] hover:bg-selection-strong"
    >
      <span className="text-content/50">{label}</span>
      <span>{value}</span>
      <CopyIcon size={12} className="text-content/45" />
    </button>
  );
}

function CopyButton({ value, label }: { value: string; label: string }) {
  return (
    <button
      type="button"
      aria-label={label}
      title={label}
      onClick={() => copy(value)}
      className="rounded-md p-1.5 text-content/60 hover:bg-selection hover:text-content"
    >
      <CopyIcon size={14} />
    </button>
  );
}

function copy(value: string) {
  void navigator.clipboard
    .writeText(value)
    .then(() => showToast({ message: "Copied" }))
    .catch(() => showToast({ tone: "error", message: "Couldn’t copy" }));
}

function Connected({
  project,
  onNext,
  onReplace,
}: {
  project: string | null;
  onNext: () => void;
  onReplace: () => void;
}) {
  return (
    <div className="flex flex-col items-center py-10 text-center">
      <span className="onb-tick flex size-14 items-center justify-center rounded-full bg-accent text-white">
        <CheckIcon size={28} strokeWidth={2.5} />
      </span>
      <h1 className="mt-5 text-[22px] font-semibold tracking-tight">Google Cloud is set up</h1>
      <p className="mt-1 text-content/60">
        {project
          ? `${APP_NAME} will sign in through your project “${project}”.`
          : `${APP_NAME} has your Google Cloud credentials.`}
      </p>
      <div className="mt-6 flex items-center gap-2">
        <button
          type="button"
          autoFocus
          onClick={onNext}
          className="rounded-md bg-accent px-4 py-2 font-medium text-white"
        >
          Add your Gmail accounts
        </button>
        <button
          type="button"
          onClick={onReplace}
          className="rounded-md px-3 py-2 text-content/60 hover:bg-selection"
        >
          Use a different file
        </button>
      </div>
    </div>
  );
}
