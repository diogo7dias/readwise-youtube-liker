# Readwise Reader - YouTube Auto-Liker (Chrome Extension)

A Chrome extension for **Readwise Reader** that scans your archived YouTube videos, opens them in muted background tabs to **click "Like" on YouTube** (using your logged-in YouTube session), and updates Readwise Reader by adding the **`liked`** tag so you know they are permanently marked as watched.

---

## 🌟 Features

- **Automated YouTube Liking**: Uses your existing logged-in YouTube account in Chrome. No complex Google Cloud / OAuth setup needed.
- **Prevents Unliking**: Checks `aria-pressed="true"` on YouTube before clicking. If a video is already liked, it skips the click and marks it tagged.
- **Silent & Unobtrusive**: Opens YouTube tabs in the background and mutes/pauses the player automatically. No loud sound blasts while you work.
- **Readwise Reader Tagging**: Automatically updates the document in Readwise Reader by adding the tag `#liked` (preserves all existing tags).
- **Anti-Bot Rate Limiting**: Batches operations and inserts a polite delay (configurable, default 2.5s) between tabs so YouTube's anti-spam systems are not triggered.
- **Live Progress & Activity Log**: Track what video is currently being processed, watch the progress bar, and pause/resume/stop at any time.
- **100% Local & Private**: Runs entirely in your browser. Your Readwise API token stays in your browser's secure storage.

---

## 🚀 How to Install

### In Zen Browser (Your Default Browser)

**Option A: Instant load in your current open Zen session**
1. In Zen Browser, navigate to: `about:debugging#/runtime/this-firefox` (we already opened this tab for you).
2. Click **Load Temporary Add-on...**
3. Select:
   ```
   /home/ddm/Projects/readwise-youtube-liker/manifest.json
   ```
   (or `/home/ddm/Projects/readwise-youtube-liker/readwise-youtube-liker.xpi`)
4. The extension is now active in Zen Browser!

**Option B: Permanent Enterprise Policy (Already Configured)**
- We configured Zen Browser's enterprise policies in `/opt/zen-browser-bin/distribution/policies.json` to automatically install `/home/ddm/Projects/readwise-youtube-liker/readwise-youtube-liker.xpi` across browser launches.

---

### In Google Chrome / Chromium
1. Open Chrome and navigate to `chrome://extensions/`.
2. Enable **Developer mode** in the top-right.
3. Click **Load unpacked** in the top-left.
4. Select the directory:
   ```
   /home/ddm/Projects/readwise-youtube-liker
   ```

---

## 🔑 Initial Setup (Readwise Token)

1. Get your Readwise API Access Token from [readwise.io/access_token](https://readwise.io/access_token).
2. Click the extension icon in Chrome.
3. Paste your token and click **Connect**.
4. The extension will verify the token and show "Readwise Connected".

---

## 📖 How to Use

1. Open Readwise Reader or click the extension icon anytime.
2. Click **🔍 Scan Archive**.
   - The extension queries your Readwise archive for YouTube videos (`youtube.com` / `youtu.be`).
   - It separates them into videos that still need liking and videos already tagged `liked`.
3. Choose your batch size (e.g., *Next 10*, *Next 25*, or *All pending*).
4. Click **▶ Start Liking & Tagging**.
5. The extension will:
   - Open each YouTube video in a muted background tab.
   - Detect the YouTube Like button and click it.
   - Close the tab.
   - Update Readwise Reader with the tag `liked`.
   - Log each step in the Activity Log.
   - Send a notification when completed!

---

## ⚙️ Customization (Options Page)

Right-click the extension icon and select **Options** (or click the ⚙️ gear icon in the popup) to customize:
- **Tag Name**: Default is `liked`. You can change it to `watched`, `yt-liked`, or anything you prefer.
- **Delay Between Videos**: Default is `2.5 seconds`.
- **Mute Audio**: Keep checked to ensure background tabs stay silent.
- **Test Connection**: Verify your Readwise API token anytime.

---

## 🛠️ Project Structure

- `manifest.json`: Manifest V3 extension configuration and permissions.
- `background.js`: Service worker managing archive scanning, tab opening, and queue execution.
- `youtube_content.js`: Injected into YouTube tabs to find the Like button, verify state, and click.
- `reader_content.js`: Injected into `read.readwise.io` providing quick-trigger integration.
- `popup.html` / `popup.js` / `popup.css`: User interface with scanner, batching controls, and live log.
- `options.html` / `options.js`: Extension settings page.
- `icons/`: Extension icons in SVG and PNG formats (16px, 48px, 128px).
