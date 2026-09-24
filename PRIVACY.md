# Privacy Policy for Readwise YouTube Liker

**Last updated:** September 2026

Readwise YouTube Liker is built with user privacy as a fundamental priority. It runs entirely within your browser and does not collect, transmit, or monetize your personal data.

---

## 1. Data Collection & Analytics
- **No data collection**: The extension does not collect, record, track, or share any personal information, browsing history, or analytics.
- **No third-party servers**: The extension operates with zero external servers. All operations happen directly between your browser and the official services you connect to (Readwise and YouTube).
- **No advertising**: The extension contains no ads, tracking pixels, or telemetry scripts.

---

## 2. API Tokens & Authentication
- **Readwise Access Token**: Stored exclusively in your browser's local synchronized storage (`chrome.storage.sync`). It is only transmitted directly to Readwise's official API (`https://readwise.io/api/v3/`) via encrypted HTTPS to retrieve your archived videos and update tags. It is never transmitted anywhere else.
- **YouTube Authentication**: Uses your existing, active YouTube browser session. The extension never accesses, views, or stores your Google or YouTube account credentials.

---

## 3. Browser Permissions
The extension requests only the minimum permissions necessary to function:
- **`storage`**: Used to save your Readwise API token and personal preferences (such as batch size and delay duration) locally on your device.
- **`tabs`**: Used to open YouTube videos in background tabs to register the like action, and close them once complete.
- **`notifications`**: Used to display a desktop notification when a queue or duplicate scan completes.
- **Host Permissions (`readwise.io`, `youtube.com`)**: Required to query the Readwise Reader API and interact with the YouTube like button.

---

## 4. Open Source
The complete source code is public and open for audit at:
[https://github.com/diogo7dias/readwise-youtube-liker](https://github.com/diogo7dias/readwise-youtube-liker)

---

## 5. Contact
If you have questions about this privacy policy, please open an issue on the [GitHub repository](https://github.com/diogo7dias/readwise-youtube-liker/issues).
