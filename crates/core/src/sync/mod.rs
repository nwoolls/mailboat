//! Background sync: per-account workers running full and incremental passes.

pub mod engine;
pub mod older;
pub mod worker;

pub use engine::{
    fetch_body, refresh_labels, ScopePart, SyncConfig, SyncEngine, SyncKind, SyncOutcome,
    SyncPhase, SyncProgress, SCOPE_VERSION,
};
pub use older::{load_older, OlderCursor, OLDER_BATCH};
pub use worker::{Supervisor, SyncEvents, WorkerTiming};
