/**
 * Content script running on YouTube to handle auto-liking videos.
 * Only executes liking when explicitly invoked via chrome.runtime messages.
 */

// Mute and pause all videos on page immediately to prevent loud autoplay in background
function silencePlayer() {
  try {
    const videos = document.querySelectorAll('video');
    videos.forEach(v => {
      v.muted = true;
      if (!v.paused) {
        v.pause();
      }
    });
  } catch (err) {
    console.debug('[Readwise Auto-Liker] Silence error:', err);
  }
}

// Continuously keep video muted while page loads
const silenceInterval = setInterval(silencePlayer, 200);
setTimeout(() => clearInterval(silenceInterval), 8000);

// Helper to find the Like button across various YouTube desktop & mobile layouts
function findLikeButton() {
  // Layout 1: Modern Segmented Like/Dislike Button (Standard watch page)
  const segmented = document.querySelector('segmented-like-dislike-button-view-model, #segmented-like-button');
  if (segmented) {
    const likeBtn = segmented.querySelector('like-button-view-model button, button:first-of-type');
    if (likeBtn) return likeBtn;
  }

  // Layout 2: Like button view model
  const likeViewModel = document.querySelector('like-button-view-model button');
  if (likeViewModel) return likeViewModel;

  // Layout 3: Shorts like button
  const shortsLike = document.querySelector('ytd-like-button-renderer button, #like-button button, ytd-reel-player-header-renderer button[aria-label*="like" i]');
  if (shortsLike) return shortsLike;

  // Layout 4: Top-level action buttons computed
  const actionButton = document.querySelector('#top-level-buttons-computed ytd-toggle-button-renderer:first-child button');
  if (actionButton) return actionButton;

  // Layout 5: Fallback search across all buttons for aria-label or title
  const buttons = Array.from(document.querySelectorAll('button'));
  for (const btn of buttons) {
    const label = (btn.getAttribute('aria-label') || '').toLowerCase();
    const title = (btn.getAttribute('title') || '').toLowerCase();
    if ((label.includes('like') && !label.includes('dislike')) ||
        (title.includes('like') && !title.includes('dislike'))) {
      return btn;
    }
  }

  return null;
}

// Check whether the like button is currently active/pressed
function isAlreadyLiked(button) {
  if (!button) return false;

  // Standard accessibility attribute for toggled state
  const ariaPressed = button.getAttribute('aria-pressed');
  if (ariaPressed === 'true') return true;

  // Modern YouTube often uses aria-label="Unlike" when already liked
  const label = (button.getAttribute('aria-label') || '').toLowerCase();
  if (label.includes('unlike') || label.includes('remove like')) return true;

  // Class indicator check
  if (button.classList.contains('yt-spec-button-shape-next--tonal') &&
      !button.closest('dislike-button-view-model')) {
    // Might be active, verify aria-pressed isn't explicitly false
    if (ariaPressed !== 'false') return true;
  }

  return false;
}

// Execute the liking workflow
async function handleLikeRequest() {
  silencePlayer();

  const maxWaitMs = 12000;
  const pollIntervalMs = 350;
  const startTime = Date.now();

  let likeBtn = null;

  // Poll until Like button appears in YouTube's dynamically rendered DOM
  while (Date.now() - startTime < maxWaitMs) {
    likeBtn = findLikeButton();
    if (likeBtn) break;
    await new Promise(res => setTimeout(res, pollIntervalMs));
  }

  if (!likeBtn) {
    return {
      success: false,
      error: 'Could not find YouTube Like button. The video may be private, age-restricted, or layout changed.'
    };
  }

  // Check if it's already liked
  if (isAlreadyLiked(likeBtn)) {
    return {
      success: true,
      alreadyLiked: true,
      message: 'Video was already liked on YouTube.'
    };
  }

  // Click the like button
  likeBtn.click();

  // Wait briefly to confirm state change
  const confirmStart = Date.now();
  let confirmed = false;

  while (Date.now() - confirmStart < 4000) {
    await new Promise(res => setTimeout(res, 300));
    if (isAlreadyLiked(likeBtn)) {
      confirmed = true;
      break;
    }

    // Check if a sign-in dialog appeared (user not logged in to YouTube)
    const dialog = document.querySelector('ytd-modal-with-title-and-button-renderer, tp-yt-paper-dialog');
    if (dialog && dialog.textContent.toLowerCase().includes('sign in')) {
      return {
        success: false,
        error: 'YouTube requires sign-in. Please log in to your YouTube account in this Chrome profile.'
      };
    }
  }

  return {
    success: true,
    alreadyLiked: false,
    confirmed: confirmed,
    message: confirmed ? 'Successfully liked video on YouTube.' : 'Like clicked (state update pending).'
  };
}

// Listen for messages from background script
chrome.runtime.onMessage.addListener((request, sender, sendResponse) => {
  if (request.action === 'EXECUTE_LIKE') {
    handleLikeRequest().then(result => {
      sendResponse(result);
    }).catch(err => {
      sendResponse({ success: false, error: err.message || String(err) });
    });
    return true; // Keep message channel open for async response
  }
});
