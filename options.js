/**
 * Options page script
 */

const txtToken = document.getElementById('txtToken');
const txtTag = document.getElementById('txtTag');
const numDelay = document.getElementById('numDelay');
const chkMute = document.getElementById('chkMute');
const btnTest = document.getElementById('btnTest');
const btnSave = document.getElementById('btnSave');
const testStatus = document.getElementById('testStatus');
const saveStatus = document.getElementById('saveStatus');

// Load stored settings
chrome.storage.sync.get({
  readwiseToken: '',
  tagName: 'liked',
  delaySeconds: 2.5,
  muteAudio: true,
}, (items) => {
  txtToken.value = items.readwiseToken || '';
  txtTag.value = items.tagName || 'liked';
  numDelay.value = items.delaySeconds || 2.5;
  chkMute.checked = items.muteAudio !== false;
});

// Test connection
btnTest.addEventListener('click', () => {
  const token = txtToken.value.trim();
  if (!token) {
    testStatus.textContent = 'Please enter a token first.';
    testStatus.className = 'status-msg error';
    return;
  }

  btnTest.disabled = true;
  testStatus.textContent = 'Connecting...';
  testStatus.className = 'status-msg';

  chrome.runtime.sendMessage({ action: 'VALIDATE_TOKEN', token }, (res) => {
    btnTest.disabled = false;
    if (res && res.valid) {
      testStatus.textContent = '✓ Successfully connected to Readwise API!';
      testStatus.className = 'status-msg success';
    } else {
      testStatus.textContent = '✗ Connection failed. Please check your token.';
      testStatus.className = 'status-msg error';
    }
  });
});

// Save settings
btnSave.addEventListener('click', () => {
  const token = txtToken.value.trim();
  const tag = txtTag.value.trim() || 'liked';
  const delay = parseFloat(numDelay.value) || 2.5;
  const mute = chkMute.checked;

  chrome.storage.sync.set({
    readwiseToken: token,
    tagName: tag,
    delaySeconds: delay,
    muteAudio: mute,
  }, () => {
    saveStatus.textContent = '✓ Settings saved successfully!';
    saveStatus.className = 'status-msg success';
    setTimeout(() => {
      saveStatus.textContent = '';
    }, 3000);
  });
});
