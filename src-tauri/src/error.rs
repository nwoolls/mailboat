use mail_core::CoreError;
use serde::Serialize;
use specta::Type;

/// The error shape every command returns to the UI.
#[derive(Debug, Clone, Serialize, Type)]
#[serde(rename_all = "camelCase")]
pub struct AppError {
    /// Stable category, e.g. "auth", "config", "network".
    pub kind: String,
    pub message: String,
}

impl From<CoreError> for AppError {
    fn from(e: CoreError) -> Self {
        Self {
            kind: e.kind().to_string(),
            message: e.to_string(),
        }
    }
}

pub type CmdResult<T> = Result<T, AppError>;
