/**
 * RedditPipe Popup — Main UI Logic
 * Fetches state from background, renders account dropdown, opportunity cards, handles actions.
 */

(function () {
  'use strict';

  const $ = (id) => document.getElementById(id);

  // ── State ────────────────────────────────────────────────────────────────────

  let state = {
    currentRedditUser: null,
    accountId: null,
    accountData: null,
    opportunities: [],
    allAccounts: [],
    connected: false,
  };
  let previewAccountId = null; // Non-null when previewing another account's queue
  let previewOpportunities = null;
  let switchTarget = null; // Account object for pending switch

  // ── Init ─────────────────────────────────────────────────────────────────────

  async function init() {
    await loadState();
    render();
    bindGlobalEvents();
    // Auto-refresh after 2s to pick up results from the background poll triggered above
    setTimeout(async () => {
      await loadState();
      render();
    }, 2000);
  }

  async function loadState() {
    return new Promise((resolve) => {
      chrome.runtime.sendMessage({ type: 'GET_CURRENT_STATE' }, (response) => {
        if (response && !response.error) {
          state = response;
        }
        resolve();
      });
    });
  }

  // ── Render ───────────────────────────────────────────────────────────────────

  function render() {
    renderConnection();
    renderAccount();
    renderSafetyBar();
    renderOpportunities();
  }

  function renderConnection() {
    const dot = $('connDot');
    if (state.connected) {
      dot.className = 'conn-dot connected';
      dot.title = 'Connected to Narwhal';
    } else {
      dot.className = 'conn-dot disconnected';
      dot.title = 'Cannot reach Narwhal server';
    }
  }

  function renderAccount() {
    const noLogin = $('notLoggedIn');
    const notFound = $('notFound');
    const acctSection = $('accountSection');

    if (!state.currentRedditUser) {
      noLogin.style.display = 'block';
      notFound.style.display = 'none';
      acctSection.style.display = 'none';
      $('safetyBar').style.display = 'none';
      renderLoginAccountList();
      return;
    }

    noLogin.style.display = 'none';

    if (!state.accountId) {
      notFound.style.display = 'block';
      acctSection.style.display = 'none';
      $('safetyBar').style.display = 'none';
      $('notFoundMsg').textContent = `Account u/${state.currentRedditUser} not found in Narwhal`;
      return;
    }

    notFound.style.display = 'none';
    acctSection.style.display = 'block';

    const acct = state.accountData;
    $('usernameDisplay').textContent = acct?.username || state.currentRedditUser;
    const statusChip = $('statusChip');
    statusChip.textContent = acct?.status || 'unknown';
    statusChip.className = 'status-chip ' + (acct?.status || '');

    // Mini stats in status row
    const postsToday = acct?.postsTodayCount || 0;
    const maxPosts = acct?.maxPostsPerDay || 3;
    const organic = acct?.organicPostsTotal || 0;
    const citation = acct?.citationPostsTotal || 0;
    const total = organic + citation;
    const citPct = total > 0 ? Math.round((citation / total) * 100) : 0;
    $('accountMiniStats').textContent = `${postsToday}/${maxPosts} posts · ${citPct}% cit`;

    renderDropdownMenu();
  }

  function renderDropdownMenu() {
    const menu = $('dropdownMenu');
    menu.innerHTML = '';

    const accounts = state.allAccounts || [];
    const currentUsername = state.accountData?.username;

    for (const acct of accounts) {
      if (acct.username === currentUsername) continue;

      const isDisabled = acct.status === 'retired' || acct.status === 'flagged';
      const oppCount = acct._count?.opportunities || 0;

      const item = document.createElement('div');
      item.className = 'dropdown-item' + (isDisabled ? ' disabled' : '');
      item.innerHTML = `
        <span>u/${escHtml(acct.username)} <span class="status-chip ${acct.status}" style="font-size:9px;">${acct.status}</span></span>
        <span class="opp-count">${oppCount} queued</span>
      `;
      if (!isDisabled) {
        item.addEventListener('click', () => onAccountSelect(acct));
      }
      menu.appendChild(item);
    }

    // Separator + preview option
    if (accounts.length > 1) {
      const sep = document.createElement('div');
      sep.className = 'dropdown-separator';
      menu.appendChild(sep);

      const previewItem = document.createElement('div');
      previewItem.className = 'dropdown-item preview-option';
      previewItem.textContent = previewAccountId ? '← Back to current account' : 'Preview only (don\'t switch)';
      previewItem.addEventListener('click', () => {
        if (previewAccountId) {
          previewAccountId = null;
          previewOpportunities = null;
          $('mismatchBanner').classList.remove('show');
          render();
        } else {
          showToast('Select an account above while in preview mode');
        }
        closeDropdown();
      });
      menu.appendChild(previewItem);
    }
  }

  function renderLoginAccountList() {
    const list = $('loginAccountList');
    if (!list) return;
    list.innerHTML = '';

    const accounts = (state.allAccounts || []).filter(a =>
      a.password && a.status !== 'retired' && a.status !== 'flagged'
    );

    if (accounts.length === 0) {
      list.innerHTML = '<p style="font-size:11px;color:var(--text-muted);">No accounts with stored passwords</p>';
      return;
    }

    for (const acct of accounts) {
      const row = document.createElement('div');
      row.className = 'login-account-row';
      row.innerHTML = `
        <span class="login-account-name">u/${escHtml(acct.username)}</span>
        <span class="status-chip ${acct.status}" style="font-size:9px;">${acct.status}</span>
        <div class="login-account-actions">
          <button class="btn-copy-user" title="Copy username">👤</button>
          <button class="btn-copy-pass" title="Copy password">🔑</button>
        </div>
      `;
      row.querySelector('.btn-copy-user').addEventListener('click', async (e) => {
        e.stopPropagation();
        try {
          await navigator.clipboard.writeText(acct.username);
          showToast(`Username copied: ${acct.username}`);
        } catch { showToast('Copy failed'); }
      });
      row.querySelector('.btn-copy-pass').addEventListener('click', async (e) => {
        e.stopPropagation();
        try {
          await navigator.clipboard.writeText(acct.password);
          showToast('Password copied');
        } catch { showToast('Copy failed'); }
      });
      list.appendChild(row);
    }
  }

  function renderSafetyBar() {
    const bar = $('safetyBar');
    if (!state.accountId || !state.accountData) {
      bar.style.display = 'none';
      $('limitWarning').classList.remove('show');
      $('ratioWarning').classList.remove('show');
      return;
    }

    bar.style.display = 'flex';
    const acct = state.accountData;
    const postsToday = acct.postsTodayCount || 0;
    const maxPosts = acct.maxPostsPerDay || 3;
    const organic = acct.organicPostsTotal || 0;
    const citation = acct.citationPostsTotal || 0;
    const total = organic + citation;
    const citPct = total > 0 ? (citation / total) * 100 : 0;

    // Posts today
    $('postsTodayLabel').textContent = `${postsToday}/${maxPosts}`;
    const postsPct = Math.min(100, (postsToday / maxPosts) * 100);
    const postsFill = $('postsTodayFill');
    postsFill.style.width = postsPct + '%';
    postsFill.className = 'progress-fill ' + (postsPct >= 100 ? 'red' : postsPct >= 66 ? 'yellow' : 'green');

    // Citation ratio
    $('citationRatioLabel').textContent = `${organic}:${citation}`;
    const ratioFill = $('citationRatioFill');
    ratioFill.style.width = Math.min(100, citPct) + '%';
    ratioFill.className = 'progress-fill ' + (citPct > 40 ? 'red' : citPct > 25 ? 'yellow' : 'green');

    // Warnings
    $('limitWarning').classList.toggle('show', postsToday >= maxPosts);
    $('ratioWarning').classList.toggle('show', citPct > 40 && total >= 3);
  }

  function renderOpportunities() {
    const opps = previewOpportunities || state.opportunities || [];
    const list = $('oppList');
    const empty = $('emptyState');
    const cards = $('oppCards');

    if (!state.accountId && !previewAccountId) {
      list.style.display = 'none';
      empty.style.display = 'none';
      return;
    }

    const newOpps = opps.filter((o) => o.status === 'new');
    const publishedOpps = opps.filter((o) => o.status === 'published');

    if (newOpps.length === 0 && publishedOpps.length === 0) {
      list.style.display = 'none';
      empty.style.display = 'block';
      return;
    }

    list.style.display = 'block';
    empty.style.display = 'none';
    $('oppCount').textContent = newOpps.length;

    // Sort new opps by relevance
    const sortedNew = [...newOpps].sort((a, b) => (b.relevanceScore || 0) - (a.relevanceScore || 0));
    const sortedPublished = [...publishedOpps].sort((a, b) => {
      const da = new Date(a.updatedAt || a.createdAt).getTime();
      const db = new Date(b.updatedAt || b.createdAt).getTime();
      return db - da;
    });

    // Render new opportunity cards
    let html = sortedNew.map((opp) => renderOppCard(opp)).join('');

    // Render published section (collapsed by default)
    if (sortedPublished.length > 0) {
      html += `
        <div class="published-section">
          <div class="published-toggle" id="publishedToggle">
            <span>✓ Recently Published (${sortedPublished.length})</span>
            <span class="pile-on-arrow" id="publishedArrow">▶</span>
          </div>
          <div class="published-list" id="publishedList">
            ${sortedPublished.map((opp) => renderPublishedCard(opp)).join('')}
          </div>
        </div>
      `;
    }

    cards.innerHTML = html;

    // Bind published toggle
    cards.querySelector('#publishedToggle')?.addEventListener('click', () => {
      const pubList = cards.querySelector('#publishedList');
      const pubArrow = cards.querySelector('#publishedArrow');
      pubList?.classList.toggle('open');
      pubArrow?.classList.toggle('open');
    });

    // Bind card events for all cards (new + published)
    const allSorted = [...sortedNew, ...sortedPublished];
    cards.querySelectorAll('.opp-card').forEach((card) => {
      const oppId = card.dataset.oppId;
      const opp = allSorted.find((o) => o.id === oppId);
      if (!opp) return;

      // Go to thread
      card.querySelector('.btn-go')?.addEventListener('click', (e) => {
        e.stopPropagation();
        onGoToThread(opp);
      });

      // Copy draft
      card.querySelector('.btn-copy')?.addEventListener('click', (e) => {
        e.stopPropagation();
        onCopyDraft(opp);
      });

      // Toggle draft preview
      card.querySelector('.opp-draft-preview')?.addEventListener('click', (e) => {
        e.target.classList.toggle('expanded');
      });

      // Pile-on toggle
      card.querySelector('.pile-on-toggle')?.addEventListener('click', (e) => {
        e.stopPropagation();
        const pList = card.querySelector('.pile-on-list');
        const arrow = card.querySelector('.pile-on-arrow');
        pList?.classList.toggle('open');
        arrow?.classList.toggle('open');
        if (pList?.classList.contains('open') && !pList.dataset.loaded) {
          loadPileOns(opp.id, pList);
        }
      });

      // Create pile-on button
      card.querySelector('.btn-create-pile-on')?.addEventListener('click', (e) => {
        e.stopPropagation();
        onCreatePileOn(opp);
      });

      // Mark Published button
      card.querySelector('.btn-verify')?.addEventListener('click', (e) => {
        e.stopPropagation();
        onMarkPublished(opp);
      });
    });
  }

  function renderOppCard(opp) {
    const score = opp.relevanceScore || 0;
    const scoreClass = score >= 0.85 ? 'high' : score >= 0.7 ? 'medium' : 'low';
    const age = opp.threadAge || timeAgo(opp.threadCreatedAt || opp.createdAt);
    const draft = opp.aiDraftReply || '';
    const isPileOn = opp.opportunityType === 'pile_on';

    // Pile-on eligibility countdown
    let eligibleHtml = '';
    if (isPileOn && opp.pileOnEligibleAt) {
      const eligible = new Date(opp.pileOnEligibleAt);
      const now = Date.now();
      if (eligible.getTime() > now) {
        const mins = Math.ceil((eligible.getTime() - now) / 60000);
        const h = Math.floor(mins / 60);
        const m = mins % 60;
        eligibleHtml = `<div class="pile-on-eligible">⏱ Eligible in ${h}h ${m}m</div>`;
      } else {
        eligibleHtml = `<div class="pile-on-eligible ready">✓ Eligible now</div>`;
      }
    }

    const typeBadge = isPileOn ? '<span class="opp-type-badge pile-on">Pile-on</span>' : '';

    return `
      <div class="opp-card" data-opp-id="${escAttr(opp.id)}">
        <div class="opp-card-header">
          <span class="chip chip-subreddit">r/${escHtml(opp.subreddit)}</span>
          ${opp.client?.name ? `<span class="chip chip-client">${escHtml(opp.client.name)}</span>` : ''}
          ${typeBadge}
          <span class="score-dot ${scoreClass}" title="Relevance: ${(score * 100).toFixed(0)}%"></span>
        </div>
        <div class="opp-title">${escHtml(opp.title)}</div>
        <div class="opp-stats">
          <span>↑${opp.score ?? '—'}</span>
          <span>💬${opp.commentCount ?? '—'}</span>
          <span>${escHtml(age)}</span>
        </div>
        ${eligibleHtml}
        ${draft ? `<div class="opp-draft-preview">${escHtml(draft)}</div>` : ''}
        <div class="opp-actions">
          <button class="btn-sm btn-primary btn-go">Go to thread</button>
          <button class="btn-sm btn-secondary btn-copy">Copy draft</button>
          <button class="btn-sm btn-verify">✓ Mark Published</button>
        </div>
      </div>
    `;
  }

  function renderPublishedCard(opp) {
    const age = timeAgo(opp.updatedAt || opp.createdAt);
    const isPrimary = !opp.opportunityType || opp.opportunityType === 'primary';

    // Pile-on section for published primaries
    let pileOnSection = '';
    if (isPrimary) {
      pileOnSection = `
        <div class="pile-on-section">
          <div class="pile-on-toggle">
            <span>Pile-on comments</span>
            <span class="pile-on-arrow">▶</span>
          </div>
          <div class="pile-on-list" data-opp-id="${escAttr(opp.id)}">
            <div style="padding:6px;color:var(--text-muted);font-size:11px;">Loading…</div>
          </div>
          <div style="margin-top:6px;">
            <button class="btn-sm btn-pile-on btn-create-pile-on">+ Add pile-on</button>
          </div>
        </div>
      `;
    }

    return `
      <div class="opp-card published" data-opp-id="${escAttr(opp.id)}">
        <div class="opp-card-header">
          <span class="chip chip-subreddit">r/${escHtml(opp.subreddit)}</span>
          ${opp.client?.name ? `<span class="chip chip-client">${escHtml(opp.client.name)}</span>` : ''}
          <span class="opp-type-badge published">✓ Published</span>
        </div>
        <div class="opp-title">${escHtml(opp.title)}</div>
        <div class="opp-stats">
          <span>${escHtml(age)}</span>
          ${opp.permalinkUrl ? '<span>🔗 Verified</span>' : ''}
        </div>
        ${pileOnSection}
      </div>
    `;
  }

  // ── Actions ──────────────────────────────────────────────────────────────────

  async function onGoToThread(opp) {
    // Tell background to navigate to thread (uses current window)
    chrome.runtime.sendMessage({
      type: 'NAVIGATE_TO_THREAD',
      opportunity: opp,
    });
    showToast('Opening thread...');
  }

  async function onCopyDraft(opp) {
    if (!opp.aiDraftReply) {
      showToast('No draft available');
      return;
    }
    try {
      await navigator.clipboard.writeText(opp.aiDraftReply);
      showToast('Draft copied ✓');
    } catch {
      showToast('Copy failed');
    }
  }

  function onAccountSelect(acct) {
    closeDropdown();

    // If in preview mode, just load their opportunities
    if (previewAccountId !== null || !acct.password) {
      previewAccountId = acct.id;
      chrome.runtime.sendMessage({ type: 'SWITCH_ACCOUNT', accountId: acct.id, previewOnly: true }, (resp) => {
        if (resp?.opportunities) {
          previewOpportunities = resp.opportunities;
        }
        render();
        // Show mismatch banner
        $('mismatchText').textContent = `Previewing u/${acct.username}'s queue. `;
        $('mismatchBanner').classList.add('show');
        switchTarget = acct;
      });
      return;
    }

    // Switch & Go: logout and navigate to login page
    switchTarget = acct;
    doLogoutAndSwitch(acct);
  }

  async function doLogoutAndSwitch(acct) {
    showToast(`Logging out — switch to u/${acct.username}`);

    chrome.runtime.sendMessage({ type: 'LOGOUT_REDDIT' }, (result) => {
      if (chrome.runtime.lastError) {
        showToast('Logout failed — ' + chrome.runtime.lastError.message);
        return;
      }
      showToast('Logged out — use copy buttons to login');
      previewAccountId = null;
      previewOpportunities = null;
      $('mismatchBanner').classList.remove('show');
      setTimeout(() => window.close(), 500);
    });
  }

  // ── 2FA Modal ────────────────────────────────────────────────────────────────

  function show2FAModal(acct) {
    $('tfaUsername').textContent = `u/${acct.username}`;
    $('tfaInput').value = '';
    $('tfaModal').classList.add('open');
    $('tfaInput').focus();

    $('tfaSubmit').onclick = () => {
      const code = $('tfaInput').value.trim();
      if (!code) return;
      $('tfaModal').classList.remove('open');
      doAccountSwitch(acct, code);
    };

    $('tfaCancel').onclick = () => {
      $('tfaModal').classList.remove('open');
    };
  }

  // ── Mark Published ─────────────────────────────────────────────────────────

  function onMarkPublished(opp) {
    showToast('Checking thread for your comment…');

    // Step 1: Try auto-verify via backend (checks Reddit for the comment)
    chrome.runtime.sendMessage({
      type: 'VERIFY_OPPORTUNITY',
      opportunityId: opp.id,
    }, (result) => {
      if (result?.status === 'published') {
        // Auto-verify succeeded
        showToast('Published ✓ — comment found automatically');
        loadState().then(() => render());
        return;
      }

      // Step 2: Auto-verify failed — fall back to permalink prompt
      showPermalinkModal(opp);
    });
  }

  function showPermalinkModal(opp) {
    $('permalinkOppInfo').textContent = `r/${opp.subreddit} — ${opp.title}`;
    $('permalinkInput').value = '';
    $('permalinkModal').classList.add('open');
    $('permalinkInput').focus();
    showToast('Comment not found automatically — paste permalink');

    $('permalinkSubmit').onclick = async () => {
      const permalink = $('permalinkInput').value.trim();
      if (!permalink) {
        showToast('Please paste the comment permalink');
        return;
      }
      if (!permalink.includes('reddit.com/') || !permalink.includes('/comment')) {
        showToast('Invalid permalink — must be a Reddit comment URL');
        return;
      }
      $('permalinkModal').classList.remove('open');
      showToast('Verifying comment…');

      chrome.runtime.sendMessage({
        type: 'MANUAL_VERIFY_OPPORTUNITY',
        opportunityId: opp.id,
        permalinkUrl: permalink,
      }, (result) => {
        if (result?.error) {
          showToast('Verification failed: ' + (result.details || result.error));
          return;
        }
        showToast('Published ✓ — opportunity verified');
        loadState().then(() => render());
      });
    };

    $('permalinkCancel').onclick = () => {
      $('permalinkModal').classList.remove('open');
    };
  }

  // ── Pile-On Actions ────────────────────────────────────────────────────────

  async function loadPileOns(opportunityId, listEl) {
    try {
      const pileOns = await new Promise((resolve, reject) => {
        chrome.runtime.sendMessage({ type: 'FETCH_PILE_ONS', opportunityId }, (resp) => {
          if (resp?.error) reject(new Error(resp.error));
          else resolve(resp?.pileOns || resp || []);
        });
      });

      listEl.dataset.loaded = 'true';

      if (!Array.isArray(pileOns) || pileOns.length === 0) {
        listEl.innerHTML = '<div style="padding:6px;color:var(--text-muted);font-size:11px;">No pile-on comments yet</div>';
        return;
      }

      listEl.innerHTML = pileOns.map((po) => {
        const statusClass = po.status === 'posted' ? 'posted' : po.status === 'draft' ? 'draft' : 'ready';
        const canPublish = po.status === 'draft';
        return `
          <div class="pile-on-item" data-pile-on-id="${escAttr(po.id)}" data-opp-id="${escAttr(opportunityId)}">
            <div class="pile-on-item-header">
              <span class="pile-on-account">u/${escHtml(po.pileOnAccount?.username || '?')}</span>
              <span class="pile-on-status ${statusClass}">${po.status}</span>
            </div>
            <div class="pile-on-draft">${escHtml(po.aiDraftReply || 'No draft')}</div>
            ${canPublish ? `
              <div class="pile-on-actions">
                <button class="btn-sm btn-publish-pile-on" data-pile-on-id="${escAttr(po.id)}" data-opp-id="${escAttr(opportunityId)}">Publish to Reddit</button>
                <button class="btn-sm btn-secondary btn-copy-pile-on" data-draft="${escAttr(po.aiDraftReply || '')}">Copy</button>
              </div>
            ` : ''}
          </div>
        `;
      }).join('');

      // Bind pile-on item events
      listEl.querySelectorAll('.btn-publish-pile-on').forEach((btn) => {
        btn.addEventListener('click', (e) => {
          e.stopPropagation();
          onPublishPileOn(btn.dataset.oppId, btn.dataset.pileOnId);
        });
      });
      listEl.querySelectorAll('.btn-copy-pile-on').forEach((btn) => {
        btn.addEventListener('click', async (e) => {
          e.stopPropagation();
          try {
            await navigator.clipboard.writeText(btn.dataset.draft);
            showToast('Pile-on draft copied ✓');
          } catch { showToast('Copy failed'); }
        });
      });
      listEl.querySelectorAll('.pile-on-draft').forEach((el) => {
        el.addEventListener('click', () => el.classList.toggle('expanded'));
      });
    } catch (err) {
      listEl.innerHTML = `<div style="padding:6px;color:var(--accent-red);font-size:11px;">Failed to load: ${escHtml(err.message)}</div>`;
    }
  }

  async function onCreatePileOn(opp) {
    showToast('Creating pile-on…');
    chrome.runtime.sendMessage({ type: 'CREATE_PILE_ON', opportunityId: opp.id }, (result) => {
      if (result?.error) {
        showToast('Failed: ' + result.error);
        return;
      }
      showToast('Pile-on created ✓');
      // Refresh the pile-on list if open
      const card = document.querySelector(`.opp-card[data-opp-id="${opp.id}"]`);
      const list = card?.querySelector('.pile-on-list');
      if (list) {
        list.dataset.loaded = '';
        if (list.classList.contains('open')) {
          loadPileOns(opp.id, list);
        }
      }
    });
  }

  async function onPublishPileOn(opportunityId, pileOnId) {
    showToast('Publishing pile-on to Reddit…');
    chrome.runtime.sendMessage({ type: 'PUBLISH_PILE_ON', opportunityId, pileOnId }, (result) => {
      if (result?.error) {
        showToast('Failed: ' + result.error);
        return;
      }
      showToast('Pile-on published ✓');
      // Refresh list
      const card = document.querySelector(`.opp-card[data-opp-id="${opportunityId}"]`);
      const list = card?.querySelector('.pile-on-list');
      if (list) {
        list.dataset.loaded = '';
        loadPileOns(opportunityId, list);
      }
    });
  }

  // ── Organic Logging ──────────────────────────────────────────────────────────

  async function onLogOrganic() {
    if (!state.accountId) {
      showToast('No account detected');
      return;
    }

    chrome.runtime.sendMessage({ type: 'LOG_ORGANIC' }, (result) => {
      if (result?.error) {
        showToast('Failed: ' + result.error);
        return;
      }
      const o = result?.organicPostsTotal || 0;
      const c = result?.citationPostsTotal || 0;
      showToast(`Organic post logged ✓ (Ratio: ${o}:${c})`);

      // Refresh state to update safety bar
      if (result) {
        if (state.accountData) {
          state.accountData.organicPostsTotal = result.organicPostsTotal;
          state.accountData.citationPostsTotal = result.citationPostsTotal;
        }
        renderSafetyBar();
      }
    });
  }

  // ── Event Binding ────────────────────────────────────────────────────────────

  function bindGlobalEvents() {
    // Dropdown toggle
    $('accountCurrent').addEventListener('click', () => {
      const menu = $('dropdownMenu');
      const arrow = $('dropdownArrow');
      const isOpen = menu.classList.contains('open');
      menu.classList.toggle('open', !isOpen);
      arrow.classList.toggle('open', !isOpen);
    });

    // Close dropdown on outside click
    document.addEventListener('click', (e) => {
      if (!$('dropdownWrap').contains(e.target)) {
        closeDropdown();
      }
    });

    // Open Reddit button
    $('openRedditBtn').addEventListener('click', () => {
      chrome.tabs.create({ url: 'https://www.reddit.com' });
      window.close();
    });

    // Open RedditPipe app
    $('openAppBtn').addEventListener('click', openApp);
    $('openAppLink').addEventListener('click', (e) => {
      e.preventDefault();
      openApp();
    });

    // Log organic
    $('logOrganicBtn').addEventListener('click', onLogOrganic);

    // Logout button
    $('logoutBtn').addEventListener('click', (e) => {
      e.stopPropagation(); // Don't trigger dropdown toggle
      showToast('Logging out…');
      chrome.runtime.sendMessage({ type: 'LOGOUT_REDDIT' }, (result) => {
        if (chrome.runtime.lastError) {
          showToast('Logout failed: ' + chrome.runtime.lastError.message);
          return;
        }
        showToast('Logged out — redirecting to login');
        setTimeout(() => window.close(), 500);
      });
    });

    // Mismatch switch button
    $('mismatchSwitchBtn').addEventListener('click', () => {
      if (switchTarget) {
        doAccountSwitch(switchTarget);
      }
    });
  }

  async function openApp() {
    const { serverUrl = 'http://76.13.191.149:3200' } = await chrome.storage.sync.get({ serverUrl: 'http://76.13.191.149:3200' });
    // Open the server URL — the frontend is served from the same origin in production
    chrome.tabs.create({ url: serverUrl });
    window.close();
  }

  function closeDropdown() {
    $('dropdownMenu').classList.remove('open');
    $('dropdownArrow').classList.remove('open');
  }

  // ── Helpers ──────────────────────────────────────────────────────────────────

  function showToast(msg) {
    const toast = $('toast');
    toast.textContent = msg;
    toast.classList.add('show');
    setTimeout(() => toast.classList.remove('show'), 2500);
  }

  function escHtml(str) {
    const div = document.createElement('div');
    div.textContent = str || '';
    return div.innerHTML;
  }

  function escAttr(str) {
    return (str || '').replace(/"/g, '&quot;').replace(/'/g, '&#39;');
  }

  function timeAgo(dateStr) {
    if (!dateStr) return '';
    const diff = Date.now() - new Date(dateStr).getTime();
    const mins = Math.floor(diff / 60000);
    if (mins < 60) return `${mins}m ago`;
    const hours = Math.floor(mins / 60);
    if (hours < 24) return `${hours}h ago`;
    const days = Math.floor(hours / 24);
    return `${days}d ago`;
  }

  // ── Boot ─────────────────────────────────────────────────────────────────────

  init();
})();
