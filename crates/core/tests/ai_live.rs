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

async fn write_with(provider: AiProvider) {
    use mailboat_core::ai::context::{ContextMessage, ThreadText};
    use mailboat_core::ai::prompts::{self, ChatRole, ChatTurn, WritingContext};
    use mailboat_core::model::{Address, MessageId};
    let thread = ThreadText {
        subject: "Quarterly review".into(),
        messages: vec![ContextMessage {
            id: MessageId(1),
            from: Address { name: Some("Sam Lee".into()), email: "sam@example.com".into() },
            to: vec![Address { name: Some("Jordan".into()), email: "jordan@example.com".into() }],
            date: 1_792_000_000_000,
            mine: false,
            text: "Hi Jordan, the quarterly review moved to Thursday 3pm in room 4B. Can you bring the budget numbers? Thanks, Sam".into(),
        }],
        missing_bodies: vec![],
    };
    let ctx = WritingContext {
        thread: Some(thread),
        writer: "Jordan <jordan@example.com>".into(),
        kind: "reply".into(),
        to: "Sam Lee <sam@example.com>".into(),
        subject: "Re: Quarterly review".into(),
        draft: String::new(),
    };
    let chat = vec![ChatTurn {
        role: ChatRole::User,
        text: "Say yes, but I'll be 10 minutes late".into(),
    }];
    let prompt = prompts::write(&ctx, &chat, provider);
    let answer = ai::ask(&programs(), provider, &prompt, &|_| {})
        .await
        .unwrap();
    println!("--- {provider:?} wrote:\n{}\n", answer.text);
    assert!(!answer.text.is_empty());
}

#[tokio::test]
#[ignore]
async fn apple_writes() {
    write_with(AiProvider::Apple).await;
}

#[tokio::test]
#[ignore]
async fn claude_writes() {
    write_with(AiProvider::Claude).await;
}

#[tokio::test]
#[ignore]
async fn chatgpt_writes() {
    write_with(AiProvider::ChatGpt).await;
}
