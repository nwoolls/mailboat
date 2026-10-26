// Prevents an extra console window on Windows in release builds.
#![cfg_attr(not(debug_assertions), windows_subsystem = "windows")]

fn main() {
    // Started by an AI app (Claude) as its MCP server: pass its requests
    // to the running the app, and nothing else.
    if std::env::args().skip(1).any(|a| a == "--mcp") {
        std::process::exit(desktop_lib::run_mcp_proxy());
    }
    desktop_lib::run()
}
