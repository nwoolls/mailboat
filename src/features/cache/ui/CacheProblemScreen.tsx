import { useState } from "react";
import { commands, type StartupProblem } from "../../../platform/tauri/bindings";
import { APP_NAME } from "../../../shared/lib/brand";
import { PLATFORM } from "../../../shared/lib/platform";
import { problemWords } from "../model/cache";

/**
 * The whole window when the mail cache couldn't be opened: nothing else
 * loads. Try again starts the app again; Quit quits.
 */
export function CacheProblemScreen({ problem }: { problem: StartupProblem }) {
  const words = problemWords(problem, PLATFORM, APP_NAME);
  const [trying, setTrying] = useState(false);
  return (
    <div className="flex h-full flex-col bg-glass-panel">
      <div data-tauri-drag-region className="h-11 shrink-0" />
      <main className="flex flex-1 items-center justify-center px-6 pb-11">
        <section
          role="alert"
          aria-labelledby="cache-problem-title"
          className="max-w-md text-center"
        >
          <h1 id="cache-problem-title" className="text-[17px] font-semibold">
            {words.title}
          </h1>
          <p className="mt-2 text-[13px] text-content/75">{words.body}</p>
          <div className="mt-5 flex justify-center gap-2 text-[13px]">
            <button
              type="button"
              disabled={trying}
              onClick={() => {
                setTrying(true);
                void commands.startupTryAgain();
              }}
              className="rounded-md bg-accent px-4 py-2 font-medium text-white hover:brightness-110 disabled:opacity-60"
            >
              Try again
            </button>
            <button
              type="button"
              onClick={() => void commands.startupQuit()}
              className="rounded-md px-4 py-2 text-content/70 hover:bg-selection hover:text-content"
            >
              Quit
            </button>
          </div>
        </section>
      </main>
    </div>
  );
}
