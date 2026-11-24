# AI (optional)

Settings → AI. Summaries and writing help use **Apple Intelligence** by
default: nothing to set up beyond turning it on in System Settings →
Apple Intelligence & Siri, and mail stays on the Mac.

To use **Claude** or **ChatGPT** instead, install its command-line tool,
then press Connect in Settings → AI; the tool's own sign-in opens in the
browser and uses your subscription (no API key):

| Provider | Install | Signs in with |
|---|---|---|
| Claude | [Claude Code](https://claude.com/product/claude-code) (`claude`) | `claude auth login` |
| ChatGPT | [Codex CLI](https://developers.openai.com/codex/cli) (`codex`) | `codex login` |

On Windows and Linux there's no Apple Intelligence, so summaries and
writing help use Claude or ChatGPT once one is connected. On Linux, install
bubblewrap (`bwrap`; most distributions have a package by that name) so
ChatGPT runs fenced in as on the Mac (some systems don't allow it, such as
inside a container). Without it, ChatGPT runs as it does on Windows: every
Codex setting that adds a tool is turned off, and ChatGPT pauses if Codex
keeps one on that hasn't been reviewed, but nothing on your computer stops
a tool that reads files.

If Connect's browser sign-in doesn't finish, run the sign-in command in
Terminal once, then press Connect again. Disconnecting only stops Mailboat
using it; the tool stays signed in.

To check all three from Terminal after building once:
`cargo test -p mail-core --test ai_live -- --ignored --nocapture`.

## AI apps (Claude Desktop, Claude Code)

Mailboat can let AI apps search and read your mail (and save drafts) over
MCP, while Mailboat is open. In Settings → AI → AI apps, turn on the
accounts to share (all are off to begin with), then press Connect for
Claude Code or Claude Desktop (quit and reopen Claude Desktop after).
Any other MCP app can run `<Mailboat's program> --mcp`; Settings shows the
exact command. Spam and Trash are never shared, nothing is ever sent,
and Settings lists what was asked for.
