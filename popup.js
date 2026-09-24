/**
 * UI controller for the extension popup
 */

// DOM Elements
const tokenSection = document.getElementById('tokenSection');
const mainWorkspace = document.getElementById('mainWorkspace');
const inputToken = document.getElementById('inputToken');
const btnSaveToken = document.getElementById('btnSaveToken');
const tokenError = document.getElementById('tokenError');
const lblTagName = document.getElementById('lblTagName');
const btnOptions = document.getElementById('btnOptions');

const btnScan = document.getElementById('btnScan');
const scanStats = document.getElementById('scanStats');
const statPending = document.getElementById('statPending');
const statAlreadyLiked = document.getElementById('statAlreadyLiked');
const statTotal = document.getElementById('statTotal');

const actionSection = document.getElementById('actionSection');
const batchSelect = document.getElementById('batchSelect');
const btnStart = document.getElementById('btnStart');
const btnPause = document.getElementById('btnPause');
const btnResume = document.getElementById('btnResume');
const btnCancel = document.getElementById('btnCancel');

const progressSection = document.getElementById('progressSection');
const progressStatusText = document.getElementById('progressStatusText');
const progressCounter = document.getElementById('progressCounter');
const progressBar = document.getElementById('progressBar');
const currentDocTitle = document.getElementById('currentDocTitle');

const logList = document.getElementById('logList');
const btnClearLog = document.getElementById('btnClearLog');

// Local cached scanned items
let pendingList = [];
let updateInterval = null;

// Initialize popup
async function init() {
  const { readwiseToken, tagName } = await chrome.storage.sync.get({
    readwiseToken: '',
    tagName: 'liked',
  });

  lblTagName.textContent = tagName || 'liked';

  if (!readwiseToken) {
    showSetup(true);
  } else {
    showSetup(false);
    refreshState();
  }

  // Poll state from background worker
  updateInterval = setInterval(refreshState, 800);
}

// Show or hide setup card
function showSetup(show) {
  if (show) {
    tokenSection.classList.remove('hidden');
    mainWorkspace.classList.add('hidden');
  } else {
    tokenSection.classList.add('hidden');
    mainWorkspace.classList.remove('hidden');
  }
}

// Save & validate Readwise token
btnSaveToken.addEventListener('click', async () => {
  const token = inputToken.value.trim();
  if (!token) return;

  btnSaveToken.disabled = true;
  btnSaveToken.textContent = 'Verifying...';
  tokenError.classList.add('hidden');

  chrome.runtime.sendMessage({ action: 'VALIDATE_TOKEN', token }, async (res) => {
    btnSaveToken.disabled = false;
    btnSaveToken.textContent = 'Connect';

    if (res && res.valid) {
      await chrome.storage.sync.set({ readwiseToken: token });
      showSetup(false);
      refreshState();
    } else {
      tokenError.textContent = 'Invalid token. Please check and try again.';
      tokenError.classList.remove('hidden');
    }
  });
});

// Scan archive for YouTube videos
btnScan.addEventListener('click', () => {
  btnScan.disabled = true;
  btnScan.innerHTML = '<span class="spinner-small"></span> Scanning...';

  chrome.runtime.sendMessage({ action: 'SCAN_ARCHIVE' }, (res) => {
    btnScan.disabled = false;
    btnScan.innerHTML = '<span class="btn-icon">🔍</span> Scan Archive';

    if (res && res.success) {
      const data = res.data;
      pendingList = data.pending || [];

      statPending.textContent = pendingList.length;
      statAlreadyLiked.textContent = (data.alreadyLiked || []).length;
      statTotal.textContent = data.totalScanned || 0;

      scanStats.classList.remove('hidden');

      if (pendingList.length > 0) {
        actionSection.classList.remove('hidden');
        btnStart.textContent = `▶ Start Liking & Tagging (${pendingList.length} pending)`;
      } else {
        actionSection.classList.add('hidden');
      }
    } else {
      alert(`Error scanning archive: ${res?.error || 'Unknown error'}`);
    }
  });
});

// Start processing queue
btnStart.addEventListener('click', () => {
  if (!pendingList || pendingList.length === 0) return;

  const batchVal = parseInt(batchSelect.value, 10);
  const itemsToProcess = batchVal > 0 ? pendingList.slice(0, batchVal) : pendingList;

  chrome.runtime.sendMessage({ action: 'START_QUEUE', items: itemsToProcess }, (res) => {
    if (res && res.success) {
      refreshState();
    }
  });
});

// Pause queue
btnPause.addEventListener('click', () => {
  chrome.runtime.sendMessage({ action: 'PAUSE_QUEUE' }, () => refreshState());
});

// Resume queue
btnResume.addEventListener('click', () => {
  chrome.runtime.sendMessage({ action: 'RESUME_QUEUE' }, () => refreshState());
});

// Cancel / Stop queue
btnCancel.addEventListener('click', () => {
  chrome.runtime.sendMessage({ action: 'CANCEL_QUEUE' }, () => refreshState());
});

// Settings button
btnOptions.addEventListener('click', () => {
  chrome.runtime.openOptionsPage();
});

// Clear Log button
btnClearLog.addEventListener('click', () => {
  logList.replaceChildren();
  const empty = document.createElement('div');
  empty.className = 'log-empty';
  empty.textContent = 'Log cleared.';
  logList.appendChild(empty);
});

// Query background for status and update UI
function refreshState() {
  chrome.runtime.sendMessage({ action: 'GET_STATE' }, (state) => {
    if (!state) return;

    // Render Logs safely without innerHTML
    if (state.logs && state.logs.length > 0) {
      logList.replaceChildren();
      for (const entry of state.logs) {
        const row = document.createElement('div');
        row.className = `log-entry ${entry.type}`;

        const timeSpan = document.createElement('span');
        timeSpan.className = 'log-time';
        timeSpan.textContent = `[${entry.time}]`;

        const msgSpan = document.createElement('span');
        msgSpan.className = 'log-msg';
        msgSpan.textContent = entry.message;

        row.appendChild(timeSpan);
        row.appendChild(msgSpan);
        logList.appendChild(row);
      }
    }

    // UI state transitions
    if (state.status === 'running') {
      progressSection.classList.remove('hidden');
      actionSection.classList.remove('hidden');

      btnStart.classList.add('hidden');
      btnPause.classList.remove('hidden');
      btnResume.classList.add('hidden');
      btnCancel.classList.remove('hidden');

      const total = state.queue.length;
      const current = state.currentIndex + 1;
      const pct = total > 0 ? Math.round((state.currentIndex / total) * 100) : 0;

      progressStatusText.textContent = 'Processing videos...';
      progressCounter.textContent = `${Math.min(current, total)} / ${total}`;
      progressBar.style.width = `${pct}%`;
      currentDocTitle.textContent = state.currentDoc ? (state.currentDoc.title || 'Processing video...') : 'Working...';
    } else if (state.status === 'paused') {
      progressSection.classList.remove('hidden');
      actionSection.classList.remove('hidden');

      btnStart.classList.add('hidden');
      btnPause.classList.add('hidden');
      btnResume.classList.remove('hidden');
      btnCancel.classList.remove('hidden');

      progressStatusText.textContent = 'Paused';
    } else if (state.status === 'completed') {
      progressSection.classList.remove('hidden');
      actionSection.classList.remove('hidden');

      btnStart.classList.remove('hidden');
      btnPause.classList.add('hidden');
      btnResume.classList.add('hidden');
      btnCancel.classList.add('hidden');

      progressStatusText.textContent = 'Completed!';
      progressBar.style.width = '100%';
      currentDocTitle.textContent = `Finished ${state.completedCount} videos successfully.`;
    } else {
      // Idle or error
      if (state.queue && state.queue.length === 0) {
        progressSection.classList.add('hidden');
      }
      btnStart.classList.remove('hidden');
      btnPause.classList.add('hidden');
      btnResume.classList.add('hidden');
      btnCancel.classList.add('hidden');
    }
  });
}

function escapeHtml(str) {
  return String(str)
    .replace(/&/g, '&amp;')
    .replace(/</g, '&lt;')
    .replace(/>/g, '&gt;')
    .replace(/"/g, '&quot;');
}

window.addEventListener('DOMContentLoaded', init);
window.addEventListener('beforeunload', () => {
  if (updateInterval) clearInterval(updateInterval);
});
