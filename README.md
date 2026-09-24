# Readwise YouTube Liker

A browser extension for **Zen Browser**, **Firefox**, and **Chrome** that bridges **Readwise Reader** and **YouTube**.

Automatically opens archived YouTube videos in muted background tabs to **Like** them on YouTube (marking them permanently as watched in your YouTube history), tags them as **`liked`** in Readwise Reader, and detects & cleans duplicate saved videos across your library.

---

## Features

- **Automated YouTube Liking**: Uses your active browser YouTube session—no complex Google Cloud API or OAuth setup needed.
- **Duplicate Video Detector**: Scans your archive or entire library for videos saved multiple times using canonical video ID extraction (`watch`, `shorts`, `embed`, `youtu.be`).
- **Smart Retention**: Prioritizes keeping copies that have user notes or highlights, or the oldest original save; flags newer duplicates for deletion or tagging.
- **Bulk Cleanup**: Permanently delete newer duplicates via Readwise API or batch-tag them as `#duplicate`.
- **Dual-Worker Concurrency**: 2 staggered background workers double processing speed without tripping rate limits.
- **Silent & Unobtrusive**: Mutes and pauses background tabs immediately.
- **Prevents Unliking**: Checks button state before clicking. Videos already liked are safely skipped.
- **100% Local & Private**: Runs entirely inside your browser. Your Readwise API token stays in secure local storage.

---

## Installation

### Zen Browser / Firefox

1. Open `about:debugging#/runtime/this-firefox` in your browser.
2. Click **Load Temporary Add-on...**
3. Select `manifest.json` or `readwise-youtube-liker.xpi` from this repository.

### Chrome / Chromium

1. Open `chrome://extensions/`.
2. Toggle **Developer mode** on (top-right).
3. Click **Load unpacked** (top-left) and select this project directory.

---

## Setup

1. Copy your Readwise API Access Token from [readwise.io/access_token](https://readwise.io/access_token).
2. Click the extension icon in your browser toolbar.
3. Paste your token and click **Connect**.

---

## Usage

### 1. Auto-Liker
- Open the extension and click **Scan Archive**.
- Choose a batch size (10, 25, 50, or All).
- Click **Start Liking & Tagging**. The extension opens tabs in the background, likes each video, tags it `#liked` in Readwise, and closes the tab.

### 2. Duplicate Cleaner
- Click the **Duplicates** tab in the popup.
- Select scope (**Archive Only** or **Entire Library**) and click **Scan Duplicates**.
- Review detected groups showing **KEEP** and **DELETE** recommendations.
- Click **Delete Newer Copies** or **Tag All as #duplicate**.

---

## Settings

Click the ⚙️ gear icon in the popup to configure:
- **Tag Name**: Default `liked`.
- **Duplicate Tag Name**: Default `duplicate`.
- **Concurrent Workers**: 1 (gentle) or 2 (fast, staggered).
- **Delay Between Videos**: Default `2.5s`.
- **Mute Audio**: Mutes media playback in background tabs.

---

## License

MIT
