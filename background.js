/**
 * Background Service Worker for Readwise YouTube Auto-Liker
 */

const DEFAULT_SETTINGS = {
  readwiseToken: '',
  tagName: 'liked',
  duplicateTagName: 'duplicate',
  delaySeconds: 2.0,
  batchLimit: 25,
  concurrency: 2,
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
  activeTabIds: new Set(),
  dupProgress: {
    active: false,
    action: null,
    total: 0,
    current: 0,
    currentTitle: '',
    successCount: 0,
    errorCount: 0,
    completed: false,
    message: '',
  },
};

function addLog(message, type = 'info') {
  const timestamp = new Date().toLocaleTimeString([], { hour: '2-digit', minute: '2-digit', second: '2-digit' });
  const entry = { time: timestamp, message, type };
  state.logs.unshift(entry);
  if (state.logs.length > 100) {
    state.logs.pop();
  }
}

// Canonical YouTube Video ID Extractor (handles watch, shorts, embed, youtu.be, mobile)
function extractYouTubeVideoId(urlStr) {
  if (!urlStr) return null;
  try {
    const url = new URL(urlStr);
    const host = url.hostname.toLowerCase();
    if (host.includes('youtube.com')) {
      if (url.pathname.startsWith('/shorts/')) {
        return url.pathname.split('/shorts/')[1].split('/')[0].split('?')[0];
      }
      if (url.pathname.startsWith('/embed/')) {
        return url.pathname.split('/embed/')[1].split('/')[0].split('?')[0];
      }
      return url.searchParams.get('v');
    }
    if (host === 'youtu.be') {
      return url.pathname.slice(1).split('/')[0].split('?')[0];
    }
  } catch (_) {}
  const match = urlStr.match(/(?:v=|\/shorts\/|\/embed\/|youtu\.be\/)([a-zA-Z0-9_-]{11})/i);
  return match ? match[1] : null;
}

// Helper to extract clean YouTube Watch URL
function getCleanYouTubeUrl(sourceUrl) {
  const videoId = extractYouTubeVideoId(sourceUrl);
  if (videoId) {
    return `https://www.youtube.com/watch?v=${videoId}`;
  }
  return sourceUrl;
}

// Check if a document is a YouTube video
function isYouTubeDoc(doc) {
  const url = doc.source_url || doc.url || '';
  return Boolean(extractYouTubeVideoId(url));
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

// Scan for duplicate YouTube videos across Readwise library
async function scanDuplicates(token, locationFilter = 'archive', maxPages = 8) {
  if (!token) throw new Error('Readwise API token is missing.');

  addLog(`Scanning Readwise for duplicate YouTube videos (scope: ${locationFilter})...`, 'info');

  const videoMap = new Map(); // videoId -> [doc, doc...]
  let pageCursor = null;
  let pageCount = 0;
  let totalDocsScanned = 0;

  while (pageCount < maxPages) {
    pageCount++;
    const params = new URLSearchParams();
    if (locationFilter && locationFilter !== 'all') {
      params.set('location', locationFilter);
    }
    if (pageCursor) params.set('pageCursor', pageCursor);

    const response = await fetch(`https://readwise.io/api/v3/list/?${params.toString()}`, {
      method: 'GET',
      headers: { 'Authorization': `Token ${token}` },
    });

    if (!response.ok) {
      throw new Error(`Readwise API returned status ${response.status}: ${response.statusText}`);
    }

    const data = await response.json();
    const results = data.results || [];
    totalDocsScanned += results.length;

    for (const doc of results) {
      const url = doc.source_url || doc.url || '';
      const videoId = extractYouTubeVideoId(url);
      if (videoId) {
        if (!videoMap.has(videoId)) {
          videoMap.set(videoId, []);
        }
        videoMap.get(videoId).push(doc);
      }
    }

    pageCursor = data.nextPageCursor;
    if (!pageCursor) break;
  }

  // Filter groups with > 1 doc
  const duplicateGroups = [];
  let totalDuplicateDocs = 0;

  for (const [videoId, docs] of videoMap.entries()) {
    if (docs.length > 1) {
      // Sort to prioritize keeping the copy with notes/highlights, otherwise oldest saved_at
      docs.sort((a, b) => {
        const aHasNotes = Boolean(a.notes && a.notes.trim().length > 0);
        const bHasNotes = Boolean(b.notes && b.notes.trim().length > 0);
        if (aHasNotes && !bHasNotes) return -1;
        if (!aHasNotes && bHasNotes) return 1;

        const dateA = new Date(a.saved_at || a.created_at || 0).getTime();
        const dateB = new Date(b.saved_at || b.created_at || 0).getTime();
        return dateA - dateB; // older first
      });

      const keepDoc = docs[0];
      const duplicates = docs.slice(1);
      totalDuplicateDocs += duplicates.length;

      duplicateGroups.push({
        videoId,
        title: keepDoc.title || duplicates[0].title || 'Untitled Video',
        keepDoc: {
          id: keepDoc.id,
          title: keepDoc.title,
          location: keepDoc.location,
          saved_at: keepDoc.saved_at || keepDoc.created_at,
          notes: keepDoc.notes || '',
        },
        duplicateDocs: duplicates.map(d => ({
          id: d.id,
          title: d.title,
          location: d.location,
          saved_at: d.saved_at || d.created_at,
          notes: d.notes || '',
        })),
      });
    }
  }

  addLog(`Duplicate scan complete: Found ${duplicateGroups.length} duplicate groups (${totalDuplicateDocs} redundant copies).`, 'success');

  return {
    duplicateGroups,
    totalDuplicateDocs,
    totalScanned: totalDocsScanned,
  };
}

// Delete duplicate documents via Readwise DELETE API with live progress and rate limiting
async function deleteDuplicateDocs(token, items) {
  if (!token) throw new Error('Readwise token missing.');
  if (!items || items.length === 0) return { deletedCount: 0, errors: [] };

  const normItems = items.map(item => (typeof item === 'string' ? { id: item, title: item } : item));
  const total = normItems.length;

  state.dupProgress = {
    active: true,
    action: 'delete',
    total,
    current: 0,
    currentTitle: normItems[0].title || 'Starting...',
    successCount: 0,
    errorCount: 0,
    completed: false,
    message: `Starting deletion of ${total} duplicate copy(ies)...`,
  };

  addLog(`Starting deletion of ${total} duplicate document(s)...`, 'info');
  let deletedCount = 0;
  const errors = [];

  for (let i = 0; i < total; i++) {
    const item = normItems[i];
    const id = item.id;
    const title = item.title || 'Untitled Document';

    state.dupProgress.current = i + 1;
    state.dupProgress.currentTitle = title;
    state.dupProgress.message = `Deleting [${i + 1}/${total}]: "${title}"`;

    addLog(`[${i + 1}/${total}] Deleting duplicate: "${title}"...`, 'info');

    try {
      let res = await fetch(`https://readwise.io/api/v3/delete/${id}/`, {
        method: 'DELETE',
        headers: { 'Authorization': `Token ${token}` },
      });

      // Handle 429 Rate Limit with backoff
      if (res.status === 429) {
        const retryAfter = parseInt(res.headers.get('Retry-After') || '4', 10);
        addLog(`Readwise rate limit reached. Waiting ${retryAfter}s before retrying "${title}"...`, 'warn');
        await new Promise(r => setTimeout(r, retryAfter * 1000));
        res = await fetch(`https://readwise.io/api/v3/delete/${id}/`, {
          method: 'DELETE',
          headers: { 'Authorization': `Token ${token}` },
        });
      }

      if (res.ok || res.status === 204 || res.status === 404) {
        deletedCount++;
        state.dupProgress.successCount = deletedCount;
        addLog(`✓ Deleted from Readwise: "${title}"`, 'success');
      } else {
        const errBody = await res.text().catch(() => '');
        const msg = `HTTP ${res.status}${errBody ? ': ' + errBody.slice(0, 100) : ''}`;
        errors.push(`${title}: ${msg}`);
        state.dupProgress.errorCount = errors.length;
        addLog(`✗ Failed to delete "${title}": ${msg}`, 'error');
      }
    } catch (err) {
      errors.push(`${title}: ${err.message}`);
      state.dupProgress.errorCount = errors.length;
      addLog(`✗ Network error deleting "${title}": ${err.message}`, 'error');
    }

    // Rate-limit safety pause between requests
    if (i < total - 1) {
      await new Promise(r => setTimeout(r, 650));
    }
  }

  state.dupProgress.current = total;
  state.dupProgress.successCount = deletedCount;
  state.dupProgress.errorCount = errors.length;
  state.dupProgress.active = false;
  state.dupProgress.completed = true;
  state.dupProgress.currentTitle = 'Finished';
  state.dupProgress.message = `Completed: ${deletedCount} deleted, ${errors.length} errors.`;

  if (errors.length === 0) {
    addLog(`All done! Successfully deleted ${deletedCount}/${total} duplicate(s).`, 'success');
  } else {
    addLog(`Finished with errors: Deleted ${deletedCount}/${total} (${errors.length} failed).`, 'error');
  }

  return { deletedCount, errors, total };
}

// Tag duplicate documents with a specific tag (e.g. duplicate)
async function tagDuplicateDocs(token, items, tagName = 'duplicate') {
  if (!token) throw new Error('Readwise token missing.');
  if (!items || items.length === 0) return { taggedCount: 0, errors: [] };

  const normItems = items.map(item => (typeof item === 'string' ? { id: item, title: item } : item));
  const total = normItems.length;

  state.dupProgress = {
    active: true,
    action: 'tag',
    total,
    current: 0,
    currentTitle: normItems[0].title || 'Starting...',
    successCount: 0,
    errorCount: 0,
    completed: false,
    message: `Tagging ${total} duplicates as #${tagName}...`,
  };

  addLog(`Tagging ${total} duplicate documents as #${tagName}...`, 'info');

  const updates = normItems.map(item => ({ id: item.id, tags: [tagName] }));
  let taggedCount = 0;
  const errors = [];

  for (let i = 0; i < updates.length; i += 25) {
    const chunk = updates.slice(i, i + 25);
    state.dupProgress.current = Math.min(i + chunk.length, total);
    state.dupProgress.message = `Tagging batch ${Math.floor(i / 25) + 1} (${chunk.length} items)...`;

    try {
      const res = await fetch('https://readwise.io/api/v3/bulk_update/', {
        method: 'PATCH',
        headers: {
          'Authorization': `Token ${token}`,
          'Content-Type': 'application/json',
        },
        body: JSON.stringify({ updates: chunk }),
      });
      if (res.ok) {
        taggedCount += chunk.length;
        state.dupProgress.successCount = taggedCount;
        addLog(`✓ Tagged batch of ${chunk.length} duplicates as #${tagName}.`, 'success');
      } else {
        const errBody = await res.text().catch(() => '');
        errors.push(`Batch failed: HTTP ${res.status} ${errBody}`);
        state.dupProgress.errorCount += chunk.length;
        addLog(`✗ Failed to tag batch: HTTP ${res.status}`, 'error');
      }
    } catch (err) {
      errors.push(`Network error: ${err.message}`);
      state.dupProgress.errorCount += chunk.length;
      addLog(`✗ Network error tagging duplicates: ${err.message}`, 'error');
    }

    if (i + 25 < updates.length) {
      await new Promise(r => setTimeout(r, 600));
    }
  }

  state.dupProgress.current = total;
  state.dupProgress.successCount = taggedCount;
  state.dupProgress.errorCount = errors.length;
  state.dupProgress.active = false;
  state.dupProgress.completed = true;
  state.dupProgress.message = `Finished: Tagged ${taggedCount}/${total} documents.`;

  return { taggedCount, errors, total };
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
    let resolved = false;

    // Attach rw_autolike parameter
    const sep = cleanUrl.includes('?') ? '&' : '?';
    const targetUrl = `${cleanUrl}${sep}rw_autolike=1`;

    let wakeTimer1 = null;
    let wakeTimer2 = null;
    let originalTabId = null;

    try {
      const tabs = await chrome.tabs.query({ currentWindow: true });
      const nonWorker = tabs.find(t => t.active && !t.url?.includes('rw_autolike=1') && !t.url?.includes('youtube.com/watch'));
      if (nonWorker) {
        originalTabId = nonWorker.id;
      } else {
        const anyUserTab = tabs.find(t => !t.url?.includes('rw_autolike=1') && !t.url?.includes('youtube.com/watch'));
        if (anyUserTab) originalTabId = anyUserTab.id;
      }
    } catch (_) {}

    const cleanup = async () => {
      chrome.runtime.onMessage.removeListener(messageListener);
      chrome.tabs.onUpdated.removeListener(statusListener);
      if (timeoutId) clearTimeout(timeoutId);
      if (wakeTimer1) clearTimeout(wakeTimer1);
      if (wakeTimer2) clearTimeout(wakeTimer2);
      if (originalTabId) {
        try {
          const tab = await chrome.tabs.get(originalTabId);
          if (tab && !tab.active) {
            await chrome.tabs.update(originalTabId, { active: true });
          }
        } catch (_) {}
      }
      if (tabId) {
        try {
          await chrome.tabs.remove(tabId);
        } catch (_) {}
        if (state.activeTabId === tabId) {
          state.activeTabId = null;
        }
        state.activeTabIds.delete(tabId);
      }
    };

    const done = async (err, result) => {
      if (resolved) return;
      resolved = true;
      await cleanup();
      if (err) reject(err);
      else resolve(result);
    };

    // 1. Direct message listener from youtube_content.js
    const messageListener = (msg, sender) => {
      if (msg.action === 'LIKE_RESULT' && sender.tab && sender.tab.id === tabId) {
        if (msg.success) {
          done(null, msg);
        } else {
          done(new Error(msg.error || 'Failed to like video on YouTube.'));
        }
      }
    };
    chrome.runtime.onMessage.addListener(messageListener);

    // Global timeout of 28 seconds
    timeoutId = setTimeout(() => {
      done(new Error('Timed out waiting for YouTube tab to load and like.'));
    }, 28000);

    // 2. Multi-stage wake: Stage 1 at 3.5s for 1.2s to trigger initial Polymer mount
    wakeTimer1 = setTimeout(async () => {
      if (resolved || !tabId) return;
      try {
        await chrome.tabs.update(tabId, { active: true });
        setTimeout(async () => {
          if (resolved) return;
          if (originalTabId) {
            try {
              const tab = await chrome.tabs.get(originalTabId);
              if (tab) await chrome.tabs.update(originalTabId, { active: true });
            } catch (_) {}
          }
        }, 1200);
      } catch (_) {}
    }, 3500);

    // Stage 2: Second wake at 8.5s if still waiting
    wakeTimer2 = setTimeout(async () => {
      if (resolved || !tabId) return;
      try {
        await chrome.tabs.update(tabId, { active: true });
        setTimeout(async () => {
          if (resolved) return;
          if (originalTabId) {
            try {
              const tab = await chrome.tabs.get(originalTabId);
              if (tab) await chrome.tabs.update(originalTabId, { active: true });
            } catch (_) {}
          }
        }, 1800);
      } catch (_) {}
    }, 8500);

    // 3. Secondary backup: onUpdated complete trigger
    const statusListener = async (updatedTabId, changeInfo, tabInfo) => {
      if (updatedTabId === tabId && changeInfo.status === 'complete') {
        const url = tabInfo?.url || '';
        if (url && !url.includes('youtube.com')) return;

        // Allow 1.5s for DOM initialization then poke content script
        await new Promise(r => setTimeout(r, 1500));
        if (resolved) return;

        try {
          chrome.tabs.sendMessage(tabId, { action: 'EXECUTE_LIKE' }, (response) => {
            if (chrome.runtime.lastError) return;
            if (response && response.success) {
              done(null, response);
            } else if (response && !response.success) {
              done(new Error(response.error || 'Could not find YouTube Like button.'));
            }
          });
        } catch (_) {}
      }
    };
    chrome.tabs.onUpdated.addListener(statusListener);

    try {
      const tab = await chrome.tabs.create({
        url: targetUrl,
        active: false, // in background
        muted: true,   // mute tab audio immediately
      });
      tabId = tab.id;
      state.activeTabId = tabId;
      state.activeTabIds.add(tabId);
    } catch (createErr) {
      done(createErr);
    }
  });
}

// Queue execution loop with configurable concurrency (1 or 2 workers)
async function runQueue() {
  const settings = await chrome.storage.sync.get(DEFAULT_SETTINGS);
  const token = settings.readwiseToken;
  const targetTag = settings.tagName || 'liked';
  const delayMs = (settings.delaySeconds || 2) * 1000;
  const concurrency = Math.min(Math.max(settings.concurrency || 2, 1), 2);

  if (!token) {
    state.status = 'error';
    addLog('No Readwise token configured.', 'error');
    return;
  }

  state.status = 'running';
  chrome.action.setBadgeText({ text: '▶' });
  chrome.action.setBadgeBackgroundColor({ color: '#E50914' });

  async function worker(workerId) {
    while (state.status === 'running') {
      const index = state.currentIndex++;
      if (index >= state.queue.length) break;

      const doc = state.queue[index];
      state.currentDoc = doc;

      const title = doc.title || 'Untitled Video';
      const cleanUrl = getCleanYouTubeUrl(doc.source_url || doc.url);

      addLog(`[${index + 1}/${state.queue.length}] Opening: "${title}"`, 'info');

      try {
        let likeResult;
        try {
          likeResult = await likeVideoInTab(cleanUrl);
        } catch (firstErr) {
          // Retry once with a fresh background tab if first attempt timed out
          addLog(`Retrying "${title}" (first attempt: ${firstErr.message})...`, 'warn');
          await new Promise(r => setTimeout(r, 1200));
          likeResult = await likeVideoInTab(cleanUrl);
        }

        if (likeResult.alreadyLiked) {
          addLog(`Already liked on YouTube: "${title}"`, 'info');
        } else {
          addLog(`Liked on YouTube: "${title}"`, 'success');
        }

        await addTagToReadwise(token, doc, targetTag);
        addLog(`Tagged in Readwise as "${targetTag}": "${title}"`, 'success');

        state.completedCount++;
      } catch (err) {
        state.errorCount++;
        addLog(`Error on "${title}": ${err.message}`, 'error');
      }

      if (state.status === 'running' && state.currentIndex < state.queue.length) {
        await new Promise(r => setTimeout(r, delayMs));
      }
    }
  }

  const workers = [worker(1)];
  if (concurrency > 1 && state.queue.length > 1) {
    // Stagger worker 2 slightly so tabs don't fire at identical millisecond
    await new Promise(r => setTimeout(r, 1200));
    if (state.status === 'running' && state.currentIndex < state.queue.length) {
      workers.push(worker(2));
    }
  }

  await Promise.all(workers);

  if (state.status === 'running') {
    state.status = 'completed';
    chrome.action.setBadgeText({ text: '✓' });
    chrome.action.setBadgeBackgroundColor({ color: '#2ecc71' });

    addLog(`All done! Processed ${state.completedCount} videos (${state.errorCount} errors).`, 'success');

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
    sendResponse({
      status: state.status,
      queue: state.queue,
      currentIndex: state.currentIndex,
      completedCount: state.completedCount,
      errorCount: state.errorCount,
      currentDoc: state.currentDoc,
      logs: state.logs,
      activeTabId: state.activeTabId,
      dupProgress: state.dupProgress,
    });
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

  if (request.action === 'SCAN_DUPLICATES') {
    state.dupProgress = {
      active: false,
      action: null,
      total: 0,
      current: 0,
      currentTitle: '',
      successCount: 0,
      errorCount: 0,
      completed: false,
      message: '',
    };
    chrome.storage.sync.get(DEFAULT_SETTINGS, async (settings) => {
      try {
        const result = await scanDuplicates(settings.readwiseToken, request.locationFilter || 'archive', request.maxPages || 8);
        sendResponse({ success: true, data: result });
      } catch (err) {
        sendResponse({ success: false, error: err.message });
      }
    });
    return true;
  }

  if (request.action === 'DELETE_DUPLICATES') {
    chrome.storage.sync.get(DEFAULT_SETTINGS, async (settings) => {
      try {
        const items = request.items || request.docIds || [];
        const result = await deleteDuplicateDocs(settings.readwiseToken, items);
        sendResponse({ success: true, data: result });
      } catch (err) {
        sendResponse({ success: false, error: err.message });
      }
    });
    return true;
  }

  if (request.action === 'TAG_DUPLICATES') {
    chrome.storage.sync.get(DEFAULT_SETTINGS, async (settings) => {
      try {
        const tagName = request.tagName || settings.duplicateTagName || 'duplicate';
        const items = request.items || request.docIds || [];
        const result = await tagDuplicateDocs(settings.readwiseToken, items, tagName);
        sendResponse({ success: true, data: result });
      } catch (err) {
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
    if (state.activeTabIds && state.activeTabIds.size > 0) {
      for (const tid of state.activeTabIds) {
        chrome.tabs.remove(tid).catch(() => {});
      }
      state.activeTabIds.clear();
    }
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
