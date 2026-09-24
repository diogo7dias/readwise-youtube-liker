/**
 * Content script running on read.readwise.io
 * Adds an optional quick-trigger button to the Reader interface.
 */

(function initReaderHelper() {
  // Check if we are already injected
  if (document.getElementById('rw-yt-autolike-pill')) return;

  function injectFloatingButton() {
    // Only inject on web app views if not already present
    if (document.getElementById('rw-yt-autolike-pill')) return;

    const pill = document.createElement('div');
    pill.id = 'rw-yt-autolike-pill';
    pill.innerHTML = `
      <div class="rw-yt-pill-content" title="Open YouTube Auto-Liker for Readwise Archive">
        <svg viewBox="0 0 24 24" width="16" height="16" fill="currentColor">
          <path d="M1 21h4V9H1v12zm22-11c0-1.1-.9-2-2-2h-6.31l.95-4.57.03-.32c0-.41-.17-.79-.44-1.06L14.17 1 7.59 7.59C7.22 7.95 7 8.45 7 9v10c0 1.1.9 2 2 2h9c.83 0 1.54-.5 1.84-1.22l3.02-7.05c.09-.23.14-.47.14-.73v-2z"/>
        </svg>
        <span>Like Archive</span>
      </div>
    `;

    // Modern styling for the floating button
    const style = document.createElement('style');
    style.textContent = `
      #rw-yt-autolike-pill {
        position: fixed;
        bottom: 24px;
        right: 24px;
        z-index: 999999;
        font-family: -apple-system, BlinkMacSystemFont, "Segoe UI", Roboto, sans-serif;
      }
      .rw-yt-pill-content {
        display: flex;
        align-items: center;
        gap: 8px;
        background: #FF0000;
        color: #ffffff;
        padding: 8px 16px;
        border-radius: 20px;
        box-shadow: 0 4px 14px rgba(255, 0, 0, 0.35);
        font-size: 13px;
        font-weight: 600;
        cursor: pointer;
        transition: transform 0.15s ease, box-shadow 0.15s ease, background 0.15s ease;
        user-select: none;
      }
      .rw-yt-pill-content:hover {
        transform: translateY(-2px);
        background: #E60000;
        box-shadow: 0 6px 18px rgba(255, 0, 0, 0.45);
      }
      .rw-yt-pill-content:active {
        transform: translateY(0);
      }
    `;

    document.head.appendChild(style);
    document.body.appendChild(pill);

    pill.addEventListener('click', () => {
      // Notify background to open popup or start scan
      chrome.runtime.sendMessage({ action: 'OPEN_POPUP_OR_NOTIFY' });
    });
  }

  // Inject when body is ready
  if (document.body) {
    injectFloatingButton();
  } else {
    document.addEventListener('DOMContentLoaded', injectFloatingButton);
  }
})();
