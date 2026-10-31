//! AI features: summaries and help writing replies.
//!
//! Three providers, each reached through a program on this Mac rather than
//! an API key the app would have to keep:
//!
//! - **Apple Intelligence** (on-device; the default): the app's own helper,
//!   `ai-helper`, built from `src-tauri/macos/ai-helper.swift`. Mail never
//!   leaves the Mac.
//! - **Claude**: the `claude` command-line tool (Claude Code), signed in
//!   with the owner's Claude account.
//! - **ChatGPT**: the `codex` command-line tool, signed in with the
//!   owner's ChatGPT account.
//!
//! Each request runs the program once, with every tool turned off, so an
//! email can only ever produce text (see ARCHITECTURE, decisions). The
//! answer is plain text, shown as text, never as HTML.

pub mod apple;
pub mod apps;
pub mod claude;
pub mod codex;
pub mod codex_review;
pub mod context;
pub mod format;
pub mod process;
pub mod prompts;
pub mod summaries;
pub mod tasks;
pub mod usage;

use std::path::PathBuf;

use serde::{Deserialize, Serialize};
use specta::Type;

use crate::error::{CoreError, Result};

#[derive(Debug, Clone, Copy, PartialEq, Eq, Hash, Serialize, Deserialize, Type)]
#[serde(rename_all = "camelCase")]
pub enum AiProvider {
    Apple,
    #[serde(rename = "chatgpt")]
    ChatGpt,
    Claude,
}

impl AiProvider {
    /// Alphabetical by name (Apple Intelligence, ChatGPT, Claude), as listed.
    pub const ALL: [AiProvider; 3] = [AiProvider::Apple, AiProvider::ChatGpt, AiProvider::Claude];

    pub fn as_str(self) -> &'static str {
        match self {
            AiProvider::Apple => "apple",
            AiProvider::Claude => "claude",
            AiProvider::ChatGpt => "chatgpt",
        }
    }

    pub fn parse(s: &str) -> Option<Self> {
        Self::ALL.into_iter().find(|p| p.as_str() == s)
    }

    /// Whether mail sent to it leaves this Mac.
    pub fn on_device(self) -> bool {
        self == AiProvider::Apple
    }
}

/// How much model a request deserves: summaries want speed, writing the
/// better model, and the owner can choose for writing (Settings → AI).
/// Claude: Haiku, Sonnet, Opus. ChatGPT: Codex's reasoning effort low,
/// medium, high. Apple has one model.
#[derive(Debug, Clone, Copy, Default, PartialEq, Eq, Serialize, Deserialize, Type)]
#[serde(rename_all = "camelCase")]
pub enum Quality {
    Fast,
    #[default]
    Best,
    Strongest,
}

/// One request: what the model is told to do, and the material.
#[derive(Debug, Clone, PartialEq)]
pub struct Prompt {
    pub instructions: String,
    pub input: String,
    pub quality: Quality,
    /// A cap on the answer's length (Apple's model takes one; the others
    /// are told in the instructions).
    pub max_tokens: Option<u32>,
}

/// What a request cost, as the provider reported it.
#[derive(Debug, Clone, Default, PartialEq, Serialize, Deserialize, Type)]
#[serde(rename_all = "camelCase")]
pub struct Usage {
    pub input_tokens: u64,
    pub output_tokens: u64,
    /// What it would cost at API prices (Claude reports it; a subscription
    /// isn't billed this).
    pub cost_usd: Option<f64>,
}

/// How much of a subscription's rolling limits is used, when the provider
/// says (Claude does, with every answer).
#[derive(Debug, Clone, PartialEq, Serialize, Deserialize, Type)]
#[serde(rename_all = "camelCase")]
pub struct PlanLimit {
    /// e.g. "five_hour", "seven_day".
    pub window: String,
    /// 0 to 1.
    pub used: f64,
    /// Unix seconds.
    pub resets_at: Option<i64>,
}

#[derive(Debug, Clone, Default, PartialEq)]
pub struct Answer {
    pub text: String,
    pub usage: Usage,
    pub limits: Vec<PlanLimit>,
}

/// Where each provider's program is, once found.
#[derive(Debug, Clone, Default)]
pub struct Programs {
    /// The app's helper, next to the app's own binary.
    pub apple: Option<PathBuf>,
    pub claude: Option<PathBuf>,
    pub codex: Option<PathBuf>,
    /// Which Codex models to use (filled in by the app from Codex's
    /// catalog and Settings).
    pub codex_models: codex::Models,
}

impl Programs {
    /// Finds the command-line tools where their installers put them (a
    /// Mac app doesn't get the shell's PATH), or else the copies inside
    /// the Claude and ChatGPT apps (`apps`).
    pub fn find(apple_helper: Option<PathBuf>) -> Self {
        Self {
            apple: apple_helper.filter(|p| p.is_file()),
            claude: process::find_program("claude").or_else(apps::claude),
            codex: process::find_program("codex").or_else(apps::codex),
            codex_models: codex::Models::default(),
        }
    }

    pub fn path(&self, provider: AiProvider) -> Option<&PathBuf> {
        match provider {
            AiProvider::Apple => self.apple.as_ref(),
            AiProvider::Claude => self.claude.as_ref(),
            AiProvider::ChatGpt => self.codex.as_ref(),
        }
    }
}

/// Whether a provider can be used now, and if not, what to do about it.
#[derive(Debug, Clone, PartialEq, Serialize, Deserialize, Type)]
#[serde(tag = "state", rename_all = "camelCase")]
pub enum ProviderState {
    #[serde(rename_all = "camelCase")]
    Ready {
        /// Who it's signed in as, when the provider says.
        account: Option<String>,
    },
    /// Its program isn't on this Mac.
    NotInstalled,
    /// Installed but not signed in.
    SignedOut,
    /// Apple Intelligence is off or still downloading.
    #[serde(rename_all = "camelCase")]
    Unavailable { reason: String },
    /// Apple Intelligence can never run on this computer: it isn't a Mac,
    /// or the Mac can't run it. Settings hides it rather than offer it.
    #[serde(rename_all = "camelCase")]
    Unsupported { reason: String },
}

/// Whether Apple Intelligence can exist here at all (the app's helper for it
/// is only built for macOS).
pub const APPLE_ON_THIS_SYSTEM: bool = cfg!(target_os = "macos");

#[derive(Debug, Clone, PartialEq, Serialize, Deserialize, Type)]
#[serde(rename_all = "camelCase")]
pub struct ProviderStatus {
    pub provider: AiProvider,
    #[serde(flatten)]
    pub state: ProviderState,
}

/// Checks whether a provider is ready to use.
pub async fn status(programs: &Programs, provider: AiProvider) -> ProviderStatus {
    let state = match programs.path(provider) {
        None if provider == AiProvider::Apple && !APPLE_ON_THIS_SYSTEM => {
            ProviderState::Unsupported {
                reason: "Apple Intelligence is only on Macs.".into(),
            }
        }
        None => ProviderState::NotInstalled,
        Some(path) => match provider {
            AiProvider::Apple => apple::status(path).await,
            AiProvider::Claude => claude::status(path).await,
            AiProvider::ChatGpt => codex::status(path).await,
        },
    };
    ProviderStatus { provider, state }
}

/// Sends one prompt and returns the answer. `on_text` is called with the
/// whole answer so far as it arrives (once, at the end, for providers that
/// don't stream). Dropping the future stops the program.
pub async fn ask(
    programs: &Programs,
    provider: AiProvider,
    prompt: &Prompt,
    on_text: &(dyn Fn(&str) + Send + Sync),
) -> Result<Answer> {
    let path = programs
        .path(provider)
        .ok_or_else(|| not_installed(provider))?;
    let answer = match provider {
        AiProvider::Apple => apple::ask(path, prompt, on_text).await?,
        AiProvider::Claude => claude::ask(path, prompt, on_text).await?,
        AiProvider::ChatGpt => codex::ask(path, prompt, &programs.codex_models, on_text).await?,
    };
    if answer.text.trim().is_empty() {
        return Err(CoreError::Ai(format!(
            "{} gave an empty answer.",
            display_name(provider)
        )));
    }
    Ok(answer)
}

/// What the sync log says about a failed AI request, from its error's
/// `kind` and message: a fixed reason, never the message itself. An AI
/// error's text comes from the provider (its answer, its stderr), which
/// can quote the mail it was given, and mail never goes in the log (code
/// review R4-02). The message is shown to the owner as it is.
pub fn log_reason(kind: &str, message: &str) -> &'static str {
    if kind != "ai" {
        return match kind {
            "network" => "network error",
            "auth" => "Google sign-in needed",
            "rate_limited" => "Gmail rate limit",
            "api" => "Gmail error",
            "not_found" => "not found",
            "cancelled" => "cancelled",
            "db" => "database error",
            _ => "error",
        };
    }
    let m = message.to_lowercase();
    if m.contains("sign in again") {
        "the provider needs signing in again"
    } else if m.contains("usage limit") {
        "usage limit reached"
    } else if m.contains("guardrail") || m.contains("declined") {
        "the model declined"
    } else if m.contains("took too long") {
        "timed out"
    } else if m.contains("isn't installed") || m.contains("needs macos") {
        "not installed"
    } else if m.contains("empty answer") {
        "empty answer"
    } else if m.contains("couldn't start") {
        "couldn't start the provider"
    } else {
        "the provider failed"
    }
}

pub fn display_name(provider: AiProvider) -> &'static str {
    match provider {
        AiProvider::Apple => "Apple Intelligence",
        AiProvider::Claude => "Claude",
        AiProvider::ChatGpt => "ChatGPT",
    }
}

fn not_installed(provider: AiProvider) -> CoreError {
    CoreError::Ai(match provider {
        AiProvider::Apple => "Apple Intelligence needs macOS 26 or later.".into(),
        AiProvider::Claude => "Claude Code isn't installed on this Mac.".into(),
        AiProvider::ChatGpt => "Codex isn't installed on this Mac.".into(),
    })
}

#[cfg(test)]
mod tests {

    #[test]
    fn the_log_never_gets_the_providers_text() {
        let quoted = "Rejected input: CONFIDENTIAL_MAIL_MARKER";
        for (kind, message) in [
            ("ai", format!("Claude failed: {quoted}")),
            ("ai", format!("ChatGPT failed: {quoted}")),
            ("ai", format!("Claude's usage limit was reached: {quoted}")),
            ("ai", format!("Apple Intelligence failed: {quoted}")),
            ("other", quoted.to_string()),
        ] {
            assert!(!log_reason(kind, &message).contains("CONFIDENTIAL"));
        }
        assert_eq!(
            log_reason("ai", "Claude's usage limit was reached: soon"),
            "usage limit reached"
        );
        assert_eq!(
            log_reason("ai", "ChatGPT needs you to sign in again (Settings → AI)."),
            "the provider needs signing in again"
        );
        assert_eq!(log_reason("network", "anything"), "network error");
    }

    use super::*;

    #[test]
    fn provider_names_round_trip_and_match_the_ui() {
        for p in AiProvider::ALL {
            assert_eq!(AiProvider::parse(p.as_str()), Some(p));
            let json = serde_json::to_string(&p).unwrap();
            assert_eq!(json, format!("\"{}\"", p.as_str()));
        }
        assert!(AiProvider::Apple.on_device());
        assert!(!AiProvider::Claude.on_device());
    }

    /// Off macOS there's no Apple Intelligence to install: Settings hides
    /// it. On a Mac a missing helper is still "not installed".
    #[tokio::test]
    async fn apple_without_its_helper() {
        let programs = Programs {
            apple: None,
            claude: None,
            codex: None,
            codex_models: codex::Models::default(),
        };
        let state = status(&programs, AiProvider::Apple).await.state;
        if APPLE_ON_THIS_SYSTEM {
            assert_eq!(state, ProviderState::NotInstalled);
        } else {
            assert!(matches!(state, ProviderState::Unsupported { .. }));
        }
        assert_eq!(
            status(&programs, AiProvider::Claude).await.state,
            ProviderState::NotInstalled
        );
        let json = serde_json::to_value(ProviderStatus {
            provider: AiProvider::Apple,
            state: ProviderState::Unsupported { reason: "x".into() },
        })
        .unwrap();
        assert_eq!(json["state"], "unsupported");
    }

    #[test]
    fn provider_status_serializes_flat_for_the_ui() {
        let s = ProviderStatus {
            provider: AiProvider::Claude,
            state: ProviderState::Ready {
                account: Some("a@b.c".into()),
            },
        };
        assert_eq!(
            serde_json::to_value(&s).unwrap(),
            serde_json::json!({"provider": "claude", "state": "ready", "account": "a@b.c"})
        );
    }
}
