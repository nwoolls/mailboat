//! Gmail REST API: client, batching, response types and parsing.

pub mod batch;
pub mod client;
pub mod pacer;
pub mod parse;
pub mod types;

pub use client::{GmailClient, RetryPolicy, TokenSource};
pub use pacer::QuotaPacer;
