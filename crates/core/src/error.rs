use thiserror::Error;

/// Every failure the core can report. `kind()` gives the UI a stable,
/// machine-readable category; the message is for humans.
#[derive(Debug, Error)]
pub enum CoreError {
    #[error("database error: {0}")]
    Db(#[from] rusqlite::Error),
    #[error("not found: {0}")]
    NotFound(String),
    #[error("invalid input: {0}")]
    Invalid(String),
    /// The account needs to sign in again (refresh token revoked or expired).
    #[error("sign-in required: {0}")]
    Auth(String),
    /// Google asked us to slow down and retries were exhausted.
    #[error("rate limited by Google: {0}")]
    RateLimited(String),
    /// The stored historyId is too old; a full resync is required.
    #[error("history expired; full resync required")]
    HistoryExpired,
    #[error("network error: {0}")]
    Network(String),
    #[error("Google API error {status}: {message}")]
    Api { status: u16, message: String },
    #[error("configuration error: {0}")]
    Config(String),
    #[error("keychain error: {0}")]
    Keychain(String),
    /// The user cancelled (e.g. closed sign-in). Not shown as an error.
    #[error("cancelled")]
    Cancelled,
    /// A sign-in that Google completed without the permission to read mail
    /// (its boxes start empty, and Continue works with none ticked). The
    /// message says what to do, for people.
    #[error("{0}")]
    MissingMailPermission(String),
    /// An AI provider failed or refused; the message says why, for people.
    #[error("{0}")]
    Ai(String),
    #[error("{0}")]
    Other(String),
}

impl CoreError {
    pub fn kind(&self) -> &'static str {
        match self {
            CoreError::Db(_) => "db",
            CoreError::NotFound(_) => "not_found",
            CoreError::Invalid(_) => "invalid",
            CoreError::Auth(_) => "auth",
            CoreError::RateLimited(_) => "rate_limited",
            CoreError::HistoryExpired => "history_expired",
            CoreError::Network(_) => "network",
            CoreError::Api { .. } => "api",
            CoreError::Config(_) => "config",
            CoreError::Keychain(_) => "keychain",
            CoreError::Cancelled => "cancelled",
            CoreError::MissingMailPermission(_) => "missing_mail_permission",
            CoreError::Ai(_) => "ai",
            CoreError::Other(_) => "other",
        }
    }

    /// The error as the sync log may show it. The log never carries what
    /// Google or the mail wrote: an API answer shows only its status (the
    /// retry lines already log Google's reason codes), and the errors that
    /// can hold free text (a 404's message among them) show only their
    /// kind. What stays whole is written by this app: database and
    /// keychain errors, a transport error (its URL already removed), fixed
    /// sign-in and rate-limit texts (reason codes only). The full message
    /// is for the person using the app, in the window.
    pub fn for_log(&self) -> String {
        match self {
            CoreError::Api { status, .. } => format!("Google API error {status}"),
            CoreError::NotFound(_)
            | CoreError::Invalid(_)
            | CoreError::Other(_)
            | CoreError::Ai(_) => format!("{} error", self.kind()),
            other => other.to_string(),
        }
    }

    /// Google refused because the account's sign-in lacks a permission
    /// (it signed in before the app asked for it).
    pub fn is_missing_scope(&self) -> bool {
        matches!(self, CoreError::Api { status: 403, message } if message.contains("insufficient"))
    }

    /// Errors worth retrying later with backoff (as opposed to needing the
    /// user to do something).
    pub fn is_transient(&self) -> bool {
        matches!(
            self,
            CoreError::RateLimited(_)
                | CoreError::Network(_)
                | CoreError::Api { status: 500.., .. }
        )
    }
}

impl From<serde_json::Error> for CoreError {
    fn from(e: serde_json::Error) -> Self {
        CoreError::Other(format!("json: {e}"))
    }
}

pub type Result<T> = std::result::Result<T, CoreError>;

#[cfg(test)]
mod tests {
    use super::*;

    #[test]
    fn the_log_shows_an_api_answers_status_but_not_its_message() {
        let e = CoreError::Api {
            status: 400,
            message: "Invalid query from:ada@example.com [badRequest]".into(),
        };
        assert_eq!(e.for_log(), "Google API error 400");
    }

    #[test]
    fn free_text_errors_show_only_their_kind_and_fixed_ones_keep_their_text() {
        for e in [
            CoreError::Invalid("bad address ada@example.com".into()),
            // A Gmail 404's message, as the client builds it.
            CoreError::NotFound("No message ada@example.com madeupsecret".into()),
            CoreError::Other("made up text".into()),
            CoreError::Ai("made up answer".into()),
        ] {
            let line = e.for_log();
            assert!(
                !line.contains("example.com") && !line.contains("made up"),
                "{line}"
            );
        }
        assert_eq!(
            CoreError::Auth("sign-in timed out".into()).for_log(),
            "sign-in required: sign-in timed out"
        );
        assert_eq!(
            CoreError::RateLimited("[rateLimitExceeded]".into()).for_log(),
            "rate limited by Google: [rateLimitExceeded]"
        );
    }
}
