/**
 * RedditPipe Content Script — Account Detection + Comment Detection
 * Runs on every Reddit page. Detects logged-in user and posted comments.
 */

(function () {
  'use strict';

  // Guard against double-injection
  if (window.__redditpipe_detector_loaded) return;
  window.__redditpipe_detector_loaded = true;

  let lastDetectedUser = undefined; // undefined = not yet checked
  let lastUrl = location.href;
  let commentObserver = null;

  // ── Account Detection ──────────────────────────────────────────────────────

  function detectUsername() {
    let found = null;

    // Strategy 1: New Reddit — user drawer button
    const userDrawer = document.querySelector('[data-testid="user-drawer-button"]');
    if (userDrawer) {
      const text = userDrawer.textContent.trim();
      if (text && text.startsWith('u/')) found = text.slice(2);
      else if (text && !text.includes(' ') && text.length > 1) found = text;
      if (found) { console.log('[RedditPipe] Detected via user-drawer-button:', found); return found; }
    }

    // Strategy 2: New Reddit — expanded user menu
    const userMenuName = document.querySelector('#USER_DROPDOWN_ID span, [id*="UserDropdown"] span');
    if (userMenuName) {
      const text = userMenuName.textContent.trim();
      if (text && text.startsWith('u/')) found = text.slice(2);
      if (found) { console.log('[RedditPipe] Detected via UserDropdown:', found); return found; }
    }

    // Strategy 3: Shreddit header (2024+ redesign) — only match header-specific elements
    const shredditUser = document.querySelector(
      'shreddit-header-action-item[action="profile"] faceplate-tracker span,' +
      'faceplate-tracker[source="profile"] span'
    );
    if (shredditUser) {
      const text = shredditUser.textContent.trim();
      if (text && text.startsWith('u/')) found = text.slice(2);
      else if (text && /^[A-Za-z0-9_-]+$/.test(text) && text.length > 1) found = text;
      if (found) { console.log('[RedditPipe] Detected via shreddit header:', found); return found; }
    }

    // Strategy 4: Search only header/nav elements for /user/ links (tight scope to avoid post content)
    const headerEls = document.querySelectorAll('header a[href^="/user/"], nav a[href^="/user/"], shreddit-header a[href^="/user/"], #header a[href^="/user/"]');
    for (const link of headerEls) {
      const match = link.getAttribute('href').match(/^\/user\/([^/?#]+)/);
      if (match && match[1] !== 'me') {
        found = match[1];
        console.log('[RedditPipe] Detected via header /user/ link:', found);
        return found;
      }
    }

    // Strategy 6: Old Reddit: #header .user a
    const oldRedditUser = document.querySelector('#header .user a');
    if (oldRedditUser) {
      const text = oldRedditUser.textContent.trim();
      if (text && text !== 'login' && text !== 'register') {
        console.log('[RedditPipe] Detected via old Reddit header:', text);
        return text;
      }
    }

    console.log('[RedditPipe] DOM detection found nothing, will try API fallback');
    return null;
  }

  async function detectViaApi() {
    try {
      const res = await fetch('https://www.reddit.com/api/me.json', { credentials: 'include' });
      if (!res.ok) {
        console.log('[RedditPipe] API /api/me.json returned', res.status);
        return null;
      }
      const data = await res.json();
      const name = data?.data?.name || null;
      console.log('[RedditPipe] API fallback result:', name);
      return name;
    } catch (err) {
      console.log('[RedditPipe] API fallback error:', err.message);
      return null;
    }
  }

  async function runDetection() {
    // API is the most reliable source — try it first
    let username = await detectViaApi();
    if (!username) {
      username = detectUsername();
    }

    console.log('[RedditPipe] Detection result:', username, '(previous:', lastDetectedUser, ')');

    if (username !== lastDetectedUser) {
      lastDetectedUser = username;
      chrome.runtime.sendMessage({ type: 'ACCOUNT_DETECTED', username: username || null }).catch(() => {});
      console.log('[RedditPipe] Sent ACCOUNT_DETECTED:', username);
    }
  }

  // ── Comment Detection (Feature 5) ─────────────────────────────────────────

  function extractThreadIdFromUrl(url) {
    // Matches /r/subreddit/comments/THREAD_ID/...
    const match = (url || location.href).match(/\/comments\/([a-z0-9]+)/i);
    return match ? match[1] : null;
  }

  function isOnThreadPage() {
    return !!extractThreadIdFromUrl();
  }

  function setupCommentObserver() {
    if (commentObserver) commentObserver.disconnect();
    if (!isOnThreadPage()) return;

    const targetNode = document.body;
    commentObserver = new MutationObserver((mutations) => {
      for (const mutation of mutations) {
        for (const node of mutation.addedNodes) {
          if (node.nodeType !== Node.ELEMENT_NODE) continue;
          checkForNewComment(node);
        }
      }
    });
    commentObserver.observe(targetNode, { childList: true, subtree: true });
  }

  function checkForNewComment(node) {
    if (!lastDetectedUser) {
      console.log('[RedditPipe] checkForNewComment: no user detected yet');
      return;
    }

    // New Reddit: comments by current user
    const commentElements = node.matches?.('[data-testid="comment"]')
      ? [node]
      : (node.querySelectorAll?.('[data-testid="comment"]') || []);

    console.log('[RedditPipe] checkForNewComment: found', commentElements.length, 'comment elements');

    for (const comment of commentElements) {
      const authorEl = comment.querySelector('a[href*="/user/"]');
      if (!authorEl) {
        console.log('[RedditPipe] Comment has no author link');
        continue;
      }
      const authorMatch = authorEl.getAttribute('href').match(/\/user\/([^/?#]+)/);
      const author = authorMatch ? authorMatch[1] : null;
      console.log('[RedditPipe] Comment author:', author, 'current user:', lastDetectedUser);
      
      if (!authorMatch || authorMatch[1] !== lastDetectedUser) continue;

      // Found a comment by current user — extract permalink
      const permalinkEl = comment.querySelector('a[href*="/comment/"], a[data-testid="comment-permalink"]');
      let permalinkUrl = null;
      if (permalinkEl) {
        permalinkUrl = permalinkEl.href.startsWith('http')
          ? permalinkEl.href
          : `https://www.reddit.com${permalinkEl.getAttribute('href')}`;
      }

      const threadId = extractThreadIdFromUrl();
      console.log('[RedditPipe] Found user comment! threadId:', threadId, 'permalink:', permalinkUrl);
      if (threadId) {
        notifyCommentPosted(threadId, permalinkUrl);
      }
    }

    // Old Reddit: comments by current user
    const oldRedditComments = node.matches?.('.comment')
      ? [node]
      : (node.querySelectorAll?.('.comment') || []);

    for (const comment of oldRedditComments) {
      const authorEl = comment.querySelector('.author');
      if (!authorEl || authorEl.textContent.trim() !== lastDetectedUser) continue;

      const permalinkEl = comment.querySelector('a.bylink[data-event-action="permalink"]');
      let permalinkUrl = permalinkEl ? permalinkEl.href : null;

      const threadId = extractThreadIdFromUrl();
      if (threadId) {
        notifyCommentPosted(threadId, permalinkUrl);
      }
    }
  }

  // Debounce: only notify once per thread
  const notifiedThreads = new Set();

  function notifyCommentPosted(threadId, permalinkUrl) {
    const key = `${threadId}:${lastDetectedUser}`;
    if (notifiedThreads.has(key)) {
      console.log('[RedditPipe] Already notified for', key);
      return;
    }
    notifiedThreads.add(key);

    console.log('[RedditPipe] Sending COMMENT_POSTED message:', { threadId, permalinkUrl, username: lastDetectedUser });
    chrome.runtime.sendMessage({
      type: 'COMMENT_POSTED',
      threadId,
      permalinkUrl,
      username: lastDetectedUser,
    }).then(response => {
      console.log('[RedditPipe] COMMENT_POSTED response:', response);
    }).catch(err => {
      console.error('[RedditPipe] COMMENT_POSTED error:', err);
    });

    // Update floating toolbar if present
    updateToolbarVerified();
  }

  function updateToolbarVerified() {
    const toolbar = document.getElementById('redditpipe-toolbar');
    if (!toolbar) return;
    const msg = toolbar.querySelector('.rp-toolbar-msg');
    if (msg) {
      msg.innerHTML = '<span style="color:#10b981;">✓ Comment posted and verified in RedditPipe</span>';
    }
    setTimeout(() => toolbar.remove(), 5000);
  }

  // ── SPA Navigation Handling ────────────────────────────────────────────────

  function onUrlChange() {
    if (location.href !== lastUrl) {
      const previousUrl = lastUrl;
      lastUrl = location.href;
      notifiedThreads.clear();
      runDetection();
      setupCommentObserver();
      // If we just navigated away from the login page, retry detection aggressively
      // since auth cookies may take a moment to be fully set
      if (previousUrl.includes('/login')) {
        setTimeout(() => runDetection(), 1000);
        setTimeout(() => runDetection(), 2500);
        setTimeout(() => runDetection(), 5000);
      }
    }
  }

  // MutationObserver on <title> or URL for SPA navigation
  const titleObserver = new MutationObserver(() => onUrlChange());
  const titleEl = document.querySelector('title');
  if (titleEl) {
    titleObserver.observe(titleEl, { childList: true });
  }

  // Also use Navigation API if available
  if (typeof navigation !== 'undefined') {
    navigation.addEventListener('navigatesuccess', () => onUrlChange());
  }

  // Fallback: periodic URL change check
  setInterval(onUrlChange, 2000);

  // Periodic re-detection: self-heal if initial detection missed (e.g. cookies not ready)
  // Runs every 5s until a user is found, then slows to 30s
  let redetectInterval = setInterval(async () => {
    await runDetection();
    if (lastDetectedUser) {
      clearInterval(redetectInterval);
      // Once found, still re-check every 30s in case user switches accounts
      setInterval(() => runDetection(), 30000);
    }
  }, 5000);

  // ── Init ───────────────────────────────────────────────────────────────────

  // Run detection with retries on startup — Reddit auth cookies may take a moment
  async function initDetection() {
    await runDetection();
    if (!lastDetectedUser) {
      // Retry after 1s and 3s if initial detection failed
      setTimeout(() => runDetection(), 1000);
      setTimeout(() => runDetection(), 3000);
    }
  }

  initDetection();
  setupCommentObserver();
})();
