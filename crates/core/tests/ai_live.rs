//! Asks the real providers on this Mac (Apple's helper, `claude`, `codex`).
//! Ignored by default: they need sign-ins and the network. Run with
//! `cargo test -p mailboat-core --test ai_live -- --ignored --nocapture`
//! after building the app once (for `target/debug/mailboat-ai`).

use mailboat_core::ai::{self, AiProvider, Programs, Prompt, Quality};

fn programs() -> Programs {
    let helper =
        std::path::Path::new(env!("CARGO_MANIFEST_DIR")).join("../../target/debug/mailboat-ai");
    Programs::find(Some(helper))
}

async fn check(provider: AiProvider) {
    let programs = programs();
    let status = ai::status(&programs, provider).await;
    println!("{provider:?}: {status:?}");
    let prompt = Prompt {
        instructions: "Summarize the email in at most 12 words. Plain text.".into(),
        input: "From: Sam\n\nHi Jordan, the quarterly review moved to Thursday 3pm in room 4B. Please bring the budget numbers.".into(),
        quality: Quality::Fast,
        max_tokens: Some(60),
    };
    let answer = ai::ask(&programs, provider, &prompt, &|_| {})
        .await
        .unwrap();
    println!(
        "{provider:?} said {:?} ({:?}, limits {:?})",
        answer.text, answer.usage, answer.limits
    );
    assert!(!answer.text.is_empty());
}

#[tokio::test]
#[ignore]
async fn apple_answers() {
    check(AiProvider::Apple).await;
}

#[tokio::test]
#[ignore]
async fn claude_answers() {
    check(AiProvider::Claude).await;
}

#[tokio::test]
#[ignore]
async fn chatgpt_answers() {
    check(AiProvider::ChatGpt).await;
}
