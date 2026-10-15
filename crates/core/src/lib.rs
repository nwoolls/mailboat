//! Mailboat core: everything that is not UI or Tauri glue.
//!
//! The Tauri crate (`src-tauri`) is a thin layer over this one: it registers
//! commands, forwards events to the window and owns OS integration.

pub mod auth;
pub mod db;
pub mod error;
pub mod gmail;
pub mod mail;
pub mod model;
pub mod sync;

pub use error::{CoreError, Result};
pub use reqwest;
