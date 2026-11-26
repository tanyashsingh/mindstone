# Sync and the phone app

Mindstone keeps your devices in step without trusting anyone with your data. Every change is encrypted on the
device with a key made from your **sync passphrase** before it leaves; the folder or server stores only scrambled
files. The passphrase never leaves your devices.

## Option 1: a folder (desktop app)

Use a folder that something already keeps in step between your computers: OneDrive, Dropbox, Google Drive for
desktop, Syncthing, or a USB drive you carry.

1. **Settings → Synchronization → A folder → Choose folder…**
2. Enter a sync passphrase (at least 10 characters) and choose **Turn on sync**.
3. On your other computer, choose the same folder and enter the same passphrase.

Mindstone writes into a `Mindstone Sync` folder inside the one you chose: a `space.json` (the salt and a
check value, no data) and one sub-folder of numbered change files per device.

## Option 2: your own sync server (any device, including phones)

The server is one file with no dependencies (`server/sync-server.mjs`, Node 20 or later). It stores encrypted change
files and can also serve the Mindstone web app, so a phone can install Mindstone from it.

```powershell
npm run build:web
node server/sync-server.mjs --port 8787 --data C:\mindstone-sync-data --static dist
```

Or with Docker:

```powershell
npm run build:web
docker build -f server/Dockerfile -t mindstone-sync .
docker run -d -p 8787:8787 -v mindstone-sync-data:/data mindstone-sync
```

**Use HTTPS for phones.** Browsers only install apps and allow offline use over HTTPS (or on the same computer via
`http://localhost`). Put the server behind a reverse proxy with a certificate, for example
[Caddy](https://caddyserver.com) (`caddy reverse-proxy --from sync.example.com --to localhost:8787`) or
[Tailscale Serve](https://tailscale.com/kb/1312/serve) on your private network.

Then:

1. On the first device: **Settings → Synchronization → A sync server**, enter the server address
   (`https://sync.example.com`), a sync passphrase, and **Turn on sync**. Mindstone shows a **sync code**
   (`https://sync.example.com#…`).
2. On each other device: enter the sync code and the same passphrase.
3. **Phone:** open the server address in the phone's browser, then **Add to Home screen** (Safari) or
   **Install app** (Chrome). Open Settings from the menu and join with the sync code and passphrase. The phone layout
   has a bottom bar with Menu, Home, Capture, Tasks and Search, and the app opens offline.

What the server stores: per sync space, `space.json` (salt and check value), `auth.json` (a hash of a token derived from
your key; the server never sees the key or passphrase), and numbered encrypted change files per device. Change files
are never modified once written.

## How changes and conflicts work

- Sync runs when Mindstone starts, every minute, when the device comes back online, and when you choose **Sync now**.
- Each device finds what changed by comparing every item with the version it last exchanged, so every kind of edit is
  included.
- If the same item changed on two devices between syncs, **the later change wins**. For pages, the other version is
  kept in the page's history (named "before sync" or "from another device"), so nothing written is lost.
- Settings, AI search indexes and the passphrase-protection key stay on each device; they are not synced.
- A device that joins a space while it still has only the untouched starter workspace drops that workspace and uses
  the synced one.

## Limits

- Change files are not compacted yet: the space grows with every change (attachments are sent again only when they
  change).
- There is no real-time collaboration; it is device sync for one person.
