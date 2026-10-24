//! Claude, through the `claude` command-line tool (Claude Code), signed in
//! with the owner's Claude account. Mailboat never sees a token: the tool
//! keeps its own sign-in.
//!
//! Each request is `claude -p` with every tool, setting file, MCP server
//! and skill turned off, so the model can only answer with text, and with
//! `stream-json` output so the answer arrives as it's written.

use std::ops::ControlFlow;
use std::path::Path;

use serde_json::Value;

use super::{process, Answer, PlanLimit, Prompt, ProviderState, Quality, Usage};
use crate::error::{CoreError, Result};

pub fn args(prompt: &Prompt) -> Vec<String> {
    let model = match prompt.quality {
        Quality::Fast => "haiku",
        Quality::Best => "sonnet",
        Quality::Strongest => "opus",
    };
    [
        "-p",
        "--output-format",
        "stream-json",
        "--verbose",
        "--include-partial-messages",
        "--model",
        model,
        // No tools at all: an email can't make it read files or browse.
        "--tools",
        "",
        "--strict-mcp-config",
        "--setting-sources",
        "",
        "--disable-slash-commands",
        "--no-session-persistence",
        "--system-prompt",
        &prompt.instructions,
    ]
    .into_iter()
    .map(String::from)
    .collect()
}

pub async fn status(program: &Path) -> ProviderState {
    match process::run_quick(program, &["auth", "status", "--json"]).await {
        Ok((_, stdout, _)) => parse_status(&stdout),
        Err(e) => ProviderState::Unavailable {
            reason: e.to_string(),
        },
    }
}

pub fn parse_status(stdout: &str) -> ProviderState {
    let v: Value = serde_json::from_str(stdout.trim()).unwrap_or(Value::Null);
    if v["loggedIn"].as_bool() == Some(true) {
        ProviderState::Ready {
            account: v["email"].as_str().map(String::from),
        }
    } else {
        ProviderState::SignedOut
    }
}

/// Opens the browser to sign in with a Claude subscription.
pub const LOGIN_ARGS: &[&str] = &["auth", "login", "--claudeai"];

/// Reads `stream-json` output: text as it's written, then the result line
/// with usage. Also the subscription's limits, which Claude reports.
#[derive(Default)]
pub struct Reader {
    pub answer: Answer,
    streamed: String,
    error: Option<String>,
    /// The answer is complete; what's left is Claude exiting.
    pub done: bool,
}

impl Reader {
    /// Takes one line; returns the answer so far when it grew.
    pub fn line(&mut self, line: &str) -> Option<&str> {
        let v: Value = serde_json::from_str(line).ok()?;
        match v["type"].as_str()? {
            "stream_event" => {
                let event = &v["event"];
                if event["type"] == "content_block_delta" && event["delta"]["type"] == "text_delta"
                {
                    self.streamed.push_str(event["delta"]["text"].as_str()?);
                    return Some(&self.streamed);
                }
            }
            "rate_limit_event" => {
                if let Some(windows) = v["rate_limit_info"]["unifiedWindows"].as_object() {
                    self.answer.limits = windows
                        .iter()
                        .filter_map(|(name, w)| {
                            Some(PlanLimit {
                                window: name.clone(),
                                used: w["utilization"].as_f64()?,
                                resets_at: w["resetsAt"].as_i64(),
                            })
                        })
                        .collect();
                }
            }
            "result" => {
                // The last line: what's left is Claude exiting.
                self.done = true;
                let u = &v["usage"];
                let n = |k: &str| u[k].as_u64().unwrap_or(0);
                self.answer.usage = Usage {
                    input_tokens: n("input_tokens")
                        + n("cache_creation_input_tokens")
                        + n("cache_read_input_tokens"),
                    output_tokens: n("output_tokens"),
                    cost_usd: v["total_cost_usd"].as_f64(),
                };
                let text = v["result"].as_str().unwrap_or_default().to_string();
                if v["is_error"].as_bool() == Some(true) {
                    self.error = Some(if text.is_empty() {
                        "Claude couldn't answer.".into()
                    } else {
                        text
                    });
                } else {
                    self.answer.text = if text.is_empty() {
                        self.streamed.clone()
                    } else {
                        text
                    };
                }
            }
            _ => {}
        }
        None
    }

    pub fn finish(mut self, exit: process::Exit) -> Result<Answer> {
        if let Some(e) = self.error {
            return Err(CoreError::Ai(friendly_error(&e)));
        }
        if self.answer.text.is_empty() {
            self.answer.text = self.streamed;
        }
        if self.answer.text.is_empty() && !exit.success {
            return Err(CoreError::Ai(friendly_error(&exit.stderr)));
        }
        Ok(self.answer)
    }
}

fn friendly_error(raw: &str) -> String {
    let lower = raw.to_lowercase();
    if lower.contains("login") || lower.contains("log in") || lower.contains("authenticat") {
        "Claude needs you to sign in again (Settings → AI).".into()
    } else if lower.contains("limit") {
        format!("Claude's usage limit was reached: {}", raw.trim())
    } else {
        format!("Claude failed: {}", raw.trim())
    }
}

pub async fn ask(
    program: &Path,
    prompt: &Prompt,
    on_text: &(dyn Fn(&str) + Send + Sync),
) -> Result<Answer> {
    let mut reader = Reader::default();
    let exit = process::run_lines(program, &args(prompt), &prompt.input, |line| {
        if let Some(text) = reader.line(line) {
            on_text(text);
        }
        Ok(if reader.done {
            ControlFlow::Break(())
        } else {
            ControlFlow::Continue(())
        })
    })
    .await?;
    reader.finish(exit)
}

#[cfg(test)]
mod tests {
    use super::*;

    const STREAM: &str = r#"{"type":"system","subtype":"init","tools":[],"mcp_servers":[]}
{"type":"stream_event","event":{"type":"content_block_delta","index":0,"delta":{"type":"text_delta","text":"Hello there"}}}
{"type":"stream_event","event":{"type":"content_block_delta","index":0,"delta":{"type":"text_delta","text":", friend"}}}
{"type":"rate_limit_event","rate_limit_info":{"status":"allowed","unifiedWindows":{"five_hour":{"utilization":0.39,"resetsAt":1792515600},"seven_day":{"utilization":0.1}}}}
{"type":"result","subtype":"success","is_error":false,"result":"Hello there, friend","total_cost_usd":0.0001215,"usage":{"input_tokens":2,"cache_creation_input_tokens":564,"cache_read_input_tokens":10,"output_tokens":17}}"#;

    #[test]
    fn reads_streamed_text_usage_and_limits() {
        let mut r = Reader::default();
        let mut partials = Vec::new();
        for line in STREAM.lines() {
            if let Some(t) = r.line(line) {
                partials.push(t.to_string());
            }
        }
        assert_eq!(partials, ["Hello there", "Hello there, friend"]);
        // The result line ends it, so Mailboat stops waiting there.
        assert!(r.done);
        let a = r
            .finish(process::Exit {
                success: true,
                stderr: String::new(),
            })
            .unwrap();
        assert_eq!(a.text, "Hello there, friend");
        assert_eq!(a.usage.input_tokens, 576);
        assert_eq!(a.usage.output_tokens, 17);
        assert_eq!(a.usage.cost_usd, Some(0.0001215));
        let five = a.limits.iter().find(|l| l.window == "five_hour").unwrap();
        assert_eq!(five.used, 0.39);
        assert_eq!(five.resets_at, Some(1792515600));
    }

    #[test]
    fn an_error_result_becomes_a_readable_error() {
        let mut r = Reader::default();
        r.line(r#"{"type":"result","is_error":true,"result":"Not logged in · Please run /login"}"#);
        let e = r
            .finish(process::Exit {
                success: false,
                stderr: String::new(),
            })
            .unwrap_err();
        assert!(e.to_string().contains("sign in again"), "{e}");
    }

    #[test]
    fn status_says_who_is_signed_in() {
        assert_eq!(
            parse_status(r#"{"loggedIn": true, "authMethod": "claude.ai", "email": "n@x.com"}"#),
            ProviderState::Ready {
                account: Some("n@x.com".into())
            }
        );
        assert_eq!(
            parse_status(r#"{"loggedIn": false}"#),
            ProviderState::SignedOut
        );
        assert_eq!(parse_status("garbage"), ProviderState::SignedOut);
    }

    fn best_prompt() -> Prompt {
        Prompt {
            instructions: String::new(),
            input: String::new(),
            quality: Quality::Best,
            max_tokens: None,
        }
    }

    #[test]
    fn every_tool_is_off_and_the_model_fits_the_job() {
        let p = Prompt {
            instructions: "Summarize".into(),
            input: String::new(),
            quality: Quality::Fast,
            max_tokens: None,
        };
        let a = args(&p);
        let after = |flag: &str| a[a.iter().position(|x| x == flag).unwrap() + 1].clone();
        assert_eq!(after("--tools"), "");
        assert_eq!(after("--model"), "haiku");
        assert_eq!(after("--system-prompt"), "Summarize");
        assert!(a.contains(&"--strict-mcp-config".to_string()));
        let best = args(&Prompt {
            quality: Quality::Best,
            ..p
        });
        assert!(best.contains(&"sonnet".to_string()));
        let strongest = args(&Prompt {
            quality: Quality::Strongest,
            ..best_prompt()
        });
        assert!(strongest.contains(&"opus".to_string()));
    }
}
