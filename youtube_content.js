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

if (document.documentElement) {
  const mediaObserver = new MutationObserver(() => silenceMedia());
  mediaObserver.observe(document.documentElement, { childList: true, subtree: true });
}

// Helper: Traverse parent hierarchy crossing Shadow DOM boundaries
function closestAcrossShadow(element, selector) {
  let current = element;
  while (current) {
    if (current.matches && current.matches(selector)) {
      return current;
    }
    if (current.parentElement) {
      current = current.parentElement;
    } else if (current.parentNode && current.parentNode.host) {
      // Step outside the Shadow Root to its host element
      current = current.parentNode.host;
    } else {
      break;
    }
  }
  return null;
}

// Helper: Recursively search for custom element tag across light DOM and all shadow roots
function findCustomElementDeep(root, tagName) {
  if (!root) return null;
  const targetTag = tagName.toLowerCase();

  // Check direct query if available
  if (root.querySelector) {
    try {
      const el = root.querySelector(targetTag);
      if (el) return el;
    } catch (_) {}
  }

  // Traverse children and shadow roots
  const elements = root.querySelectorAll ? Array.from(root.querySelectorAll('*')) : [];
  for (const el of elements) {
    if (el.tagName && el.tagName.toLowerCase() === targetTag) {
      return el;
    }
    if (el.shadowRoot) {
      const nested = findCustomElementDeep(el.shadowRoot, targetTag);
      if (nested) return nested;
    }
  }
  return null;
}

// Helper: Extract clickable button from inside a host element (drilling down through shadow roots)
function extractButtonFromHost(host) {
  if (!host) return null;
  if (host.tagName === 'BUTTON') return host;

  if (host.querySelector) {
    const b = host.querySelector('button');
    if (b) return b;
  }

  // Drill down into shadow root
  if (host.shadowRoot) {
    function searchDown(node) {
      if (!node) return null;
      if (node.tagName === 'BUTTON') return node;
      if (node.querySelector) {
        const direct = node.querySelector('button');
        if (direct) return direct;
      }
      const children = node.querySelectorAll ? Array.from(node.querySelectorAll('*')) : [];
      for (const child of children) {
        if (child.tagName === 'BUTTON') return child;
        if (child.shadowRoot) {
          const res = searchDown(child.shadowRoot);
          if (res) return res;
        }
      }
      return null;
    }

    const shadowBtn = searchDown(host.shadowRoot);
    if (shadowBtn) return shadowBtn;
  }

  return null;
}

// 3. Multi-Strategy Search for YouTube Like Button
function findYouTubeLikeButton() {
  // Strategy 1: Top-down search for <like-button-view-model> (Works in ALL languages!)
  const likeVm = findCustomElementDeep(document, 'like-button-view-model');
  if (likeVm) {
    const btn = extractButtonFromHost(likeVm);
    if (btn) return btn;
  }

  // Strategy 2: Direct query for segmented button or like button in light DOM
  const lightSelectors = [
    'like-button-view-model button',
    'segmented-like-dislike-button-view-model like-button-view-model button',
    '#segmented-like-button button',
    'ytd-toggle-button-renderer:first-child button',
    '#top-level-buttons-computed button:first-child',
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

  // Strategy 3: Full recursive search across all shadow roots
  function searchAllRoots(node) {
    if (!node) return null;

    if (node.querySelectorAll) {
      const buttons = node.querySelectorAll('button, [role="button"]');
      for (const btn of buttons) {
        if (isLikeCandidate(btn)) return btn;
      }
    }

    const all = node.querySelectorAll ? Array.from(node.querySelectorAll('*')) : [];
    for (const el of all) {
      if (el.shadowRoot) {
        const found = searchAllRoots(el.shadowRoot);
        if (found) return found;
      }
    }

    return null;
  }

  return searchAllRoots(document);
}

// Check if a button element is the Like button (handles English, Portuguese, Spanish, French, etc.)
function isLikeCandidate(btn) {
  if (!btn) return false;

  // 1. Structural check: Is this inside a like-button-view-model? (Shadow-piercing)
  if (closestAcrossShadow(btn, 'like-button-view-model')) return true;

  // 2. Structural exclusion: Is this inside a dislike-button-view-model?
  if (closestAcrossShadow(btn, 'dislike-button-view-model')) return false;

  const label = (btn.getAttribute('aria-label') || '').toLowerCase();
  const title = (btn.getAttribute('title') || '').toLowerCase();
  const text = (btn.textContent || '').trim().toLowerCase();

  // Exclude dislike across languages (English: dislike; PT: não gosto; ES: no me gusta; FR: je n'aime pas; DE: mag ich nicht)
  const dislikePatterns = ['dislike', 'não gosto', 'nao gosto', 'no me gusta', "je n'aime pas", 'mag ich nicht', 'non mi piace'];
  for (const dp of dislikePatterns) {
    if (label.includes(dp) || title.includes(dp) || text.includes(dp)) return false;
  }

  // Match like across languages (English: like; PT: gosto/gostar; ES: me gusta; FR: j'aime; DE: mag ich; IT: mi piace)
  const likePatterns = [
    'like this', 'like', 'liked',
    'gosto deste', 'gostar deste', 'gosto', 'gostar',
    'me gusta', 'gusta',
    "j'aime", 'aime',
    'mag ich',
    'mi piace'
  ];

  for (const lp of likePatterns) {
    if (label.includes(lp) || title.includes(lp) || text.includes(lp)) return true;
  }

  return false;
}

// Check if the video is currently liked
function isButtonLiked(btn) {
  if (!btn) return false;

  // 1. ARIA pressed attribute (Standard W3C - works in all languages)
  if (btn.getAttribute('aria-pressed') === 'true') return true;

  // 2. Check wrappers across shadow roots for aria-pressed
  if (closestAcrossShadow(btn, '[aria-pressed="true"]')) return true;

  // 3. Check for tonal class (YouTube adds yt-spec-button-shape-next--tonal when active)
  if (btn.classList.contains('yt-spec-button-shape-next--tonal')) {
    if (!closestAcrossShadow(btn, 'dislike-button-view-model')) return true;
  }
  const tonalParent = closestAcrossShadow(btn, '.yt-spec-button-shape-next--tonal');
  if (tonalParent && !closestAcrossShadow(btn, 'dislike-button-view-model')) {
    return true;
  }

  // 4. Language-specific "Unlike" / "Remover gosto" aria-labels
  const label = (btn.getAttribute('aria-label') || '').toLowerCase();
  const unlikePatterns = ['unlike', 'remover gosto', 'já não gosto', 'ja nao gosto', 'remover o gosto', 'ya no me gusta', "je n'aime plus"];
  for (const up of unlikePatterns) {
    if (label.includes(up)) return true;
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

  // Click the like button with multiple synthetic event types for reliability
  try {
    likeBtn.click();
    likeBtn.dispatchEvent(new PointerEvent('pointerdown', { bubbles: true, cancelable: true }));
    likeBtn.dispatchEvent(new MouseEvent('mousedown', { bubbles: true, cancelable: true }));
    likeBtn.dispatchEvent(new PointerEvent('pointerup', { bubbles: true, cancelable: true }));
    likeBtn.dispatchEvent(new MouseEvent('mouseup', { bubbles: true, cancelable: true }));
    likeBtn.dispatchEvent(new MouseEvent('click', { bubbles: true, cancelable: true }));
  } catch (clickErr) {
    console.warn('[Readwise Auto-Liker] Click error:', clickErr);
  }

  // Wait to verify like state updated
  const confirmStart = Date.now();
  let confirmed = false;

  while (Date.now() - confirmStart < 4000) {
    await new Promise(r => setTimeout(r, 300));
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
