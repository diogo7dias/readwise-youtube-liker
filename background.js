/**
 * Background Service Worker for Readwise YouTube Auto-Liker
 */

const DEFAULT_SETTINGS = {
  readwiseToken: '',
  tagName: 'liked',
  delaySeconds: 2.5,
  batchLimit: 25,
  muteAudio: true,
};

// Global in-memory state for queue orchestration
const state = {
  status: 'idle', // 'idle' | 'scanning' | 'running' | 'paused' | 'completed' | 'error'
  queue: [],
  currentIndex: 0,
  completedCount: 0,
  errorCount: 0,
  currentDoc: null,
  logs: [],
  activeTabId: null,
};

function addLog(message, type = 'info') {
  const timestamp = new Date().toLocaleTimeString([], { hour: '2-digit', minute: '2-digit', second: '2-digit' });
  const entry = { time: timestamp, message, type };
  state.logs.unshift(entry);
  if (state.logs.length > 100) {
    state.logs.pop();
  }
}

// Helper to extract clean YouTube Watch URL
function getCleanYouTubeUrl(sourceUrl) {
  if (!sourceUrl) return null;
  try {
    const url = new URL(sourceUrl);
    if (url.hostname.includes('youtube.com')) {
      if (url.pathname.startsWith('/shorts/')) {
        const id = url.pathname.split('/shorts/')[1].split('/')[0];
        return `https://www.youtube.com/watch?v=${id}`;
      }
      const v = url.searchParams.get('v');
      if (v) return `https://www.youtube.com/watch?v=${v}`;
    } else if (url.hostname === 'youtu.be') {
      const id = url.pathname.slice(1).split('/')[0];
      return `https://www.youtube.com/watch?v=${id}`;
    }
  } catch (_) {
    const match = sourceUrl.match(/(?:v=|\/shorts\/|youtu\.be\/)([a-zA-Z0-9_-]{11})/);
    if (match) return `https://www.youtube.com/watch?v=${match[1]}`;
  }
  return sourceUrl;
}

// Check if a document is a YouTube video
function isYouTubeDoc(doc) {
  const url = doc.source_url || doc.url || '';
  return /(?:youtube\.com\/(?:watch|shorts)|youtu\.be\/)/i.test(url);
}

// Check if doc already contains tag
function hasTag(doc, tagName) {
  if (!doc.tags) return false;
  const target = tagName.trim().toLowerCase();
  if (Array.isArray(doc.tags)) {
    return doc.tags.some(t => (typeof t === 'string' ? t : t.name || '').toLowerCase() === target);
  }
  if (typeof doc.tags === 'object') {
    return Object.keys(doc.tags).some(k => k.toLowerCase() === target);
  }
  return false;
}

// Extract existing tags as an array of strings
function getExistingTagNames(doc) {
  if (!doc.tags) return [];
  if (Array.isArray(doc.tags)) {
    return doc.tags.map(t => (typeof t === 'string' ? t : t.name)).filter(Boolean);
  }
  if (typeof doc.tags === 'object') {
    return Object.keys(doc.tags);
  }
  return [];
}

// Fetch all archived YouTube videos from Readwise Reader API
async function scanArchive(token, targetTag, maxPages = 5) {
  if (!token) throw new Error('Readwise API token is missing.');

  state.status = 'scanning';
  addLog('Connecting to Readwise API to fetch archived videos...', 'info');

  const pendingVideos = [];
  const alreadyLikedVideos = [];
  let pageCursor = null;
  let pageCount = 0;

  while (pageCount < maxPages) {
    pageCount++;
    const params = new URLSearchParams({ location: 'archive' });
    if (pageCursor) params.set('pageCursor', pageCursor);

    const response = await fetch(`https://readwise.io/api/v3/list/?${params.toString()}`, {
      method: 'GET',
      headers: {
        'Authorization': `Token ${token}`,
      },
    });

    if (!response.ok) {
      if (response.status === 401) {
        throw new Error('Invalid Readwise Access Token. Check your token at readwise.io/access_token');
      }
      throw new Error(`Readwise API returned status ${response.status}: ${response.statusText}`);
    }

    const data = await response.json();
    const results = data.results || [];

    for (const doc of results) {
      if (isYouTubeDoc(doc)) {
        if (hasTag(doc, targetTag)) {
          alreadyLikedVideos.push(doc);
        } else {
          pendingVideos.push(doc);
        }
      }
    }

    pageCursor = data.nextPageCursor;
    if (!pageCursor) break;
  }

  state.status = 'idle';
  addLog(`Scan complete. Found ${pendingVideos.length} unliked YouTube video(s) and ${alreadyLikedVideos.length} already tagged.`, 'success');

  return {
    pending: pendingVideos,
    alreadyLiked: alreadyLikedVideos,
    totalScanned: pendingVideos.length + alreadyLikedVideos.length,
  };
}

// Tag a document in Readwise Reader
async function addTagToReadwise(token, doc, targetTag) {
  const currentTags = getExistingTagNames(doc);
  const updatedTags = Array.from(new Set([...currentTags, targetTag]));

  // Primary attempt: PATCH https://readwise.io/api/v3/update/<id>/
  try {
    const res = await fetch(`https://readwise.io/api/v3/update/${doc.id}/`, {
      method: 'PATCH',
      headers: {
        'Authorization': `Token ${token}`,
        'Content-Type': 'application/json',
      },
      body: JSON.stringify({ tags: updatedTags }),
    });

    if (res.ok) return true;
  } catch (err) {
    console.warn('[Background] Single update error, trying bulk_update fallback:', err);
  }

  // Fallback attempt: PATCH https://readwise.io/api/v3/bulk_update/
  const bulkRes = await fetch('https://readwise.io/api/v3/bulk_update/', {
    method: 'PATCH',
    headers: {
      'Authorization': `Token ${token}`,
      'Content-Type': 'application/json',
    },
    body: JSON.stringify({
      updates: [{ id: doc.id, tags: updatedTags }],
    }),
  });

  if (!bulkRes.ok) {
    const errorText = await bulkRes.text();
    throw new Error(`Failed to update tags in Readwise: ${bulkRes.status} ${errorText}`);
  }

  return true;
}

// Automate liking a single video via a background tab
function likeVideoInTab(cleanUrl) {
  return new Promise(async (resolve, reject) => {
    let tabId = null;
    let timeoutId = null;

    const cleanup = async () => {
      if (timeoutId) clearTimeout(timeoutId);
      if (tabId) {
        try {
          await chrome.tabs.remove(tabId);
        } catch (_) {}
        if (state.activeTabId === tabId) {
          state.activeTabId = null;
        }
      }
    };

    // Global timeout of 25 seconds for the entire tab liking operation
    timeoutId = setTimeout(async () => {
      await cleanup();
      reject(new Error('Timed out waiting for YouTube tab to load and like.'));
    }, 25000);

    try {
      const tab = await chrome.tabs.create({
        url: cleanUrl,
        active: false, // in background
        muted: true,   // mute tab audio immediately
      });
      tabId = tab.id;
      state.activeTabId = tabId;

      // Listener to wait until tab finishes loading
      const statusListener = async (updatedTabId, changeInfo) => {
        if (updatedTabId === tabId && changeInfo.status === 'complete') {
          chrome.tabs.onUpdated.removeListener(statusListener);

          // Give YouTube scripts 1.2s to initialize custom elements
          await new Promise(r => setTimeout(r, 1200));

          try {
            // Send command to content script
            chrome.tabs.sendMessage(tabId, { action: 'EXECUTE_LIKE' }, async (response) => {
              const lastErr = chrome.runtime.lastError;
              if (lastErr) {
                // If content script was not ready, inject it dynamically as fallback
                try {
                  await chrome.scripting.executeScript({
                    target: { tabId },
                    files: ['youtube_content.js'],
                  });
                  await new Promise(r => setTimeout(r, 800));
                  chrome.tabs.sendMessage(tabId, { action: 'EXECUTE_LIKE' }, async (resp2) => {
                    await cleanup();
                    if (resp2 && resp2.success) {
                      resolve(resp2);
                    } else {
                      reject(new Error(resp2?.error || 'Content script failed to like.'));
                    }
                  });
                  return;
                } catch (injErr) {
                  await cleanup();
                  reject(new Error(`Could not communicate with YouTube tab: ${lastErr.message}`));
                  return;
                }
              }

              await cleanup();
              if (response && response.success) {
                resolve(response);
              } else {
                reject(new Error(response?.error || 'Failed to like video on YouTube.'));
              }
            });
          } catch (sendErr) {
            await cleanup();
            reject(sendErr);
          }
        }
      };

      chrome.tabs.onUpdated.addListener(statusListener);
    } catch (createErr) {
      if (timeoutId) clearTimeout(timeoutId);
      reject(createErr);
    }
  });
}

// Queue execution loop
async function runQueue() {
  const settings = await chrome.storage.sync.get(DEFAULT_SETTINGS);
  const token = settings.readwiseToken;
  const targetTag = settings.tagName || 'liked';
  const delayMs = (settings.delaySeconds || 2) * 1000;

  if (!token) {
    state.status = 'error';
    addLog('No Readwise token configured.', 'error');
    return;
  }

  state.status = 'running';
  chrome.action.setBadgeText({ text: '▶' });
  chrome.action.setBadgeBackgroundColor({ color: '#E50914' });

  while (state.status === 'running' && state.currentIndex < state.queue.length) {
    const doc = state.queue[state.currentIndex];
    state.currentDoc = doc;

    const title = doc.title || 'Untitled Video';
    const cleanUrl = getCleanYouTubeUrl(doc.source_url || doc.url);

    addLog(`[${state.currentIndex + 1}/${state.queue.length}] Opening: "${title}"`, 'info');

    try {
      // Step 1: Open YouTube tab and like the video
      const likeResult = await likeVideoInTab(cleanUrl);
      if (likeResult.alreadyLiked) {
        addLog(`Already liked on YouTube: "${title}"`, 'info');
      } else {
        addLog(`Liked on YouTube: "${title}"`, 'success');
      }

      // Step 2: Tag the document in Readwise Reader
      await addTagToReadwise(token, doc, targetTag);
      addLog(`Tagged in Readwise as "${targetTag}": "${title}"`, 'success');

      state.completedCount++;
    } catch (err) {
      state.errorCount++;
      addLog(`Error on "${title}": ${err.message}`, 'error');
    }

    state.currentIndex++;

    // Wait configured delay between videos to prevent anti-bot rate limits
    if (state.status === 'running' && state.currentIndex < state.queue.length) {
      await new Promise(r => setTimeout(r, delayMs));
    }
  }

  if (state.status === 'running') {
    state.status = 'completed';
    chrome.action.setBadgeText({ text: '✓' });
    chrome.action.setBadgeBackgroundColor({ color: '#2ecc71' });

    addLog(`All done! Processed ${state.completedCount} videos (${state.errorCount} errors).`, 'success');

    // Notify user
    chrome.notifications.create({
      type: 'basic',
      iconUrl: 'icons/icon128.png',
      title: 'Readwise YouTube Liker Finished',
      message: `Completed! Liked and tagged ${state.completedCount} video(s).`,
      priority: 2,
    });
  } else if (state.status === 'paused') {
    chrome.action.setBadgeText({ text: '⏸' });
    chrome.action.setBadgeBackgroundColor({ color: '#f39c12' });
  } else {
    chrome.action.setBadgeText({ text: '' });
  }

  state.currentDoc = null;
}

// Runtime message listener
chrome.runtime.onMessage.addListener((request, sender, sendResponse) => {
  if (request.action === 'GET_STATE') {
    sendResponse({ ...state });
    return true;
  }

  if (request.action === 'SCAN_ARCHIVE') {
    chrome.storage.sync.get(DEFAULT_SETTINGS, async (settings) => {
      try {
        const result = await scanArchive(settings.readwiseToken, settings.tagName, request.maxPages || 6);
        sendResponse({ success: true, data: result });
      } catch (err) {
        state.status = 'error';
        sendResponse({ success: false, error: err.message });
      }
    });
    return true;
  }

  if (request.action === 'START_QUEUE') {
    state.queue = request.items || [];
    state.currentIndex = 0;
    state.completedCount = 0;
    state.errorCount = 0;
    runQueue();
    sendResponse({ success: true });
    return true;
  }

  if (request.action === 'PAUSE_QUEUE') {
    state.status = 'paused';
    sendResponse({ success: true });
    return true;
  }

  if (request.action === 'RESUME_QUEUE') {
    runQueue();
    sendResponse({ success: true });
    return true;
  }

  if (request.action === 'CANCEL_QUEUE') {
    state.status = 'idle';
    if (state.activeTabId) {
      chrome.tabs.remove(state.activeTabId).catch(() => {});
      state.activeTabId = null;
    }
    chrome.action.setBadgeText({ text: '' });
    addLog('Queue cancelled by user.', 'info');
    sendResponse({ success: true });
    return true;
  }

  if (request.action === 'VALIDATE_TOKEN') {
    fetch('https://readwise.io/api/v3/list/?location=archive', {
      headers: { Authorization: `Token ${request.token}` },
    }).then(res => {
      sendResponse({ valid: res.ok, status: res.status });
    }).catch(err => {
      sendResponse({ valid: false, error: err.message });
    });
    return true;
  }

  if (request.action === 'OPEN_POPUP_OR_NOTIFY') {
    chrome.action.openPopup ? chrome.action.openPopup() : null;
    return true;
  }
});
