//! ChatGPT, through OpenAI's `codex` command-line tool, signed in with the
//! owner's ChatGPT account (`codex login`). Mailboat never sees a token.
//!
//! Codex is a coding agent, so each request turns its tools off (shell,
//! web search, plugins, browser…) through `-c features.…=false`, which
//! newer versions ignore for names they don't know (`--disable` would
//! fail instead), and runs read-only in an empty folder. Its `--json`
//! output doesn't stream text, so the answer arrives whole.

use std::path::Path;

use serde_json::Value;

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

pub fn args(prompt: &Prompt) -> Vec<String> {
    let effort = match prompt.quality {
        Quality::Fast => "low",
        Quality::Best => "medium",
        Quality::Strongest => "high",
    };
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
    on_text: &(dyn Fn(&str) + Send + Sync),
) -> Result<Answer> {
    let mut reader = Reader::default();
    let exit = process::run_lines(program, &args(prompt), &stdin(prompt), |line| {
        reader.line(line);
        Ok(())
    })
    .await?;
    let answer = reader.finish(exit)?;
    on_text(&answer.text);
    Ok(answer)
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

    #[test]
    fn tools_are_off_and_the_prompt_comes_on_stdin() {
        let a = args(&Prompt {
            instructions: String::new(),
            input: String::new(),
            quality: Quality::Fast,
            max_tokens: None,
        });
        assert!(a.contains(&"features.shell_tool=false".to_string()));
        assert!(a.contains(&"web_search=\"disabled\"".to_string()));
        assert!(a.contains(&"read-only".to_string()));
        assert_eq!(a.last().unwrap(), "-");
    }
}
