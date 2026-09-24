/**
 * Injected into YouTube's MAIN execution world at document_start.
 * Directly overrides document.hidden and visibilityState for YouTube's own scripts.
 */

(function initMainWorldSpoof() {
  'use strict';

  // 1. Override Page Visibility API in the MAIN world
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

    document.hasFocus = () => true;

    // Block visibility change events from propagating to YouTube's scripts
    window.addEventListener('visibilitychange', (e) => e.stopImmediatePropagation(), true);
    window.addEventListener('webkitvisibilitychange', (e) => e.stopImmediatePropagation(), true);
  } catch (err) {
    console.debug('[Readwise Auto-Liker MAIN] Visibility override note:', err);
  }

  // 2. Mute all video and audio playback immediately
  function silenceVideos() {
    try {
      const videos = document.querySelectorAll('video');
      videos.forEach(v => {
        v.muted = true;
        v.volume = 0;
        if (!v.paused) v.pause();
      });
    } catch (_) {}
  }

  silenceVideos();

  if (document.documentElement) {
    const observer = new MutationObserver(silenceVideos);
    observer.observe(document.documentElement, { childList: true, subtree: true });
  }

  // 3. Trigger simulated scroll and resize to force Polymer to render below-player metadata
  function forceMetadataRender() {
    try {
      window.scrollTo(0, 100);
      window.dispatchEvent(new Event('scroll'));
      window.dispatchEvent(new Event('resize'));
    } catch (_) {}
  }

  if (document.readyState === 'loading') {
    document.addEventListener('DOMContentLoaded', () => {
      setTimeout(forceMetadataRender, 500);
      setTimeout(forceMetadataRender, 1200);
      setTimeout(forceMetadataRender, 2500);
    });
  } else {
    setTimeout(forceMetadataRender, 500);
    setTimeout(forceMetadataRender, 1200);
    setTimeout(forceMetadataRender, 2500);
  }
})();
