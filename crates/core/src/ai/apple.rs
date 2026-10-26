//! Apple Intelligence, through the app's helper (`ai-helper`, built from
//! `src-tauri/macos/ai-helper.swift`). The protocol is described there.
//!
//! Apple's on-device model reads about 4,000 tokens, instructions and
//! answer included, so its prompts get a smaller share of the email
//! (`context::Budget`).

use std::ops::ControlFlow;
use std::path::Path;

use serde::Deserialize;
use serde_json::json;

use super::{process, Answer, Prompt, ProviderState, Usage};
use crate::error::{CoreError, Result};

#[derive(Debug, Deserialize, PartialEq)]
#[serde(tag = "type", rename_all = "camelCase")]
enum Line {
    Status {
        available: bool,
        #[serde(default)]
        reason: Option<String>,
    },
    Text {
        text: String,
    },
    Done {
        text: String,
    },
    Translated {
        text: String,
        source: String,
        target: String,
    },
    Language {
        code: Option<String>,
    },
    Languages {
        codes: Vec<String>,
    },
    Error {
        kind: String,
        message: String,
    },
}

pub async fn status(helper: &Path) -> ProviderState {
    let mut state = ProviderState::Unavailable {
        reason: "Apple Intelligence didn't answer.".into(),
    };
    let ran = process::run_lines(helper, &[], r#"{"op":"status"}"#, |line| {
        if let Ok(Line::Status { available, reason }) = serde_json::from_str(line) {
            state = if available {
                ProviderState::Ready { account: None }
            } else if reason.as_deref() == Some("deviceNotEligible") {
                ProviderState::Unsupported {
                    reason: unavailable_text("deviceNotEligible"),
                }
            } else {
                ProviderState::Unavailable {
                    reason: unavailable_text(reason.as_deref().unwrap_or("unknown")),
                }
            };
        }
        Ok(ControlFlow::Continue(()))
    })
    .await;
    match ran {
        Ok(_) => state,
        Err(e) => ProviderState::Unavailable {
            reason: e.to_string(),
        },
    }
}

fn unavailable_text(reason: &str) -> String {
    match reason {
        "notEnabled" => "Turn on Apple Intelligence in System Settings.".into(),
        "modelNotReady" => "Apple Intelligence is still downloading.".into(),
        "deviceNotEligible" => "This Mac doesn't support Apple Intelligence.".into(),
        _ => "Apple Intelligence isn't available.".into(),
    }
}

pub fn request(prompt: &Prompt) -> String {
    json!({
        "op": "respond",
        "instructions": prompt.instructions,
        "prompt": prompt.input,
        "maxTokens": prompt.max_tokens,
    })
    .to_string()
}

pub async fn ask(
    helper: &Path,
    prompt: &Prompt,
    on_text: &(dyn Fn(&str) + Send + Sync),
) -> Result<Answer> {
    let mut answer = Answer::default();
    let mut failure: Option<CoreError> = None;
    let exit = process::run_lines(helper, &[], &request(prompt), |line| {
        match serde_json::from_str::<Line>(line) {
            Ok(Line::Text { text }) => on_text(&text),
            Ok(Line::Done { text }) => answer.text = text,
            Ok(Line::Error { kind, message }) => {
                failure = Some(CoreError::Ai(match kind.as_str() {
                    "unavailable" => unavailable_text(&message),
                    _ => message,
                }))
            }
            _ => {}
        }
        Ok(ControlFlow::Continue(()))
    })
    .await?;
    if let Some(e) = failure {
        return Err(e);
    }
    if !exit.success && answer.text.is_empty() {
        return Err(CoreError::Ai(format!(
            "Apple Intelligence failed: {}",
            exit.stderr
        )));
    }
    // On-device: free, and Apple doesn't report tokens.
    answer.usage = Usage::default();
    Ok(answer)
}

#[cfg(test)]
mod tests {
    use super::*;
    use crate::ai::Quality;

    #[test]
    fn reads_every_kind_of_line() {
        let parse = |s: &str| serde_json::from_str::<Line>(s).unwrap();
        assert_eq!(
            parse(r#"{"type":"status","available":false,"reason":"notEnabled"}"#),
            Line::Status {
                available: false,
                reason: Some("notEnabled".into())
            }
        );
        assert_eq!(
            parse(r#"{"type":"text","text":"Hi"}"#),
            Line::Text { text: "Hi".into() }
        );
        assert_eq!(
            parse(r#"{"message":"x","kind":"tooLong","type":"error"}"#),
            Line::Error {
                kind: "tooLong".into(),
                message: "x".into()
            }
        );
    }

    #[test]
    fn request_carries_the_instructions_and_cap() {
        let r: serde_json::Value = serde_json::from_str(&request(&Prompt {
            instructions: "Be brief".into(),
            input: "Hello \"there\"".into(),
            quality: Quality::Fast,
            max_tokens: Some(80),
        }))
        .unwrap();
        assert_eq!(r["op"], "respond");
        assert_eq!(r["prompt"], "Hello \"there\"");
        assert_eq!(r["maxTokens"], 80);
    }

    /// A stand-in helper (a shell script) answering as the real one does.
    #[cfg(unix)]
    #[tokio::test]
    async fn streams_then_returns_the_whole_answer() {
        let dir = std::env::temp_dir().join(format!("ai-apple-test-{}", fastrand::u64(..)));
        std::fs::create_dir_all(&dir).unwrap();
        let helper = dir.join("ai-helper");
        std::fs::write(
            &helper,
            "#!/bin/sh\ncat >/dev/null\necho '{\"type\":\"text\",\"text\":\"Hel\"}'\necho '{\"type\":\"done\",\"text\":\"Hello\"}'\n",
        )
        .unwrap();
        make_executable(&helper);
        let seen = std::sync::Mutex::new(Vec::new());
        let prompt = Prompt {
            instructions: String::new(),
            input: "x".into(),
            quality: Quality::Fast,
            max_tokens: None,
        };
        let answer = ask(&helper, &prompt, &|t: &str| {
            seen.lock().unwrap().push(t.to_string())
        })
        .await
        .unwrap();
        assert_eq!(answer.text, "Hello");
        assert_eq!(*seen.lock().unwrap(), ["Hel"]);
        let _ = std::fs::remove_dir_all(dir);
    }

    #[cfg(unix)]
    fn make_executable(path: &Path) {
        use std::os::unix::fs::PermissionsExt;
        std::fs::set_permissions(path, std::fs::Permissions::from_mode(0o755)).unwrap();
    }
}

/// Apple's on-device translation of a text.
#[derive(Debug, Clone, PartialEq)]
pub struct Translated {
    pub text: String,
    /// The language it was in, and is now in (e.g. "fr", "en").
    pub source: String,
    pub target: String,
}

/// The helper's one answer to a quick request (translation, languages).
async fn one_answer(
    helper: &Path,
    request: &str,
) -> Result<std::result::Result<Line, (String, String)>> {
    let mut answer = None;
    let exit = process::run_lines(helper, &[], request, |line| {
        match serde_json::from_str::<Line>(line) {
            Ok(Line::Error { kind, message }) => answer = Some(Err((kind, message))),
            Ok(other) => answer = Some(Ok(other)),
            Err(_) => return Ok(ControlFlow::Continue(())),
        }
        Ok(ControlFlow::Break(()))
    })
    .await?;
    answer.ok_or_else(|| {
        CoreError::Ai(format!(
            "Apple's translation didn't answer: {}",
            exit.stderr
        ))
    })
}

/// Translates `text` into `target` (a language code such as "en-US") on
/// the Mac. `Ok(None)` when Apple can't do it here (the language isn't
/// downloaded or offered, or it can't tell which language the text is),
/// so someone else can try.
pub async fn translate(helper: &Path, text: &str, target: &str) -> Result<Option<Translated>> {
    let request = json!({ "op": "translate", "prompt": text, "target": target }).to_string();
    match one_answer(helper, &request).await? {
        Ok(Line::Translated {
            text,
            source,
            target,
        }) => Ok(Some(Translated {
            text,
            source,
            target,
        })),
        Err((kind, message)) => match kind.as_str() {
            "notInstalled" | "unsupported" | "unknownLanguage" => Ok(None),
            "sameLanguage" => Err(CoreError::Invalid(
                "That text is already in that language.".into(),
            )),
            _ => Err(CoreError::Ai(message)),
        },
        Ok(_) => Err(CoreError::Ai("Apple's translation answered oddly.".into())),
    }
}

/// The language a text is written in ("fr"), if the Mac can tell.
pub async fn detect(helper: &Path, text: &str) -> Option<String> {
    let request = json!({ "op": "detect", "prompt": text }).to_string();
    match one_answer(helper, &request).await {
        Ok(Ok(Line::Language { code })) => code,
        _ => None,
    }
}

/// The languages Apple's translation offers (codes, some regional).
pub async fn languages(helper: &Path) -> Vec<String> {
    let request = json!({ "op": "languages" }).to_string();
    match one_answer(helper, &request).await {
        Ok(Ok(Line::Languages { codes })) => codes,
        _ => Vec::new(),
    }
}
