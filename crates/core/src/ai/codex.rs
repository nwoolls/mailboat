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

/// Codex tools that could act on the Mac or the web.
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

pub fn args(choice: &Choice) -> Vec<String> {
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
    for tool in TOOLS_OFF {
        a.push("-c".into());
        a.push(format!("features.{tool}=false"));
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
        if self.answer.text.is_empty() {
            let raw = self.error.unwrap_or(exit.stderr);
            let lower = raw.to_lowercase();
            return Err(CoreError::Ai(
                if lower.contains("login") || lower.contains("401") || lower.contains("auth") {
                    "ChatGPT needs you to sign in again (Settings → AI).".into()
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
    let answer = match run(program, prompt, &chosen).await {
        // A model that doesn't take "none" (a newer fast model, say)
        // gets one more try with "low".
        Err(CoreError::Ai(m)) if chosen.effort == "none" && m.contains("Unsupported value") => {
            chosen.effort = "low";
            run(program, prompt, &chosen).await?
        }
        other => other?,
    };
    on_text(&answer.text);
    Ok(answer)
}

async fn run(program: &Path, prompt: &Prompt, chosen: &Choice) -> Result<Answer> {
    let mut reader = Reader::default();
    let exit = process::run_lines(program, &args(chosen), &stdin(prompt), |line| {
        reader.line(line);
        Ok(if reader.done {
            ControlFlow::Break(())
        } else {
            ControlFlow::Continue(())
        })
    })
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
        };
        let fast = choice(Quality::Fast, &models);
        assert_eq!(
            (fast.model.as_deref(), fast.effort),
            (Some("gpt-6-luna"), "none")
        );
        let a = args(&fast);
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
        assert!(!args(&plain).contains(&"-m".to_string()));
    }

    #[test]
    fn tools_are_off_and_the_prompt_comes_on_stdin() {
        let a = args(&choice(Quality::Fast, &Models::default()));
        assert!(a.contains(&"features.shell_tool=false".to_string()));
        assert!(a.contains(&"web_search=\"disabled\"".to_string()));
        assert!(a.contains(&"read-only".to_string()));
        assert_eq!(a.last().unwrap(), "-");
    }
}
