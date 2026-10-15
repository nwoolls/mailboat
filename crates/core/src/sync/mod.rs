//! Background sync: per-account workers running full and incremental passes.

pub mod engine;
pub mod worker;

pub use engine::{
    fetch_body, ScopePart, SyncConfig, SyncEngine, SyncKind, SyncOutcome, SyncPhase, SyncProgress,
    SCOPE_VERSION,
};
pub use worker::{Supervisor, SyncEvents, WorkerTiming};
