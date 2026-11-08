//! The app core: everything that is not UI or Tauri glue.
//!
//! The Tauri crate (`src-tauri`) is a thin layer over this one: it registers
//! commands, forwards events to the window and owns OS integration.

pub mod actions;
pub mod ai;
pub mod attachments;
pub mod auth;
pub mod brand;
pub mod calendar;
pub mod compose;
pub mod db;
pub mod demo;
pub mod error;
pub mod gmail;
pub mod labels;
pub mod mail;
pub mod mcp;
pub mod model;
/// Checks for the readers of untrusted text other than HTML: for the property
/// tests and the fuzz targets in `fuzz/` (the `fuzzing` feature). Not in the app.
#[cfg(any(test, feature = "fuzzing"))]
pub mod parse_check;
pub mod rules;
pub mod settings;
pub mod sync;
pub mod vacation;

pub use error::{CoreError, Result};
pub use reqwest;
