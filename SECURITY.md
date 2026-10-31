# Security

Mailboat reads and sends your email, so security reports are taken seriously.

## Reporting a problem

Please **don't open a public issue** for a security problem. Use either:

- GitHub's private reporting: the **Security** tab → **Report a vulnerability**, or
- email `security@getmailboat.app`.

Say what you found, how to reproduce it, and which version. You'll get an
answer within a few days. This is a one-person project, so please allow time
for a fix.

## What matters most

Anything that could expose mail or sign-in tokens: the sanitizing of email HTML,
the sandboxed message view, the OAuth flow, how tokens are kept in the OS
keychain, and the AI and MCP features (which are fenced so that mail only
leaves the device when you choose).

How the app protects against these is written down in
[`docs/ARCHITECTURE.md`](docs/ARCHITECTURE.md).
