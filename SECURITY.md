# Security policy

## Reporting a vulnerability

Please report security issues privately through GitHub's **Report a vulnerability** button on the
[Security tab](https://github.com/tanyashsingh/mindstone/security/advisories/new), not in public issues.
Include the version, steps to reproduce, and the impact you expect. You'll get an acknowledgement within a few days.

Supported versions: the latest release only.

## Security model

Mindstone is a local-first desktop app with no server. Your data stays on your computer unless you turn on a
cloud AI provider, and then only what you send to it leaves the device.

- **Renderer isolation**: context isolation, sandboxed renderer, no Node.js in pages, strict Content Security
  Policy (no remote scripts), navigation locked to the app, external links opened in the system browser,
  `<webview>` blocked.
- **IPC**: every privileged call checks that it comes from the app's own page and validates its arguments.
- **Permissions**: everything is denied except the microphone (audio only) and screen-audio capture for voice
  notes, and only for the app's own page.
- **Secrets**: AI provider keys are encrypted with Windows DPAPI (Electron `safeStorage`) and decrypted only in
  the main process; page code never sees them. Logs never contain keys or document content.
- **Content**: rich text, Markdown, Mermaid and AI output are sanitised (DOMPurify); links are limited to
  http, https and mailto; the database formula language is parsed and evaluated without `eval`.
- **Files**: executable attachments are blocked, file names are sanitised, CSV exports neutralise formula
  injection, and the private `cairn-asset://` scheme serves only bundled speech-model files, read-only, with
  path-traversal checks.
- **AI**: imported documents, PDFs, transcripts and retrieved notes are passed to models as quoted data, never as
  instructions. The assistant can only propose tasks; nothing is created without your confirmation. Cloud AI
  is off until you enable it, and a request rate limit and daily token budget cap accidental spending.
- **Packaged app hardening (Electron fuses)**: the app cannot be run as a plain Node.js runtime, ignores
  `NODE_OPTIONS` and `--inspect` flags, loads code only from its packaged archive, and validates that archive's
  integrity at startup.
- **Supply chain**: Dependabot updates, CodeQL code scanning and `npm audit` run in CI; the speech model is
  downloaded once at build time and verified against Hugging Face's published SHA-256.

## Known limitations

- Data at rest is protected by your Windows account; Mindstone adds no encryption of its own and does not
  offer end-to-end encryption.
- Release installers are not yet code-signed, so Windows SmartScreen warns on first run.
