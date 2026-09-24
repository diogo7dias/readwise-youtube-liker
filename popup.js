/**
 * UI controller for the extension popup
 */

// DOM Elements - Setup & Navigation
const tokenSection = document.getElementById('tokenSection');
const mainWorkspace = document.getElementById('mainWorkspace');
const inputToken = document.getElementById('inputToken');
const btnSaveToken = document.getElementById('btnSaveToken');
const tokenError = document.getElementById('tokenError');
const lblTagName = document.getElementById('lblTagName');
const btnOptions = document.getElementById('btnOptions');

const tabLiker = document.getElementById('tabLiker');
const tabDuplicates = document.getElementById('tabDuplicates');
const viewLiker = document.getElementById('viewLiker');
const viewDuplicates = document.getElementById('viewDuplicates');

// DOM Elements - Tab 1: Auto-Liker
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

// DOM Elements - Tab 2: Duplicates
const btnScanDuplicates = document.getElementById('btnScanDuplicates');
const dupScope = document.getElementById('dupScope');
const dupStats = document.getElementById('dupStats');
const statDupGroups = document.getElementById('statDupGroups');
const statDupDocs = document.getElementById('statDupDocs');
const statDupScanned = document.getElementById('statDupScanned');

const dupActionsSection = document.getElementById('dupActionsSection');
const btnTagDuplicates = document.getElementById('btnTagDuplicates');
const btnDeleteDuplicates = document.getElementById('btnDeleteDuplicates');

const dupConfirmSection = document.getElementById('dupConfirmSection');
const dupConfirmDesc = document.getElementById('dupConfirmDesc');
const btnConfirmDelete = document.getElementById('btnConfirmDelete');
const btnCancelConfirm = document.getElementById('btnCancelConfirm');

const dupProgressSection = document.getElementById('dupProgressSection');
const dupProgressTitle = document.getElementById('dupProgressTitle');
const dupProgressCounter = document.getElementById('dupProgressCounter');
const dupProgressBar = document.getElementById('dupProgressBar');
const dupCurrentTitle = document.getElementById('dupCurrentTitle');

const dupStatusBanner = document.getElementById('dupStatusBanner');

const dupListSection = document.getElementById('dupListSection');
const dupCountLabel = document.getElementById('dupCountLabel');
const dupList = document.getElementById('dupList');

// Local cached state
let pendingList = [];
let duplicateGroups = [];
let totalDuplicateDocs = 0;
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

// Tab navigation switcher
function switchTab(tab) {
  if (tab === 'liker') {
    tabLiker.classList.add('active');
    tabDuplicates.classList.remove('active');
    viewLiker.classList.remove('hidden');
    viewDuplicates.classList.add('hidden');
  } else if (tab === 'duplicates') {
    tabDuplicates.classList.add('active');
    tabLiker.classList.remove('active');
    viewDuplicates.classList.remove('hidden');
    viewLiker.classList.add('hidden');
  }
}

tabLiker.addEventListener('click', () => switchTab('liker'));
tabDuplicates.addEventListener('click', () => switchTab('duplicates'));

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

// Scan archive for YouTube videos to like
btnScan.addEventListener('click', () => {
  btnScan.disabled = true;
  btnScan.replaceChildren();
  const spinner = document.createElement('span');
  spinner.className = 'spinner-small';
  btnScan.appendChild(spinner);
  btnScan.appendChild(document.createTextNode(' Scanning...'));

  chrome.runtime.sendMessage({ action: 'SCAN_ARCHIVE' }, (res) => {
    btnScan.disabled = false;
    btnScan.replaceChildren();
    const icon = document.createElement('span');
    icon.className = 'btn-icon';
    icon.textContent = '🔍';
    btnScan.appendChild(icon);
    btnScan.appendChild(document.createTextNode(' Scan Archive'));

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

// TAB 2: Scan for duplicates
btnScanDuplicates.addEventListener('click', () => {
  btnScanDuplicates.disabled = true;
  btnScanDuplicates.replaceChildren();
  const spinner = document.createElement('span');
  spinner.className = 'spinner-small';
  btnScanDuplicates.appendChild(spinner);
  btnScanDuplicates.appendChild(document.createTextNode(' Scanning...'));

  dupStatusBanner.classList.add('hidden');
  dupConfirmSection.classList.add('hidden');

  const scope = dupScope.value || 'archive';
  chrome.runtime.sendMessage({ action: 'SCAN_DUPLICATES', locationFilter: scope }, (res) => {
    btnScanDuplicates.disabled = false;
    btnScanDuplicates.replaceChildren();
    const icon = document.createElement('span');
    icon.className = 'btn-icon';
    icon.textContent = '🔍';
    btnScanDuplicates.appendChild(icon);
    btnScanDuplicates.appendChild(document.createTextNode(' Scan Duplicates'));

    if (res && res.success) {
      const data = res.data;
      duplicateGroups = data.duplicateGroups || [];
      totalDuplicateDocs = data.totalDuplicateDocs || 0;

      statDupGroups.textContent = duplicateGroups.length;
      statDupDocs.textContent = totalDuplicateDocs;
      statDupScanned.textContent = data.totalScanned || 0;
      dupStats.classList.remove('hidden');

      renderDuplicates();
    } else {
      dupStatusBanner.className = 'status-banner error';
      dupStatusBanner.textContent = `Error scanning duplicates: ${res?.error || 'Unknown error'}`;
      dupStatusBanner.classList.remove('hidden');
    }
  });
});

// Render duplicate groups in DOM
function renderDuplicates() {
  if (duplicateGroups.length === 0) {
    dupActionsSection.classList.add('hidden');
    dupConfirmSection.classList.add('hidden');
    dupListSection.classList.remove('hidden');
    dupCountLabel.textContent = '0 found';
    dupList.replaceChildren();
    const emptyMsg = document.createElement('div');
    emptyMsg.className = 'log-empty';
    emptyMsg.textContent = 'No duplicate YouTube videos found!';
    dupList.appendChild(emptyMsg);
    return;
  }

  dupActionsSection.classList.remove('hidden');
  dupConfirmSection.classList.add('hidden');
  dupListSection.classList.remove('hidden');
  dupCountLabel.textContent = `${duplicateGroups.length} video(s), ${totalDuplicateDocs} redundant copies`;

  btnDeleteDuplicates.textContent = `🗑️ Delete Newer Copies (${totalDuplicateDocs})`;
  btnTagDuplicates.textContent = `🏷️ Tag All as #duplicate (${totalDuplicateDocs})`;

  dupList.replaceChildren();

  for (const group of duplicateGroups) {
    const groupCard = document.createElement('div');
    groupCard.className = 'dup-group';

    const groupTitle = document.createElement('div');
    groupTitle.className = 'dup-group-title';
    groupTitle.title = group.title;
    groupTitle.textContent = group.title;
    groupCard.appendChild(groupTitle);

    const itemsContainer = document.createElement('div');
    itemsContainer.className = 'dup-items-container';

    // 1. Keep Item (oldest or copy with notes)
    const keepItem = document.createElement('div');
    keepItem.className = 'dup-item';

    const keepInfo = document.createElement('div');
    keepInfo.className = 'dup-item-info';

    const keepBadge = document.createElement('span');
    keepBadge.className = 'badge badge-keep';
    keepBadge.textContent = 'KEEP';
    keepInfo.appendChild(keepBadge);

    const keepDate = document.createElement('span');
    keepDate.className = 'dup-date';
    const kd = group.keepDoc.saved_at ? new Date(group.keepDoc.saved_at).toLocaleDateString() : 'Original';
    keepDate.textContent = `Saved: ${kd}`;
    keepInfo.appendChild(keepDate);

    if (group.keepDoc.notes && group.keepDoc.notes.trim()) {
      const notesFlag = document.createElement('span');
      notesFlag.className = 'dup-notes-flag';
      notesFlag.title = group.keepDoc.notes;
      notesFlag.textContent = '📝 Notes';
      keepInfo.appendChild(notesFlag);
    }
    keepItem.appendChild(keepInfo);
    itemsContainer.appendChild(keepItem);

    // 2. Duplicate Items (redundant copies to remove or tag)
    for (const dup of group.duplicateDocs) {
      const dupItem = document.createElement('div');
      dupItem.className = 'dup-item';

      const dupInfo = document.createElement('div');
      dupInfo.className = 'dup-item-info';

      const dupBadge = document.createElement('span');
      dupBadge.className = 'badge badge-dup';
      dupBadge.textContent = 'DELETE';
      dupInfo.appendChild(dupBadge);

      const dupDate = document.createElement('span');
      dupDate.className = 'dup-date';
      const dd = dup.saved_at ? new Date(dup.saved_at).toLocaleDateString() : 'Copy';
      dupDate.textContent = `Saved: ${dd}`;
      dupInfo.appendChild(dupDate);

      if (dup.notes && dup.notes.trim()) {
        const notesFlag = document.createElement('span');
        notesFlag.className = 'dup-notes-flag';
        notesFlag.title = dup.notes;
        notesFlag.textContent = '📝 Notes';
        dupInfo.appendChild(notesFlag);
      }
      dupItem.appendChild(dupInfo);
      itemsContainer.appendChild(dupItem);
    }

    groupCard.appendChild(itemsContainer);
    dupList.appendChild(groupCard);
  }
}

// Collect redundant copy items across all duplicate groups
function getDuplicateItems() {
  const items = [];
  for (const group of duplicateGroups) {
    for (const dup of group.duplicateDocs) {
      items.push({
        id: dup.id,
        title: dup.title || group.title,
      });
    }
  }
  return items;
}

// Tag all duplicates in Readwise
btnTagDuplicates.addEventListener('click', () => {
  const items = getDuplicateItems();
  if (items.length === 0) return;

  btnTagDuplicates.disabled = true;
  btnTagDuplicates.textContent = 'Tagging...';
  dupStatusBanner.classList.add('hidden');

  chrome.runtime.sendMessage({ action: 'TAG_DUPLICATES', items }, (res) => {
    btnTagDuplicates.disabled = false;
    btnTagDuplicates.textContent = `🏷️ Tag All as #duplicate (${items.length})`;

    if (res && res.success) {
      dupStatusBanner.className = 'status-banner success';
      dupStatusBanner.textContent = `✓ Successfully tagged ${res.data.taggedCount} duplicate document(s) in Readwise!`;
      dupStatusBanner.classList.remove('hidden');
    } else {
      dupStatusBanner.className = 'status-banner error';
      dupStatusBanner.textContent = `✗ Error tagging duplicates: ${res?.error || 'Unknown error'}`;
      dupStatusBanner.classList.remove('hidden');
    }
  });
});

// Click "Delete Newer Copies" -> Open in-card confirmation
btnDeleteDuplicates.addEventListener('click', () => {
  const items = getDuplicateItems();
  if (items.length === 0) return;

  dupConfirmDesc.textContent = `Permanently delete ${items.length} duplicate copy(ies) from Readwise? Oldest copies and notes will be kept.`;
  dupConfirmSection.classList.remove('hidden');
  dupActionsSection.classList.add('hidden');
  dupStatusBanner.classList.add('hidden');
});

// Cancel confirmation
btnCancelConfirm.addEventListener('click', () => {
  dupConfirmSection.classList.add('hidden');
  dupActionsSection.classList.remove('hidden');
});

// Confirm deletion -> Execute with live progress
btnConfirmDelete.addEventListener('click', () => {
  const items = getDuplicateItems();
  if (items.length === 0) return;

  dupConfirmSection.classList.add('hidden');
  dupProgressSection.classList.remove('hidden');
  dupProgressTitle.textContent = `Deleting ${items.length} duplicates...`;
  dupProgressCounter.textContent = `0 / ${items.length}`;
  dupProgressBar.style.width = '0%';
  dupCurrentTitle.textContent = 'Connecting to Readwise...';
  dupStatusBanner.classList.add('hidden');

  chrome.runtime.sendMessage({ action: 'DELETE_DUPLICATES', items }, (res) => {
    dupProgressSection.classList.add('hidden');

    if (res && res.success) {
      const data = res.data;
      const count = data.deletedCount || 0;
      const errCount = (data.errors || []).length;

      if (errCount > 0) {
        dupStatusBanner.className = 'status-banner error';
        dupStatusBanner.textContent = `Finished with errors: Deleted ${count} of ${data.total} copies. (${errCount} errors: ${data.errors[0]})`;
      } else {
        dupStatusBanner.className = 'status-banner success';
        dupStatusBanner.textContent = `✓ Successfully deleted all ${count} duplicate copy(ies) from Readwise!`;
      }
      dupStatusBanner.classList.remove('hidden');

      // Refresh duplicate list
      duplicateGroups = [];
      totalDuplicateDocs = 0;
      statDupGroups.textContent = '0';
      statDupDocs.textContent = '0';
      renderDuplicates();
    } else {
      dupStatusBanner.className = 'status-banner error';
      dupStatusBanner.textContent = `✗ Error deleting duplicates: ${res?.error || 'Unknown error'}`;
      dupStatusBanner.classList.remove('hidden');
      dupActionsSection.classList.remove('hidden');
    }
  });
});

// Query background for status and update UI
function refreshState() {
  chrome.runtime.sendMessage({ action: 'GET_STATE' }, (state) => {
    if (!state) return;

    // 1. Universal Activity Log update
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

    // 2. Tab 2: Duplicates progress tracking
    if (state.dupProgress && state.dupProgress.active) {
      const dp = state.dupProgress;
      dupProgressSection.classList.remove('hidden');
      dupActionsSection.classList.add('hidden');
      dupConfirmSection.classList.add('hidden');
      dupStatusBanner.classList.add('hidden');

      dupProgressTitle.textContent = dp.message || 'Processing duplicates...';
      dupProgressCounter.textContent = `${dp.current} / ${dp.total}`;
      const pct = dp.total > 0 ? Math.round((dp.current / dp.total) * 100) : 0;
      dupProgressBar.style.width = `${pct}%`;
      dupCurrentTitle.textContent = dp.currentTitle || 'Working...';
    } else if (state.dupProgress && state.dupProgress.completed) {
      dupProgressSection.classList.add('hidden');
      dupConfirmSection.classList.add('hidden');

      const dp = state.dupProgress;
      if (dp.errorCount > 0) {
        dupStatusBanner.className = 'status-banner error';
        dupStatusBanner.textContent = `Completed with errors: ${dp.successCount} of ${dp.total} deleted, ${dp.errorCount} failed.`;
      } else {
        dupStatusBanner.className = 'status-banner success';
        dupStatusBanner.textContent = `✓ All done! Successfully deleted all ${dp.successCount} duplicate copy(ies) from Readwise!`;
      }
      dupStatusBanner.classList.remove('hidden');

      // Clear duplicate list when all deleted
      if (duplicateGroups.length > 0 && dp.successCount > 0) {
        duplicateGroups = [];
        totalDuplicateDocs = 0;
        statDupGroups.textContent = '0';
        statDupDocs.textContent = '0';
        renderDuplicates();
      }
    } else {
      dupProgressSection.classList.add('hidden');
    }

    // 3. Tab 1: Auto-Liker queue transitions
    if (state.status === 'running') {
      progressSection.classList.remove('hidden');
      actionSection.classList.remove('hidden');

      btnStart.classList.add('hidden');
      btnPause.classList.remove('hidden');
      btnResume.classList.add('hidden');
      btnCancel.classList.remove('hidden');

      const total = state.queue ? state.queue.length : 0;
      const current = (state.currentIndex || 0) + 1;
      const pct = total > 0 ? Math.round(((state.currentIndex || 0) / total) * 100) : 0;

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

// Open external links reliably in a new browser tab
document.addEventListener('click', (e) => {
  const link = e.target.closest('a[href^="http"]');
  if (link) {
    e.preventDefault();
    chrome.tabs.create({ url: link.href });
  }
});

window.addEventListener('DOMContentLoaded', init);
window.addEventListener('beforeunload', () => {
  if (updateInterval) clearInterval(updateInterval);
});

