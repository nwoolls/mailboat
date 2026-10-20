//! AI features: summaries and help writing replies.
//!
//! Three providers, each reached through a program on this Mac rather than
//! an API key Mailboat would have to keep:
//!
//! - **Apple Intelligence** (on-device; the default): Mailboat's own helper,
//!   `mailboat-ai`, built from `src-tauri/macos/ai-helper.swift`. Mail never
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
pub mod claude;
pub mod codex;
pub mod context;
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
    Claude,
    #[serde(rename = "chatgpt")]
    ChatGpt,
}

impl AiProvider {
    pub const ALL: [AiProvider; 3] = [AiProvider::Apple, AiProvider::Claude, AiProvider::ChatGpt];

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

/// How much model a request deserves: summaries want speed, writing wants
/// the better model.
#[derive(Debug, Clone, Copy, PartialEq, Eq)]
pub enum Quality {
    Fast,
    Best,
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
    /// Mailboat's helper, next to the app's own binary.
    pub apple: Option<PathBuf>,
    pub claude: Option<PathBuf>,
    pub codex: Option<PathBuf>,
}

impl Programs {
    /// Finds the command-line tools where their installers put them (a
    /// Mac app doesn't get the shell's PATH).
    pub fn find(apple_helper: Option<PathBuf>) -> Self {
        Self {
            apple: apple_helper.filter(|p| p.is_file()),
            claude: process::find_program("claude"),
            codex: process::find_program("codex"),
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
    /// Apple Intelligence is off, still downloading, or not supported here.
    #[serde(rename_all = "camelCase")]
    Unavailable { reason: String },
}

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
        AiProvider::ChatGpt => codex::ask(path, prompt, on_text).await?,
    };
    if answer.text.trim().is_empty() {
        return Err(CoreError::Ai(format!(
            "{} gave an empty answer.",
            display_name(provider)
        )));
    }
    Ok(answer)
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
