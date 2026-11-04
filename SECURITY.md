# Security

Mailboat reads and sends your email, so security reports are taken seriously.

## Reporting a problem

Please **don't open a public issue** for a security problem. Use either:

- GitHub's private reporting: the **Security** tab → **Report a vulnerability**, or
- email `security@getmailboat.app`.

Say what you found, how to reproduce it, and which version.

## What to expect

This is a one-person project, so these are goals, not promises:

- **A first reply** within 7 days.
- **A fix or a plan** within 30 days for a confirmed problem. Anything that
  could expose mail or sign-in tokens comes before all other work.
- **Disclosure:** please keep the details private until a fix is out. Once it
  is, the fix and what it changed are written up in the release notes, with
  credit to you if you want it. If a problem is still open after 90 days, you
  are free to publish it.

Only the latest version is supported.

## What matters most

Anything that could expose mail or sign-in tokens: the sanitizing of email HTML,
the sandboxed message view, the OAuth flow, how tokens are kept in the OS
keychain, and the AI and MCP features (which are fenced so that mail only
leaves the device when you choose).

How the app protects against these is written down in
[`docs/ARCHITECTURE.md`](docs/ARCHITECTURE.md).
