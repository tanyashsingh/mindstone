# Releasing Mindstone

Releases are built and published by GitHub Actions. Nothing is published from a developer machine.

## Pipelines

| Workflow | Runs on | Does |
|---|---|---|
| `.github/workflows/ci.yml` | every push to `main`, every pull request | `npm ci`, stages the speech model (checksums verified), typecheck, unit tests, `npm audit`, Playwright end-to-end tests in Chrome, builds the installer and keeps it as a build artifact for 14 days |
| `.github/workflows/release.yml` | a pushed `v*` tag | checks the tag matches `package.json`, runs the unit tests, builds the installer, creates the GitHub release with notes from `CHANGELOG.md` and uploads the installer, its `.blockmap` and `latest.yml` |
| `.github/workflows/codeql.yml` | push, pull request, weekly | CodeQL security scan of the TypeScript |
| `.github/dependabot.yml` | weekly | grouped dependency and GitHub Actions update pull requests |

## Cutting a release

```powershell
npm version minor --no-git-tag-version   # or patch / major
# Add a "## X.Y.Z (YYYY-MM-DD)" section to CHANGELOG.md: it becomes the release notes.
npm run check:all
git commit -am "Release X.Y.Z"
git tag -a vX.Y.Z -m "Mindstone X.Y.Z"
git push origin main --follow-tags
```

The installed app checks `https://github.com/tanyashsingh/mindstone/releases` (via `latest.yml`) 60 seconds after start
and every 12 hours, downloads a newer version in the background, and offers **Restart to update**. People can turn this
off in **Settings → About**. Only published (not draft or pre-release) releases are offered.

## Code signing

Builds are unsigned until a certificate is added, so Windows SmartScreen warns on first install. To sign:

1. Get a code-signing certificate. Options: an OV/EV certificate from a CA (a `.pfx` file), or
   [Azure Trusted Signing](https://learn.microsoft.com/azure/trusted-signing/) (a low-cost subscription;
   electron-builder supports it through `win.azureSignOptions`).
2. For a `.pfx`: add two repository secrets, `CSC_LINK` (the file base64-encoded, or an https URL) and
   `CSC_KEY_PASSWORD`. The release workflow passes them to electron-builder, which signs the app, the uninstaller and
   the installer. Without them it builds unsigned.
3. For Azure Trusted Signing: add `azureSignOptions` under `build.win` in `package.json` and the `AZURE_TENANT_ID`,
   `AZURE_CLIENT_ID` and `AZURE_CLIENT_SECRET` secrets, and expose them in the build step's `env`.

Never commit a certificate or its password.
