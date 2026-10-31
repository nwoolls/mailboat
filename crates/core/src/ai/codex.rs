//! ChatGPT, through OpenAI's `codex` command-line tool, signed in with the
//! owner's ChatGPT account (`codex login`). The app never sees a token.
//!
//! Codex is a coding agent, so each request turns its tools off (shell,
//! web search, plugins, browser…) through `-c features.…=false`, which
//! newer versions ignore for names they don't know (`--disable` would
//! fail instead), and runs read-only in an empty folder. Its `--json`
//! output doesn't stream text, so the answer arrives whole.
//!
//! Models come from Codex's own catalog (`codex debug models`). Quick
//! requests (summaries, the writing assistant's chips) use the catalog's
//! fast model with no reasoning, faster as the default model
//! with the same results in testing; writing uses the owner's choice.

use std::ops::ControlFlow;
use std::path::Path;

use serde::{Deserialize, Serialize};
use serde_json::Value;
use specta::Type;

use super::{process, Answer, Prompt, ProviderState, Quality, Usage};
use crate::error::{CoreError, Result};

/// Codex tools that could act on the Mac or the web: always turned off,
/// even if `codex features list` stops listing them. Every other switch
/// Codex reports on is turned off too (`switches_off`).
const TOOLS_OFF: &[&str] = &[
    "shell_tool",
    "unified_exec",
    "apps",
    "plugins",
    "multi_agent",
    "browser_use",
    "browser_use_external",
    "computer_use",
    "in_app_browser",
    "image_generation",
    "view_image",
    "hooks",
    "skill_search",
    "tool_suggest",
    "goals",
    "memories",
];

/// Which model and reasoning effort a request runs with.
#[derive(Debug, Clone, PartialEq, Eq)]
pub struct Choice {
    /// `None`: Codex's default model.
    pub model: Option<String>,
    pub effort: &'static str,
}

/// The models the app uses: the fast one for quick requests (from the
/// catalog) and the owner's choice for writing (Settings → AI).
#[derive(Debug, Clone, Default, PartialEq, Eq)]
pub struct Models {
    pub fast: Option<String>,
    pub writing: Option<String>,
    /// Unreviewed switches the owner chose to use ChatGPT with anyway
    /// (Settings → AI), until the app quits.
    pub accepted: Vec<String>,
}

/// The model and effort for a request. Quick requests on the fast model
/// skip reasoning ("none"), which the default model refuses, so it keeps
/// "low"; `ask` falls back to "low" if a model refuses "none".
pub fn choice(quality: Quality, models: &Models) -> Choice {
    match quality {
        Quality::Fast => match &models.fast {
            Some(m) => Choice {
                model: Some(m.clone()),
                effort: "none",
            },
            None => Choice {
                model: None,
                effort: "low",
            },
        },
        Quality::Best => Choice {
            model: models.writing.clone(),
            effort: "medium",
        },
        Quality::Strongest => Choice {
            model: models.writing.clone(),
            effort: "high",
        },
    }
}

/// Codex's switches (`codex features list`): each name and whether it's
/// on. Lines are "name  stage  true|false"; the stage can be two words.
/// None if any line isn't one (a changed format), a name repeats, or
/// there are none: a switch it couldn't read would go unchecked (code
/// review R6-04).
pub fn parse_switches(stdout: &str) -> Option<Vec<(String, bool)>> {
    let mut found: Vec<(String, bool)> = Vec::new();
    for line in stdout.lines().filter(|l| !l.trim().is_empty()) {
        let words: Vec<&str> = line.split_whitespace().collect();
        let on = match *words.last()? {
            "true" => true,
            "false" => false,
            _ => return None,
        };
        let name = words[0];
        let named = name
            .chars()
            .all(|c| c.is_ascii_lowercase() || c.is_ascii_digit() || c == '_' || c == '.');
        if words.len() < 3 || !named || found.iter().any(|(n, _)| n == name) {
            return None;
        }
        found.push((name.to_string(), on));
    }
    (!found.is_empty()).then_some(found)
}

/// Codex's switches as it reports them, with `overrides` (`-c` settings)
/// applied. An error when Codex can't say, so a request never goes ahead
/// unchecked.
pub async fn switches(program: &Path, overrides: &[String]) -> Result<Vec<(String, bool)>> {
    let mut args: Vec<&str> = vec!["features", "list"];
    for o in overrides {
        args.push("-c");
        args.push(o);
    }
    let (ok, stdout, _) = process::run_quick_with(program, &args, process::Env::Minimal).await?;
    match parse_switches(&stdout) {
        Some(found) if ok => Ok(found),
        _ => Err(CoreError::Ai(
            "Couldn't check ChatGPT's Codex switches.".into(),
        )),
    }
}

/// Every switch to turn off for a request: the known tool switches and
/// every switch Codex reports, on or off, so one added in an update is
/// off too. Off ones as well because `features list` reads the owner's
/// Codex config and `exec` (with `--ignore-user-config`) doesn't: a switch
/// their config turns off would otherwise be back at its default, on, in
/// the request (code review R6-02).
pub fn switches_off(reported: &[(String, bool)]) -> Vec<String> {
    let mut off: Vec<String> = TOOLS_OFF.iter().map(|t| t.to_string()).collect();
    for (name, _) in reported {
        if !off.contains(name) {
            off.push(name.clone());
        }
    }
    off
}

/// Turns every switch off and checks Codex agrees: the switches still on
/// that the review doesn't list (`codex_review::unreviewed`), with the
/// switches to turn off. An error when Codex can't say.
async fn checked(program: &Path) -> Result<(Vec<String>, Vec<String>)> {
    let off = switches_off(&switches(program, &[]).await?);
    let still_on: Vec<String> = switches(program, &overrides(&off))
        .await?
        .into_iter()
        .filter_map(|(name, on)| on.then_some(name))
        .collect();
    Ok((super::codex_review::unreviewed(&still_on), off))
}

/// Codex's switches as reviewed: those still on after being turned off
/// that the review doesn't list. Empty when all is as reviewed. For
/// Settings → AI; each request checks again (`run`).
pub async fn check(program: &Path) -> Result<Vec<String>> {
    Ok(checked(program).await?.0)
}

/// What a request says when ChatGPT is paused.
fn paused(unreviewed: &[String]) -> CoreError {
    CoreError::Ai(format!(
        "ChatGPT is paused: Codex has switches that haven't been reviewed and stay on ({}). See Settings → AI.",
        unreviewed.join(", ")
    ))
}

/// The `-c` settings that turn `off` off.
pub fn overrides(off: &[String]) -> Vec<String> {
    off.iter().map(|t| format!("features.{t}=false")).collect()
}

/// `codex exec`'s arguments for a request, with the switches in `off`
/// turned off.
pub fn args(choice: &Choice, off: &[String]) -> Vec<String> {
    let effort = choice.effort;
    let mut a: Vec<String> = [
        "exec",
        "--json",
        "--ephemeral",
        "--skip-git-repo-check",
        "--sandbox",
        "read-only",
        "--ignore-user-config",
        "--ignore-rules",
    ]
    .into_iter()
    .map(String::from)
    .collect();
    for o in overrides(off) {
        a.push("-c".into());
        a.push(o);
    }
    a.push("-c".into());
    a.push("web_search=\"disabled\"".into());
    a.push("-c".into());
    a.push(format!("model_reasoning_effort=\"{effort}\""));
    if let Some(model) = &choice.model {
        a.push("-m".into());
        a.push(model.clone());
    }
    // The prompt comes on stdin.
    a.push("-".into());
    a
}

/// Codex has no separate system prompt, so the instructions lead.
pub fn stdin(prompt: &Prompt) -> String {
    format!(
        "{}\n\nAnswer with the requested text only. You have no tools; don't offer to run anything.\n\n---\n\n{}",
        prompt.instructions, prompt.input
    )
}

pub async fn status(program: &Path) -> ProviderState {
    match process::run_quick(program, &["login", "status"]).await {
        Ok((ok, stdout, stderr)) => parse_status(ok, &format!("{stdout}\n{stderr}")),
        Err(e) => ProviderState::Unavailable {
            reason: e.to_string(),
        },
    }
}

pub fn parse_status(ok: bool, output: &str) -> ProviderState {
    if ok && output.contains("Logged in") {
        // "Logged in using ChatGPT" or "… using an API key".
        let how = output
            .lines()
            .find(|l| l.contains("Logged in"))
            .and_then(|l| l.split("using").nth(1))
            .map(|s| s.trim().to_string());
        ProviderState::Ready { account: how }
    } else {
        ProviderState::SignedOut
    }
}

/// Opens the browser to sign in with a ChatGPT account.
pub const LOGIN_ARGS: &[&str] = &["login"];

#[derive(Default)]
pub struct Reader {
    pub answer: Answer,
    error: Option<String>,
    /// The turn is over; what's left is Codex exiting.
    pub done: bool,
}

impl Reader {
    pub fn line(&mut self, line: &str) {
        let Ok(v) = serde_json::from_str::<Value>(line) else {
            return;
        };
        match v["type"].as_str().unwrap_or_default() {
            "item.completed" if v["item"]["type"] == "agent_message" => {
                // The last message is the answer (an agent may say what
                // it's about to do first).
                if let Some(t) = v["item"]["text"].as_str() {
                    self.answer.text = t.trim().to_string();
                }
            }
            "turn.completed" => {
                self.done = true;
                let u = &v["usage"];
                self.answer.usage = Usage {
                    input_tokens: u["input_tokens"].as_u64().unwrap_or(0),
                    output_tokens: u["output_tokens"].as_u64().unwrap_or(0)
                        + u["reasoning_output_tokens"].as_u64().unwrap_or(0),
                    cost_usd: None,
                };
            }
            "turn.failed" => {
                self.error = v["error"]["message"].as_str().map(String::from);
            }
            "error" => {
                self.error = v["message"].as_str().map(String::from);
            }
            _ => {}
        }
    }

    pub fn finish(self, exit: process::Exit) -> Result<Answer> {
        // An answer needs a completed turn (R7-01, R8 question 3): text
        // before a failure, or before Codex stopped without finishing, is
        // not one. A completed turn counts whatever came before it (Codex
        // also reports passing problems, like falling back from
        // WebSockets).
        if self.answer.text.is_empty() || !self.done {
            let raw = self.error.unwrap_or(exit.stderr);
            let lower = raw.to_lowercase();
            return Err(CoreError::Ai(
                if lower.contains("login") || lower.contains("401") || lower.contains("auth") {
                    "ChatGPT needs you to sign in again (Settings → AI).".into()
                } else if raw.trim().is_empty() {
                    "ChatGPT failed without saying why.".into()
                } else {
                    format!("ChatGPT failed: {}", raw.trim())
                },
            ));
        }
        Ok(self.answer)
    }
}

pub async fn ask(
    program: &Path,
    prompt: &Prompt,
    models: &Models,
    on_text: &(dyn Fn(&str) + Send + Sync),
) -> Result<Answer> {
    let mut chosen = choice(prompt.quality, models);
    let answer = match run(program, prompt, &chosen, &models.accepted).await {
        // A model that doesn't take "none" (a newer fast model, say)
        // gets one more try with "low".
        Err(CoreError::Ai(m)) if chosen.effort == "none" && m.contains("Unsupported value") => {
            chosen.effort = "low";
            run(program, prompt, &chosen, &models.accepted).await?
        }
        other => other?,
    };
    on_text(&answer.text);
    Ok(answer)
}

async fn run(
    program: &Path,
    prompt: &Prompt,
    chosen: &Choice,
    accepted: &[String],
) -> Result<Answer> {
    // Asked each time (two quick `features list`s, about 20ms), so a
    // switch an update added is off from the first request after it, and
    // one that won't turn off pauses ChatGPT before anything is sent.
    // A model the review lists as refused for ChatGPT accounts is never
    // asked for, whatever Codex is signed in with: its tools were never
    // reviewed (R8 questions 1–2).
    if let Some(model) = &chosen.model {
        if super::codex_review::review().refused_models.contains(model) {
            return Err(CoreError::Ai(format!(
                "ChatGPT's model {model} hasn't been reviewed for use here; choose another in Settings → AI."
            )));
        }
    }
    let (unreviewed, off) = checked(program).await?;
    if !unreviewed.iter().all(|u| accepted.contains(u)) {
        return Err(paused(&unreviewed));
    }
    let mut reader = Reader::default();
    let args = args(chosen, &off);
    let exit = process::run_lines_with(
        program,
        &args,
        &stdin(prompt),
        process::Env::Minimal,
        |line| {
            reader.line(line);
            Ok(if reader.done {
                ControlFlow::Break(())
            } else {
                ControlFlow::Continue(())
            })
        },
    )
    .await?;
    reader.finish(exit)
}

/// One model from Codex's catalog, as offered in Settings → AI.
#[derive(Debug, Clone, PartialEq, Serialize, Deserialize, Type)]
#[serde(rename_all = "camelCase")]
pub struct CodexModel {
    /// What Codex calls it (`-m`), e.g. "gpt-6-luna".
    pub slug: String,
    /// e.g. "GPT-6-Luna".
    pub name: String,
    /// e.g. "Fast and affordable model for easier tasks."
    pub description: String,
}

/// The catalog's models Codex lists for people, in its order.
pub fn parse_models(json: &str) -> Vec<CodexModel> {
    let v: Value = serde_json::from_str(json).unwrap_or(Value::Null);
    let mut listed: Vec<(i64, CodexModel)> = v["models"]
        .as_array()
        .into_iter()
        .flatten()
        .filter(|m| m["visibility"] == "list")
        .filter_map(|m| {
            Some((
                m["priority"].as_i64().unwrap_or(i64::MAX),
                CodexModel {
                    slug: m["slug"].as_str()?.to_string(),
                    name: m["display_name"].as_str().unwrap_or_default().to_string(),
                    description: m["description"].as_str().unwrap_or_default().to_string(),
                },
            ))
        })
        .collect();
    listed.sort_by_key(|(p, _)| *p);
    listed.into_iter().map(|(_, m)| m).collect()
}

/// The newest model the catalog calls fast (the first in its order whose
/// description says "fast" and not "older").
pub fn fast_model(models: &[CodexModel]) -> Option<String> {
    models
        .iter()
        .find(|m| {
            let d = m.description.to_lowercase();
            d.contains("fast") && !d.contains("older")
        })
        .map(|m| m.slug.clone())
}

/// Codex's model catalog, read from the tool itself.
pub async fn models(program: &Path) -> Result<Vec<CodexModel>> {
    let (ok, stdout, stderr) = process::run_quick(program, &["debug", "models"]).await?;
    let found = parse_models(&stdout);
    if !ok || found.is_empty() {
        return Err(CoreError::Ai(format!(
            "Couldn't read Codex's models: {}",
            stderr.trim()
        )));
    }
    Ok(found)
}

#[cfg(test)]
mod tests {
    use super::*;

    const RUN: &str = r#"{"type":"thread.started","thread_id":"01a"}
{"type":"item.completed","item":{"id":"item_0","type":"error","message":"Codex is ignoring 1 unrecognized configuration setting."}}
{"type":"turn.started"}
{"type":"item.completed","item":{"id":"item_1","type":"agent_message","text":"I'll write that.\n"}}
{"type":"item.completed","item":{"id":"item_2","type":"agent_message","text":"Thursday works for me.\n"}}
{"type":"turn.completed","usage":{"input_tokens":14740,"cached_input_tokens":12288,"output_tokens":32,"reasoning_output_tokens":4}}"#;

    #[test]
    fn the_last_message_is_the_answer() {
        let mut r = Reader::default();
        RUN.lines().for_each(|l| r.line(l));
        assert!(r.done);
        let a = r
            .finish(process::Exit {
                success: true,
                stderr: String::new(),
            })
            .unwrap();
        assert_eq!(a.text, "Thursday works for me.");
        assert_eq!(a.usage.input_tokens, 14740);
        assert_eq!(a.usage.output_tokens, 36);
    }

    /// Code review R7-01: text before a failure isn't an answer. A turn
    /// that said something and then failed, or never finished and exited
    /// with an error, was returned as if complete (and so counted as the
    /// "real answer" the monthly live tests need).
    #[test]
    fn text_before_a_failure_is_not_an_answer() {
        let said = r#"{"type":"item.completed","item":{"type":"agent_message","text":"I will try the requested check."}}"#;
        let mut r = Reader::default();
        r.line(said);
        r.line(r#"{"type":"turn.failed","error":{"message":"transport failure"}}"#);
        let failed = r.finish(process::Exit {
            success: false,
            stderr: "failure".into(),
        });
        assert!(failed.is_err(), "{failed:?}");

        let mut r = Reader::default();
        r.line(said);
        let unfinished = r.finish(process::Exit {
            success: false,
            stderr: "crashed".into(),
        });
        assert!(unfinished.is_err(), "{unfinished:?}");
    }

    /// R8 question 3: an answer needs a completed turn. Text with a clean
    /// exit but no `turn.completed`, or a `turn.failed` with no message,
    /// counted as an answer; and a failure with no details said only
    /// "ChatGPT failed: ".
    #[test]
    fn an_answer_needs_a_completed_turn() {
        let said =
            r#"{"type":"item.completed","item":{"type":"agent_message","text":"Partial words"}}"#;
        let clean = || process::Exit {
            success: true,
            stderr: String::new(),
        };
        let mut r = Reader::default();
        r.line(said);
        assert!(r.finish(clean()).is_err(), "clean exit, no completion");

        let mut r = Reader::default();
        r.line(said);
        r.line(r#"{"type":"turn.failed","error":{}}"#);
        let e = r.finish(clean()).unwrap_err().to_string();
        assert!(e.contains("without saying why"), "{e}");
    }

    #[test]
    fn a_passing_problem_before_a_completed_turn_is_fine() {
        let mut r = Reader::default();
        r.line(r#"{"type":"error","message":"Falling back from WebSockets to HTTPS transport."}"#);
        r.line(
            r#"{"type":"item.completed","item":{"type":"agent_message","text":"Thursday works."}}"#,
        );
        r.line(r#"{"type":"turn.completed","usage":{}}"#);
        let a = r.finish(process::Exit {
            success: true,
            stderr: String::new(),
        });
        assert_eq!(a.unwrap().text, "Thursday works.");
    }

    #[test]
    fn a_failed_turn_is_an_error() {
        let mut r = Reader::default();
        r.line(r#"{"type":"turn.failed","error":{"message":"401 Unauthorized"}}"#);
        // Not done: Codex may say more about the failure before it exits.
        assert!(!r.done);
        let e = r
            .finish(process::Exit {
                success: false,
                stderr: String::new(),
            })
            .unwrap_err();
        assert!(e.to_string().contains("sign in again"));
    }

    #[test]
    fn status_reads_codex_login_status() {
        assert_eq!(
            parse_status(true, "\nLogged in using ChatGPT\n"),
            ProviderState::Ready {
                account: Some("ChatGPT".into())
            }
        );
        assert_eq!(
            parse_status(false, "Not logged in"),
            ProviderState::SignedOut
        );
    }

    const CATALOG: &str = r#"{"models": [
      {"slug": "gpt-6-luna", "display_name": "GPT-6-Luna", "description": "Fast and affordable model for easier tasks.", "visibility": "list", "priority": 5},
      {"slug": "gpt-reserve", "display_name": "GPT-Reserve", "description": "Fast and affordable agentic coding model.", "visibility": "hide", "priority": 4},
      {"slug": "gpt-5.6-luna", "display_name": "GPT-5.6-Luna", "description": "Older fast and efficient model.", "visibility": "list", "priority": 9},
      {"slug": "gpt-6.1-sol", "display_name": "GPT-6.1-Sol", "description": "Latest workhorse model.", "visibility": "list", "priority": 1}
    ]}"#;

    #[test]
    fn reads_the_listed_models_in_order_and_finds_the_fast_one() {
        let models = parse_models(CATALOG);
        let slugs: Vec<&str> = models.iter().map(|m| m.slug.as_str()).collect();
        assert_eq!(
            slugs,
            ["gpt-6.1-sol", "gpt-6-luna", "gpt-5.6-luna"],
            "hidden left out"
        );
        assert_eq!(models[1].name, "GPT-6-Luna");
        assert_eq!(fast_model(&models), Some("gpt-6-luna".into()));
        assert!(parse_models("not json").is_empty());
    }

    #[test]
    fn quick_requests_use_the_fast_model_and_writing_the_chosen_one() {
        let models = Models {
            fast: Some("gpt-6-luna".into()),
            writing: Some("gpt-6-astra".into()),
            ..Models::default()
        };
        let fast = choice(Quality::Fast, &models);
        assert_eq!(
            (fast.model.as_deref(), fast.effort),
            (Some("gpt-6-luna"), "none")
        );
        let a = args(&fast, &switches_off(&[]));
        assert_eq!(
            a[a.iter().position(|x| x == "-m").unwrap() + 1],
            "gpt-6-luna"
        );
        let write = choice(Quality::Best, &models);
        assert_eq!(
            (write.model.as_deref(), write.effort),
            (Some("gpt-6-astra"), "medium")
        );
        // Without a catalog, Codex's default model at low effort, no -m.
        let plain = choice(Quality::Fast, &Models::default());
        assert_eq!(plain.effort, "low");
        assert!(!args(&plain, &switches_off(&[])).contains(&"-m".to_string()));
    }

    const FEATURES: &str = "apps                                     stable             true
agent_message_board                      under development  false
brand_new_tool                           stable             true
shell_tool                               stable             false
";

    /// `FEATURES` after `-c features.…=false`: all off.
    const FEATURES_OFF: &str = "apps                                     stable             false
agent_message_board                      under development  false
brand_new_tool                           stable             false
shell_tool                               stable             false
";

    /// `FEATURES` after turning them off, with one that won't.
    const FEATURES_STUBBORN: &str =
        "apps                                     stable             false
agent_message_board                      under development  false
brand_new_tool                           stable             true
shell_tool                               stable             false
";

    /// A shell line that answers `features list` like Codex: `FEATURES`,
    /// or `after` when switches are turned off (`-c`).
    #[cfg(unix)]
    fn features_answer(after: &str) -> String {
        format!(
            "if [ \"$1\" = features ]; then if [ \"$3\" = -c ]; then printf '%s' '{after}'; else printf '%s' '{FEATURES}'; fi; exit 0; fi\n"
        )
    }

    #[test]
    fn reads_codex_switches() {
        assert_eq!(
            parse_switches(FEATURES).unwrap(),
            [
                ("apps".to_string(), true),
                ("agent_message_board".to_string(), false),
                ("brand_new_tool".to_string(), true),
                ("shell_tool".to_string(), false),
            ]
        );
        // R6-04: anything it can't read means no answer, not a shorter one.
        for odd in [
            "apps stable false\nnew_reader stable enabled\n",
            "apps stable false\nnot a switch line\n",
            "apps stable false\napps stable true\n",
            "Apps stable false\n",
            "apps false\n",
            "\n",
        ] {
            assert_eq!(parse_switches(odd), None, "{odd:?}");
        }
    }

    /// Round 5 (Codex fenced in): a switch an update adds, on by
    /// default, is turned off without anyone naming it; known tool
    /// switches stay off even if Codex stops listing them.
    #[test]
    fn every_switch_codex_reports_is_turned_off() {
        let off = switches_off(&parse_switches(FEATURES).unwrap());
        let a = args(&choice(Quality::Fast, &Models::default()), &off);
        for name in ["brand_new_tool", "apps", "shell_tool", "browser_use"] {
            assert!(
                a.contains(&format!("features.{name}=false")),
                "{name}: {a:?}"
            );
        }
        // R6-02: one reported off is turned off too. The check reads the
        // owner's Codex config, a request ignores it, so a switch their
        // config turns off would be back on (its default) in the request.
        assert!(a.contains(&"features.agent_message_board=false".to_string()));
    }

    /// The whole request against a stand-in `codex`: the switches it
    /// reports on go into `exec`'s arguments, and it doesn't see the
    /// app's environment.
    #[cfg(unix)]
    #[tokio::test]
    async fn a_request_turns_off_what_codex_reports_and_hides_the_environment() {
        use std::os::unix::fs::PermissionsExt;
        let dir = std::env::temp_dir().join(format!("codex-stub-{}", fastrand::u64(..)));
        std::fs::create_dir_all(&dir).unwrap();
        let log = dir.join("exec-args");
        let stub = dir.join("codex");
        std::fs::write(
            &stub,
            format!(
                "#!/bin/sh\n{features}\
                 echo \"$@\" > {log}; env >> {log}\n\
                 echo '{{\"type\":\"item.completed\",\"item\":{{\"type\":\"agent_message\",\"text\":\"Done.\"}}}}'\n\
                 echo '{{\"type\":\"turn.completed\",\"usage\":{{}}}}'\n",
                features = features_answer(FEATURES_OFF),
                log = log.display()
            ),
        )
        .unwrap();
        std::fs::set_permissions(&stub, std::fs::Permissions::from_mode(0o755)).unwrap();
        std::env::set_var("AI_ENV_PROBE_CODEX", "x");
        let prompt = Prompt {
            instructions: "Summarize.".into(),
            input: "Hi".into(),
            quality: Quality::Fast,
            max_tokens: None,
        };
        let answer = ask(&stub, &prompt, &Models::default(), &|_| {})
            .await
            .unwrap();
        assert_eq!(answer.text, "Done.");
        let ran = std::fs::read_to_string(&log).unwrap();
        assert!(ran.contains("features.brand_new_tool=false"), "{ran}");
        assert!(!ran.contains("AI_ENV_PROBE_CODEX"), "{ran}");
        let _ = std::fs::remove_dir_all(&dir);
    }

    /// A stand-in `codex` whose `brand_new_tool` stays on even when turned
    /// off, logging `exec`'s arguments if it gets that far.
    #[cfg(unix)]
    fn stubborn_codex(dir: &std::path::Path) -> std::path::PathBuf {
        use std::os::unix::fs::PermissionsExt;
        std::fs::create_dir_all(dir).unwrap();
        let stub = dir.join("codex");
        std::fs::write(
            &stub,
            format!(
                "#!/bin/sh\n{features}\
                 echo ran > {ran}\n\
                 echo '{{\"type\":\"item.completed\",\"item\":{{\"type\":\"agent_message\",\"text\":\"Done.\"}}}}'\n\
                 echo '{{\"type\":\"turn.completed\",\"usage\":{{}}}}'\n",
                features = features_answer(FEATURES_STUBBORN),
                ran = dir.join("ran").display()
            ),
        )
        .unwrap();
        std::fs::set_permissions(&stub, std::fs::Permissions::from_mode(0o755)).unwrap();
        stub
    }

    /// Fencing in Codex (Milestone 13): a switch that stays on after being
    /// turned off and isn't on the reviewed list pauses ChatGPT before
    /// anything is sent, unless the owner chose "use anyway" for it.
    #[cfg(unix)]
    #[tokio::test]
    async fn a_switch_that_wont_turn_off_pauses_chatgpt() {
        let dir = std::env::temp_dir().join(format!("codex-stubborn-{}", fastrand::u64(..)));
        let stub = stubborn_codex(&dir);
        let prompt = Prompt {
            instructions: "Summarize.".into(),
            input: "Hi".into(),
            quality: Quality::Fast,
            max_tokens: None,
        };
        assert_eq!(check(&stub).await.unwrap(), ["brand_new_tool"]);
        let e = ask(&stub, &prompt, &Models::default(), &|_| {})
            .await
            .unwrap_err();
        assert!(e.to_string().contains("ChatGPT is paused"), "{e}");
        assert!(e.to_string().contains("brand_new_tool"), "{e}");
        assert!(!dir.join("ran").exists(), "nothing was sent");

        let anyway = Models {
            accepted: vec!["brand_new_tool".into()],
            ..Models::default()
        };
        let answer = ask(&stub, &prompt, &anyway, &|_| {}).await.unwrap();
        assert_eq!(answer.text, "Done.");
        let _ = std::fs::remove_dir_all(&dir);
    }

    /// Code review R6-04: a line of `codex features list` the parser
    /// couldn't read was skipped, so that switch went unchecked and the
    /// request went ahead. Now nothing is sent.
    #[cfg(unix)]
    #[tokio::test]
    async fn a_switch_list_it_cant_fully_read_stops_the_request() {
        use std::os::unix::fs::PermissionsExt;
        let dir = std::env::temp_dir().join(format!("codex-partial-{}", fastrand::u64(..)));
        std::fs::create_dir_all(&dir).unwrap();
        let stub = dir.join("codex");
        let ran = dir.join("ran");
        std::fs::write(
            &stub,
            format!(
                "#!/bin/sh\nif [ \"$1\" = features ]; then printf 'apps stable false\\nnew_reader stable enabled\\n'; exit 0; fi\n\
                 echo ran > {ran}\n\
                 echo '{{\"type\":\"item.completed\",\"item\":{{\"type\":\"agent_message\",\"text\":\"SENT\"}}}}'\n\
                 echo '{{\"type\":\"turn.completed\",\"usage\":{{}}}}'\n",
                ran = ran.display()
            ),
        )
        .unwrap();
        std::fs::set_permissions(&stub, std::fs::Permissions::from_mode(0o755)).unwrap();
        let prompt = Prompt {
            instructions: "Summarize.".into(),
            input: "Hi".into(),
            quality: Quality::Fast,
            max_tokens: None,
        };
        let result = ask(&stub, &prompt, &Models::default(), &|_| {}).await;
        assert!(result.is_err(), "{result:?}");
        assert!(!ran.exists(), "nothing was sent");
        let _ = std::fs::remove_dir_all(&dir);
    }

    /// R8 questions 1–2: a model the review lists as refused
    /// (`refused_models`) is never asked for, as the fast model or for
    /// writing, whatever Codex is signed in with: its tools were never
    /// reviewed. Nothing is sent.
    #[cfg(unix)]
    #[tokio::test]
    async fn a_refused_model_is_never_asked() {
        let refused = super::super::codex_review::review().refused_models;
        let model = refused.first().expect("the review lists one").clone();
        let dir = std::env::temp_dir().join(format!("codex-refused-{}", fastrand::u64(..)));
        let stub = stubborn_codex(&dir);
        let prompt = |quality| Prompt {
            instructions: "Summarize.".into(),
            input: "Hi".into(),
            quality,
            max_tokens: None,
        };
        let accepted = vec!["brand_new_tool".to_string()];
        for (quality, models) in [
            (
                Quality::Fast,
                Models {
                    fast: Some(model.clone()),
                    accepted: accepted.clone(),
                    ..Models::default()
                },
            ),
            (
                Quality::Best,
                Models {
                    writing: Some(model.clone()),
                    accepted: accepted.clone(),
                    ..Models::default()
                },
            ),
        ] {
            let e = ask(&stub, &prompt(quality), &models, &|_| {})
                .await
                .unwrap_err();
            assert!(e.to_string().contains(&model), "{e}");
            assert!(!dir.join("ran").exists(), "nothing was sent");
        }
        let _ = std::fs::remove_dir_all(&dir);
    }

    #[test]
    fn tools_are_off_and_the_prompt_comes_on_stdin() {
        let a = args(
            &choice(Quality::Fast, &Models::default()),
            &switches_off(&[]),
        );
        assert!(a.contains(&"features.shell_tool=false".to_string()));
        assert!(a.contains(&"web_search=\"disabled\"".to_string()));
        assert!(a.contains(&"read-only".to_string()));
        assert_eq!(a.last().unwrap(), "-");
    }
}
