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
pub mod rules;
pub mod settings;
pub mod sync;
pub mod vacation;

pub use error::{CoreError, Result};
pub use reqwest;
