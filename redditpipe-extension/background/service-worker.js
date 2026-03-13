/**
 * RedditPipe Background Service Worker
 * Polling, message routing, badge updates, caching.
 */

importScripts('../lib/api.js');

const ALARM_NAME = 'redditpipe-poll';
const api = globalThis.RedditPipeAPI;

// ── State ──────────────────────────────────────────────────────────────────────

let state = {
  currentRedditUser: null,
  accountId: null,
  accountData: null,
  opportunities: [],
  allAccounts: [],
  connected: false,
};

// ── Initialisation ─────────────────────────────────────────────────────────────

chrome.runtime.onInstalled.addListener(() => {
  setupAlarm();
});

chrome.runtime.onStartup.addListener(() => {
  restoreState().then(() => poll());
});

// Also restore immediately when the script loads — MV3 workers can go idle
// and lose in-memory state, so we need to rehydrate every time the worker wakes.
restoreState();

// Restore persisted state from storage
async function restoreState() {
  return new Promise((resolve) => {
    chrome.storage.local.get(
      ['currentRedditUser', 'accountId', 'accountData', 'opportunities', 'allAccounts', 'connected'],
      (items) => {
        if (items.currentRedditUser) state.currentRedditUser = items.currentRedditUser;
        if (items.accountId) state.accountId = items.accountId;
        if (items.accountData) state.accountData = items.accountData;
        if (items.opportunities) state.opportunities = items.opportunities;
        if (items.allAccounts) state.allAccounts = items.allAccounts;
        if (items.connected !== undefined) state.connected = items.connected;
        resolve();
      }
    );
  });
}

function persist(partial) {
  Object.assign(state, partial);
  chrome.storage.local.set(partial);
}

// ── Alarm / Polling ────────────────────────────────────────────────────────────

async function setupAlarm() {
  const { pollInterval = 5 } = await chrome.storage.sync.get({ pollInterval: 5 });
  chrome.alarms.clear(ALARM_NAME);
  chrome.alarms.create(ALARM_NAME, { periodInMinutes: pollInterval });
  poll();
}

chrome.alarms.onAlarm.addListener((alarm) => {
  if (alarm.name === ALARM_NAME) poll();
});

async function poll() {
  try {
    const connResult = await api.checkConnection();
    persist({ connected: connResult.connected });

    if (!connResult.connected) {
      updateBadge();
      return;
    }

    // Fetch all accounts (for dropdown + switching)
    const allAccounts = await api.fetchAccounts();
    persist({ allAccounts });

    // If we have a current Reddit user, resolve their account
    if (state.currentRedditUser) {
      await resolveAccount(state.currentRedditUser);
    }

    updateBadge();
  } catch (err) {
    console.error('[RedditPipe] Poll error:', err);
    persist({ connected: false });
    updateBadge();
  }
}

async function resolveAccount(username) {
  try {
    const accounts = await api.fetchAccounts(username);
    if (accounts.length > 0) {
      const acct = accounts[0];
      persist({ accountId: acct.id, accountData: acct });
      await fetchOpportunitiesForAccount(acct.id);
    } else {
      persist({ accountId: null, accountData: null, opportunities: [] });
    }
  } catch (err) {
    console.error('[RedditPipe] resolveAccount error:', err);
  }
}

async function fetchOpportunitiesForAccount(accountId) {
  try {
    // Fetch both new (actionable) and recently published (for pile-on management)
    const [newOpps, publishedOpps] = await Promise.all([
      api.fetchOpportunities({ accountId, status: 'new' }),
      api.fetchOpportunities({ accountId, status: 'published' }),
    ]);
    // Combine: new first, then published primaries (for pile-on management)
    const recentPublished = publishedOpps.filter(
      (o) => o.opportunityType === 'primary' || !o.opportunityType
    ).slice(0, 10); // Limit to recent 10 published
    const opps = [...newOpps, ...recentPublished];
    persist({ opportunities: opps });
  } catch (err) {
    console.error('[RedditPipe] fetchOpportunities error:', err);
  }
}

function updateBadge() {
  const count = (state.opportunities || []).filter((o) => o.status === 'new').length;
  if (!state.connected) {
    chrome.action.setBadgeText({ text: '!' });
    chrome.action.setBadgeBackgroundColor({ color: '#6b7280' });
    return;
  }
  if (count > 0) {
    chrome.action.setBadgeText({ text: String(count) });
    chrome.action.setBadgeBackgroundColor({ color: '#f97316' });
  } else {
    chrome.action.setBadgeText({ text: '' });
  }
}

// ── Message Routing ────────────────────────────────────────────────────────────

chrome.runtime.onMessage.addListener((msg, sender, sendResponse) => {
  handleMessage(msg, sender).then(sendResponse).catch((err) => {
    console.error('[RedditPipe] Message handler error:', err);
    sendResponse({ error: err.message });
  });
  return true; // keep channel open for async response
});

async function handleMessage(msg, sender) {
  switch (msg.type) {
    case 'ACCOUNT_DETECTED': {
      const username = msg.username || null;
      persist({ currentRedditUser: username });
      if (username) {
        await resolveAccount(username);
      } else {
        persist({ accountId: null, accountData: null, opportunities: [] });
      }
      updateBadge();
      return { ok: true };
    }

    case 'COMMENT_POSTED': {
      return await handleCommentPosted(msg);
    }

    case 'GET_CURRENT_STATE': {
      // Ensure state is rehydrated from storage in case worker just woke up
      await restoreState();
      // Also trigger a fresh poll in the background so new accounts appear quickly
      poll().catch(() => {});
      return {
        currentRedditUser: state.currentRedditUser,
        accountId: state.accountId,
        accountData: state.accountData,
        opportunities: state.opportunities,
        allAccounts: state.allAccounts,
        connected: state.connected,
      };
    }

    case 'FETCH_OPPORTUNITIES': {
      if (msg.accountId) {
        await fetchOpportunitiesForAccount(msg.accountId);
      }
      return { opportunities: state.opportunities };
    }

    case 'SWITCH_ACCOUNT': {
      // Update the viewed account without changing Reddit login
      if (msg.previewOnly && msg.accountId) {
        const opps = await api.fetchOpportunities({ accountId: msg.accountId, status: 'new' });
        return { opportunities: opps };
      }
      return { ok: true };
    }

    case 'LOG_ORGANIC': {
      if (!state.accountId) return { error: 'No account' };
      const result = await api.logOrganicPost(state.accountId);
      // Refresh account data
      if (state.currentRedditUser) await resolveAccount(state.currentRedditUser);
      return result;
    }

    case 'VERIFY_OPPORTUNITY': {
      const result = await api.verifyOpportunity(msg.opportunityId);
      if (state.accountId) await fetchOpportunitiesForAccount(state.accountId);
      updateBadge();
      return result;
    }

    case 'MANUAL_VERIFY_OPPORTUNITY': {
      const result = await api.manualVerifyOpportunity(msg.opportunityId, msg.permalinkUrl);
      if (state.accountId) await fetchOpportunitiesForAccount(state.accountId);
      updateBadge();
      return result;
    }

    case 'FETCH_PILE_ONS': {
      const pileOns = await api.fetchPileOns(msg.opportunityId);
      return { pileOns };
    }

    case 'CREATE_PILE_ON': {
      const createResult = await api.createPileOn(msg.opportunityId);
      return createResult;
    }

    case 'PUBLISH_PILE_ON': {
      const pubResult = await api.publishPileOn(msg.opportunityId, msg.pileOnId);
      return pubResult;
    }

    case 'CLEAR_REDDIT_COOKIES': {
      await clearAllRedditCookies();
      return { ok: true };
    }

    case 'LOGOUT_REDDIT': {
      // Clear all cookies and navigate to login page
      await clearAllRedditCookies();
      console.log('[RedditPipe] Cookies cleared for logout');
      let [logoutTab] = await chrome.tabs.query({ active: true, currentWindow: true });
      const logoutTabId = logoutTab ? logoutTab.id : (await chrome.tabs.create({ active: true })).id;
      await chrome.tabs.update(logoutTabId, { url: 'https://www.reddit.com/login/' });
      return { success: true };
    }

    case 'SETTINGS_UPDATED': {
      setupAlarm();
      return { ok: true };
    }

    case 'NAVIGATE_TO_THREAD': {
      // Copy draft, then navigate active tab to thread URL
      const opp = msg.opportunity;
      if (opp && opp.aiDraftReply) {
        // Store draft info so navigator.js can use it after page load
        await chrome.storage.local.set({
          pendingNavigation: {
            opportunityId: opp.id,
            threadUrl: opp.threadUrl,
            draft: opp.aiDraftReply,
            clientName: opp.client?.name || '',
            subreddit: opp.subreddit,
          },
        });
      }
      // Navigate active tab
      if (sender.tab) {
        await chrome.tabs.update(sender.tab.id, { url: opp.threadUrl });
      } else {
        const [tab] = await chrome.tabs.query({ active: true, currentWindow: true });
        if (tab) await chrome.tabs.update(tab.id, { url: opp.threadUrl });
      }
      // Inject navigator script on the new page
      const [activeTab] = await chrome.tabs.query({ active: true, currentWindow: true });
      if (activeTab) {
        chrome.tabs.onUpdated.addListener(function listener(tabId, changeInfo) {
          if (tabId === activeTab.id && changeInfo.status === 'complete') {
            chrome.tabs.onUpdated.removeListener(listener);
            chrome.scripting.executeScript({
              target: { tabId },
              files: ['content/navigator.js'],
            }).catch((e) => console.error('[RedditPipe] inject navigator error:', e));
          }
        });
      }
      return { ok: true };
    }

    default:
      return { error: 'Unknown message type' };
  }
}

async function handleCommentPosted(msg) {
  const { threadId, permalinkUrl, username } = msg;
  if (!threadId || !username) return { error: 'Missing threadId or username' };

  try {
    // Find matching opportunity
    const opps = await api.fetchOpportunities({ threadId });
    const match = opps.find(
      (o) => o.account && o.account.username === username && o.status === 'new'
    );

    if (!match) return { matched: false };

    // Auto-verify with permalink
    let result;
    if (permalinkUrl) {
      result = await api.manualVerifyOpportunity(match.id, permalinkUrl);
    } else {
      result = await api.verifyOpportunity(match.id);
    }

    // Refresh opportunities
    if (state.accountId) await fetchOpportunitiesForAccount(state.accountId);
    updateBadge();

    // Show notification
    const { notifications = true } = await chrome.storage.sync.get({ notifications: true });
    if (notifications && result.status === 'published') {
      chrome.notifications.create({
        type: 'basic',
        iconUrl: 'icons/icon-128.png',
        title: 'Comment Verified',
        message: `✓ Verified for ${match.client?.name || 'client'} in r/${match.subreddit}`,
      });
    }

    return { matched: true, verified: result.status === 'published', ...result };
  } catch (err) {
    console.error('[RedditPipe] handleCommentPosted error:', err);

    const { notifications = true } = await chrome.storage.sync.get({ notifications: true });
    if (notifications) {
      chrome.notifications.create({
        type: 'basic',
        iconUrl: 'icons/icon-128.png',
        title: 'Verification Failed',
        message: 'Could not verify comment — open RedditPipe to verify manually',
      });
    }
    return { error: err.message };
  }
}

// ── Cookie Management ─────────────────────────────────────────────────────────

async function clearAllRedditCookies() {
  let totalCleared = 0;

  // Get ALL cookies in the browser, then filter for reddit
  try {
    const allCookies = await chrome.cookies.getAll({});
    const redditCookies = allCookies.filter(c =>
      c.domain.includes('reddit.com') || c.domain.includes('reddit.com')
    );

    console.log(`[RedditPipe] Found ${redditCookies.length} reddit cookies out of ${allCookies.length} total`);
    if (redditCookies.length > 0) {
      console.log('[RedditPipe] Cookie domains:', [...new Set(redditCookies.map(c => c.domain))].join(', '));
      console.log('[RedditPipe] Cookie names:', redditCookies.map(c => c.name).join(', '));
    }

    for (const cookie of redditCookies) {
      const domain = cookie.domain.startsWith('.') ? cookie.domain.substring(1) : cookie.domain;
      const url = `https://${domain}${cookie.path}`;
      try {
        await chrome.cookies.remove({ url, name: cookie.name });
        totalCleared++;
      } catch (e) {
        console.warn(`[RedditPipe] Failed to remove cookie ${cookie.name} at ${url}:`, e);
      }
    }
  } catch (e) {
    console.error('[RedditPipe] Error getting all cookies:', e);
  }

  console.log(`[RedditPipe] Cleared ${totalCleared} Reddit cookies`);

  // Verify: check if any reddit cookies remain
  try {
    const remaining = (await chrome.cookies.getAll({})).filter(c => c.domain.includes('reddit'));
    if (remaining.length > 0) {
      console.warn(`[RedditPipe] WARNING: ${remaining.length} reddit cookies still remain!`);
      console.warn('[RedditPipe] Remaining:', remaining.map(c => `${c.name}@${c.domain}`).join(', '));
      // Try again with explicit URLs
      for (const c of remaining) {
        const d = c.domain.startsWith('.') ? c.domain.substring(1) : c.domain;
        await chrome.cookies.remove({ url: `https://${d}${c.path}`, name: c.name }).catch(() => {});
        await chrome.cookies.remove({ url: `http://${d}${c.path}`, name: c.name }).catch(() => {});
      }
    } else {
      console.log('[RedditPipe] Verified: 0 reddit cookies remain');
    }
  } catch (e) { /* ignore verification errors */ }
}
