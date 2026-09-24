/**
 * Content script running on YouTube to handle auto-liking videos.
 * Runs at document_start to spoof page visibility and silence audio immediately.
 */

// 1. Spoof Page Visibility API so YouTube renders full player & metadata in background tabs
try {
  Object.defineProperty(document, 'hidden', {
    get: () => false,
    configurable: true,
  });
  Object.defineProperty(document, 'visibilityState', {
    get: () => 'visible',
    configurable: true,
  });
  Object.defineProperty(document, 'webkitHidden', {
    get: () => false,
    configurable: true,
  });
  Object.defineProperty(document, 'webkitVisibilityState', {
    get: () => 'visible',
    configurable: true,
  });

  // Block visibilitychange events so YouTube never detects inactive tab
  window.addEventListener('visibilitychange', (e) => e.stopImmediatePropagation(), true);
  window.addEventListener('webkitvisibilitychange', (e) => e.stopImmediatePropagation(), true);
} catch (e) {
  console.debug('[Readwise Auto-Liker] Visibility override note:', e);
}

// 2. Mute and pause all audio/video playback immediately
function silenceMedia() {
  try {
    const videos = document.querySelectorAll('video');
    videos.forEach(v => {
      v.muted = true;
      v.volume = 0;
      if (!v.paused) {
        v.pause();
      }
    });
  } catch (_) {}
}

silenceMedia();

// Continuously watch for newly inserted video elements and mute them
if (document.documentElement) {
  const mediaObserver = new MutationObserver(() => silenceMedia());
  mediaObserver.observe(document.documentElement, { childList: true, subtree: true });
}

// 3. Recursive Shadow DOM & Light DOM search for YouTube's Like Button
function findYouTubeLikeButton() {
  // Strategy A: Direct light DOM queries
  const lightSelectors = [
    'segmented-like-dislike-button-view-model button',
    'like-button-view-model button',
    '#segmented-like-button button',
    'ytd-toggle-button-renderer:first-child button',
    '#top-level-buttons-computed button',
    'ytd-like-button-renderer button',
    '#like-button button',
    'ytd-reel-player-header-renderer button',
  ];

  for (const sel of lightSelectors) {
    try {
      const el = document.querySelector(sel);
      if (el && isLikeCandidate(el)) return el;
    } catch (_) {}
  }

  // Strategy B: Traverse known Shadow DOM hosts directly
  const hostSelectors = [
    'like-button-view-model',
    'segmented-like-dislike-button-view-model',
    'toggle-button-view-model',
    'button-view-model',
    'yt-button-shape',
    'ytd-watch-metadata',
    '#top-level-buttons-computed',
  ];

  for (const sel of hostSelectors) {
    try {
      const hosts = document.querySelectorAll(sel);
      for (const host of hosts) {
        if (host.shadowRoot) {
          const btn = host.shadowRoot.querySelector('button');
          if (btn && isLikeCandidate(btn)) return btn;

          // Check nested shadow roots
          const subHosts = host.shadowRoot.querySelectorAll('*');
          for (const sub of subHosts) {
            if (sub.shadowRoot) {
              const subBtn = sub.shadowRoot.querySelector('button');
              if (subBtn && isLikeCandidate(subBtn)) return subBtn;
            }
          }
        }
      }
    } catch (_) {}
  }

  // Strategy C: Full recursive search across all open Shadow Roots
  function searchRoots(node) {
    if (!node) return null;

    if (node.querySelectorAll) {
      const buttons = node.querySelectorAll('button, [role="button"]');
      for (const btn of buttons) {
        if (isLikeCandidate(btn)) return btn;
      }
    }

    const all = node.querySelectorAll ? node.querySelectorAll('*') : [];
    for (const el of all) {
      if (el.shadowRoot) {
        const found = searchRoots(el.shadowRoot);
        if (found) return found;
      }
    }

    return null;
  }

  return searchRoots(document);
}

// Check if a button element is actually a Like button (not dislike)
function isLikeCandidate(btn) {
  if (!btn) return false;
  const label = (btn.getAttribute('aria-label') || '').toLowerCase();
  const title = (btn.getAttribute('title') || '').toLowerCase();
  const text = (btn.textContent || '').trim().toLowerCase();

  // Exclude dislike explicitly
  if (label.includes('dislike') || title.includes('dislike')) return false;

  // Match like patterns
  if (label.includes('like this') || label.startsWith('like') || label.includes('liked')) return true;
  if (title.includes('like this') || title.startsWith('like')) return true;

  // Check closest custom element tag
  if (btn.closest && btn.closest('like-button-view-model')) return true;

  return false;
}

// Check if the button is currently liked
function isButtonLiked(btn) {
  if (!btn) return false;

  // 1. Check aria-pressed
  const pressed = btn.getAttribute('aria-pressed');
  if (pressed === 'true') return true;

  // 2. Check aria-label for state
  const label = (btn.getAttribute('aria-label') || '').toLowerCase();
  if (label.includes('unlike') || label.includes('remove like')) return true;

  // 3. Check tonal styling class on button or its shadow host
  if (btn.classList.contains('yt-spec-button-shape-next--tonal')) {
    const parentDislike = btn.closest ? btn.closest('dislike-button-view-model') : null;
    if (!parentDislike) return true;
  }

  // 4. Check ancestors up to 5 levels
  let cur = btn;
  for (let i = 0; i < 5 && cur; i++) {
    if (cur.getAttribute && cur.getAttribute('aria-pressed') === 'true') return true;
    if (cur.classList && cur.classList.contains('yt-spec-button-shape-next--tonal')) {
      const curLabel = (cur.getAttribute('aria-label') || '').toLowerCase();
      if (!curLabel.includes('dislike')) return true;
    }
    cur = cur.parentElement || (cur.parentNode && cur.parentNode.host ? cur.parentNode.host : null);
  }

  return false;
}

// Main execution routine
async function executeLikeWorkflow() {
  silenceMedia();

  const maxWaitMs = 18000;
  const pollIntervalMs = 350;
  const startTime = Date.now();

  let likeBtn = null;

  // Poll until Like button is discovered
  while (Date.now() - startTime < maxWaitMs) {
    silenceMedia();
    likeBtn = findYouTubeLikeButton();
    if (likeBtn) break;
    await new Promise(r => setTimeout(r, pollIntervalMs));
  }

  if (!likeBtn) {
    // Collect page diagnostic info
    const totalButtons = document.querySelectorAll('button').length;
    const title = document.title;
    return {
      success: false,
      error: `Could not find YouTube Like button after 18s (page: "${title}", buttons found: ${totalButtons}).`,
    };
  }

  // Check if already liked
  if (isButtonLiked(likeBtn)) {
    return {
      success: true,
      alreadyLiked: true,
      message: 'Video was already liked on YouTube.',
    };
  }

  // Click the like button
  try {
    likeBtn.click();
    likeBtn.dispatchEvent(new MouseEvent('click', { bubbles: true, cancelable: true, view: window }));
  } catch (clickErr) {
    console.warn('[Readwise Auto-Liker] Click error:', clickErr);
  }

  // Wait to verify like state updated
  const confirmStart = Date.now();
  let confirmed = false;

  while (Date.now() - confirmStart < 4000) {
    await new Promise(r => setTimeout(r, 350));
    if (isButtonLiked(likeBtn)) {
      confirmed = true;
      break;
    }

    // Check for sign-in dialog
    const dialog = document.querySelector('ytd-modal-with-title-and-button-renderer, tp-yt-paper-dialog');
    if (dialog && dialog.textContent.toLowerCase().includes('sign in')) {
      return {
        success: false,
        error: 'YouTube requires sign-in. Please log into YouTube in this browser profile.',
      };
    }
  }

  return {
    success: true,
    alreadyLiked: false,
    confirmed: confirmed,
    message: confirmed ? 'Successfully liked video on YouTube.' : 'Like clicked on YouTube.',
  };
}

// Auto-run if opened with the rw_autolike=1 parameter
let executionStarted = false;

function checkAutoStart() {
  if (executionStarted) return;
  const url = window.location.href;
  if (url.includes('rw_autolike=1')) {
    executionStarted = true;
    // Allow DOM 1s to settle
    setTimeout(() => {
      executeLikeWorkflow().then(result => {
        chrome.runtime.sendMessage({ action: 'LIKE_RESULT', ...result });
      }).catch(err => {
        chrome.runtime.sendMessage({ action: 'LIKE_RESULT', success: false, error: err.message || String(err) });
      });
    }, 1000);
  }
}

if (document.readyState === 'loading') {
  document.addEventListener('DOMContentLoaded', checkAutoStart);
} else {
  checkAutoStart();
}

// Also handle manual invocation from background script
chrome.runtime.onMessage.addListener((request, sender, sendResponse) => {
  if (request.action === 'EXECUTE_LIKE') {
    executeLikeWorkflow().then(result => {
      sendResponse(result);
    }).catch(err => {
      sendResponse({ success: false, error: err.message || String(err) });
    });
    return true;
  }
});
