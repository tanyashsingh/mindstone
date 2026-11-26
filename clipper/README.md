# Mindstone Web Clipper

A Chrome / Edge extension (Manifest V3) that saves the current page, your selection, or a simplified article into
the Mindstone desktop app on the same computer. Clips appear as pages under **Web clips**, tagged `#clip`, and are
searchable and available to AI.

## Install

1. In Mindstone: **Settings → Integrations → Web clipper**, turn it on. Copy the pairing code.
2. In Chrome or Edge: open `chrome://extensions` (or `edge://extensions`), turn on **Developer mode**, choose
   **Load unpacked**, and pick this folder (Settings → Integrations has a link that opens it; in the installed app it
   is in Mindstone's `resources\clipper` folder).
3. Click the Mindstone icon in the browser toolbar, open **Pairing**, paste the code, and choose **Save and test**.

## How it stays private

- The extension talks only to `http://127.0.0.1:43117` (this computer). Its permissions are `activeTab` (only the tab
  you clip, only when you click), `scripting` (to read that tab) and `storage` (the pairing code).
- Mindstone accepts clips only with the pairing code, and refuses requests that come from web pages, so a website
  can't send things into your workspace. Turning the clipper off closes the port.
- Scripts, forms, frames and tracking attributes are removed before saving; Mindstone sanitises the HTML again.
