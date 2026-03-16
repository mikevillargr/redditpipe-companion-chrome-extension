/**
 * RedditPipe API Client
 * Shared API helpers for communicating with the RedditPipe server.
 */

const DEFAULT_SERVER_URL = 'http://76.13.191.149:3200';

async function getServerUrl() {
  return new Promise((resolve) => {
    chrome.storage.sync.get({ serverUrl: DEFAULT_SERVER_URL }, (items) => {
      resolve(items.serverUrl.replace(/\/+$/, ''));
    });
  });
}

async function apiFetch(path, options = {}) {
  const serverUrl = await getServerUrl();
  const url = `${serverUrl}${path}`;
  const res = await fetch(url, {
    headers: { 'Content-Type': 'application/json', ...options.headers },
    ...options,
  });
  if (!res.ok) {
    const body = await res.json().catch(() => ({}));
    throw new Error(body.error || `HTTP ${res.status}`);
  }
  return res.json();
}

/** Health / connection check */
async function checkConnection() {
  try {
    const data = await apiFetch('/api/extension/status');
    return { connected: !!data.connected, version: data.version || null };
  } catch {
    return { connected: false, version: null };
  }
}

/** Fetch all accounts (optionally filter by username) */
async function fetchAccounts(username) {
  const qs = username ? `?username=${encodeURIComponent(username)}` : '';
  return apiFetch(`/api/accounts${qs}`);
}

/** Fetch opportunities with query params */
async function fetchOpportunities(params = {}) {
  const qs = new URLSearchParams();
  if (params.accountId) qs.set('accountId', params.accountId);
  if (params.status) qs.set('status', params.status);
  if (params.threadId) qs.set('threadId', params.threadId);
  const query = qs.toString();
  return apiFetch(`/api/opportunities${query ? '?' + query : ''}`);
}

/** Verify opportunity (auto-verify via Reddit) */
async function verifyOpportunity(opportunityId) {
  return apiFetch(`/api/opportunities/${opportunityId}/verify`, { method: 'POST' });
}

/** Manual verify with permalink */
async function manualVerifyOpportunity(opportunityId, permalinkUrl) {
  return apiFetch(`/api/opportunities/${opportunityId}/manual-verify`, {
    method: 'POST',
    body: JSON.stringify({ permalinkUrl }),
  });
}

/** Log an organic post for an account */
async function logOrganicPost(accountId) {
  return apiFetch(`/api/accounts/${accountId}/log-organic`, { method: 'POST' });
}

/** Fetch pile-on comments for an opportunity */
async function fetchPileOns(opportunityId) {
  return apiFetch(`/api/opportunities/${opportunityId}/pile-on`);
}

/** Manually create a pile-on opportunity */
async function createPileOn(opportunityId) {
  return apiFetch(`/api/opportunities/${opportunityId}/pile-on`, { method: 'POST' });
}

/** Publish a pile-on comment to Reddit */
async function publishPileOn(opportunityId, pileOnId) {
  return apiFetch(`/api/opportunities/${opportunityId}/pile-on/${pileOnId}/publish`, { method: 'POST' });
}

/** Update a pile-on comment draft */
async function updatePileOnDraft(opportunityId, pileOnId, aiDraftReply) {
  return apiFetch(`/api/opportunities/${opportunityId}/pile-on/${pileOnId}`, {
    method: 'PUT',
    body: JSON.stringify({ aiDraftReply }),
  });
}

/** Generate AI reply on-demand for any Reddit thread/comment */
async function generateOnDemand(params) {
  return apiFetch('/api/generate/on-demand', {
    method: 'POST',
    body: JSON.stringify(params),
  });
}

// Export for use in service worker (importScripts) and ES module contexts
if (typeof globalThis !== 'undefined') {
  globalThis.RedditPipeAPI = {
    getServerUrl,
    apiFetch,
    checkConnection,
    fetchAccounts,
    fetchOpportunities,
    verifyOpportunity,
    manualVerifyOpportunity,
    logOrganicPost,
    fetchPileOns,
    createPileOn,
    publishPileOn,
    updatePileOnDraft,
    generateOnDemand,
  };
}
