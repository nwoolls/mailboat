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
