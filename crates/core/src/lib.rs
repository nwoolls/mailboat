//! Mailboat core: everything that is not UI or Tauri glue.
//!
//! The Tauri crate (`src-tauri`) is a thin layer over this one: it registers
//! commands, forwards events to the window and owns OS integration.
