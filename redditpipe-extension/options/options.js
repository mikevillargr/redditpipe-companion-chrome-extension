/**
 * RedditPipe Options Page
 * Save/load settings to chrome.storage.sync
 */

const DEFAULTS = {
  serverUrl: 'http://localhost:8000',
  pollInterval: 5,
  notifications: true,
  autoPaste: true,
};

const $ = (id) => document.getElementById(id);

// Load saved settings
chrome.storage.sync.get(DEFAULTS, (items) => {
  $('serverUrl').value = items.serverUrl;
  $('pollInterval').value = String(items.pollInterval);
  $('notifications').checked = items.notifications;
  $('autoPaste').checked = items.autoPaste;
});

// Save
$('saveBtn').addEventListener('click', () => {
  const serverUrl = $('serverUrl').value.trim().replace(/\/+$/, '') || DEFAULTS.serverUrl;
  const settings = {
    serverUrl,
    pollInterval: parseInt($('pollInterval').value, 10),
    notifications: $('notifications').checked,
    autoPaste: $('autoPaste').checked,
  };

  chrome.storage.sync.set(settings, () => {
    // Request host permission for non-localhost URLs
    if (!serverUrl.includes('localhost') && !serverUrl.includes('127.0.0.1')) {
      try {
        const urlObj = new URL(serverUrl);
        const origin = `${urlObj.protocol}//${urlObj.host}/*`;
        chrome.permissions.request({ origins: [origin] }, (granted) => {
          if (!granted) {
            showStatus('Settings saved, but host permission was denied. API calls may fail.', true);
            return;
          }
          showStatus('Settings saved ✓');
        });
      } catch {
        showStatus('Settings saved ✓');
      }
    } else {
      showStatus('Settings saved ✓');
    }

    // Notify background to update alarm interval
    chrome.runtime.sendMessage({ type: 'SETTINGS_UPDATED', settings });
  });
});

// Test connection
$('testBtn').addEventListener('click', async () => {
  const serverUrl = $('serverUrl').value.trim().replace(/\/+$/, '') || DEFAULTS.serverUrl;
  $('connStatus').textContent = 'Testing...';
  $('connStatus').className = 'status-msg';
  try {
    const res = await fetch(`${serverUrl}/api/extension/status`);
    if (!res.ok) throw new Error(`HTTP ${res.status}`);
    const data = await res.json();
    if (data.connected) {
      showStatus(`Connected ✓${data.version ? ' (v' + data.version + ')' : ''}`);
    } else {
      showStatus('Server responded but reports disconnected', true);
    }
  } catch (err) {
    showStatus(`Cannot reach server: ${err.message}`, true);
  }
});

// Clear cache
$('clearCacheBtn').addEventListener('click', () => {
  chrome.storage.local.clear(() => {
    showStatus('Cached data cleared ✓');
  });
});

function showStatus(msg, isError = false) {
  const el = $('connStatus');
  el.textContent = msg;
  el.className = 'status-msg ' + (isError ? 'status-err' : 'status-ok');
  setTimeout(() => { el.textContent = ''; el.className = 'status-msg'; }, 5000);
}
