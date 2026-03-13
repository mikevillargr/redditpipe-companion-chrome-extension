/**
 * RedditPipe Content Script — Navigator
 * Shows floating toolbar on thread pages, handles draft pasting into comment editor.
 * Injected by background service worker after "Go to thread" action.
 */

(function () {
  'use strict';

  // Guard against double-injection
  if (window.__redditpipe_navigator_loaded) return;
  window.__redditpipe_navigator_loaded = true;

  let toolbarEl = null;
  let autoHideTimer = null;

  // ── Init ───────────────────────────────────────────────────────────────────

  async function init() {
    const { pendingNavigation } = await chrome.storage.local.get('pendingNavigation');
    if (!pendingNavigation) return;

    // Clear the pending navigation so it doesn't fire again
    await chrome.storage.local.remove('pendingNavigation');

    const { draft, clientName, subreddit, opportunityId } = pendingNavigation;

    // Copy draft to clipboard
    try {
      await navigator.clipboard.writeText(draft);
    } catch {
      // Fallback: textarea copy
      const ta = document.createElement('textarea');
      ta.value = draft;
      ta.style.position = 'fixed';
      ta.style.left = '-9999px';
      document.body.appendChild(ta);
      ta.select();
      document.execCommand('copy');
      ta.remove();
    }

    showToolbar(draft, clientName, subreddit);
    scrollToCommentBox();

    // Check auto-paste setting
    const { autoPaste = true } = await chrome.storage.sync.get({ autoPaste: true });
    if (autoPaste) {
      // Wait a moment for the page to fully render
      setTimeout(() => attemptAutoPaste(draft), 1500);
    }
  }

  // ── Toolbar ────────────────────────────────────────────────────────────────

  function showToolbar(draft, clientName, subreddit) {
    if (document.getElementById('redditpipe-toolbar')) return;

    toolbarEl = document.createElement('div');
    toolbarEl.id = 'redditpipe-toolbar';
    toolbarEl.innerHTML = `
      <style>
        #redditpipe-toolbar {
          position: fixed; bottom: 20px; right: 20px; z-index: 999999;
          background: #1e293b; border: 1px solid #334155; border-radius: 12px;
          padding: 14px 18px; max-width: 360px; box-shadow: 0 8px 32px rgba(0,0,0,0.5);
          font-family: 'Inter', system-ui, -apple-system, sans-serif;
          color: #f1f5f9; font-size: 13px; line-height: 1.5;
          animation: rp-slide-in 0.3s ease-out;
        }
        @keyframes rp-slide-in {
          from { transform: translateY(20px); opacity: 0; }
          to { transform: translateY(0); opacity: 1; }
        }
        #redditpipe-toolbar .rp-toolbar-header {
          display: flex; justify-content: space-between; align-items: center; margin-bottom: 8px;
        }
        #redditpipe-toolbar .rp-toolbar-brand {
          font-weight: 700; font-size: 13px; color: #f97316;
        }
        #redditpipe-toolbar .rp-toolbar-close {
          background: none; border: none; color: #94a3b8; cursor: pointer;
          font-size: 16px; padding: 2px 6px; border-radius: 4px; line-height: 1;
        }
        #redditpipe-toolbar .rp-toolbar-close:hover { background: #334155; color: #f1f5f9; }
        #redditpipe-toolbar .rp-toolbar-msg { margin-bottom: 10px; color: #cbd5e1; }
        #redditpipe-toolbar .rp-toolbar-meta {
          font-size: 11px; color: #64748b; margin-bottom: 10px;
        }
        #redditpipe-toolbar .rp-toolbar-actions { display: flex; gap: 8px; }
        #redditpipe-toolbar button.rp-btn {
          padding: 6px 14px; border-radius: 6px; border: none; font-size: 12px;
          cursor: pointer; font-weight: 600; transition: opacity 0.15s;
        }
        #redditpipe-toolbar button.rp-btn:hover { opacity: 0.85; }
        #redditpipe-toolbar .rp-btn-primary { background: #f97316; color: #fff; }
        #redditpipe-toolbar .rp-btn-secondary { background: #334155; color: #f1f5f9; }
      </style>
      <div class="rp-toolbar-header">
        <span class="rp-toolbar-brand">RedditPipe</span>
        <button class="rp-toolbar-close" title="Dismiss">✕</button>
      </div>
      <div class="rp-toolbar-msg">Draft copied to clipboard — paste and post</div>
      <div class="rp-toolbar-meta">${clientName ? `Client: ${clientName}` : ''}${subreddit ? ` · r/${subreddit}` : ''}</div>
      <div class="rp-toolbar-actions">
        <button class="rp-btn rp-btn-primary" id="rp-paste-btn">Paste draft</button>
        <button class="rp-btn rp-btn-secondary rp-toolbar-close">Dismiss</button>
      </div>
    `;

    document.body.appendChild(toolbarEl);

    // Event listeners
    toolbarEl.querySelectorAll('.rp-toolbar-close').forEach((btn) => {
      btn.addEventListener('click', () => dismissToolbar());
    });

    document.getElementById('rp-paste-btn')?.addEventListener('click', () => {
      attemptAutoPaste(draft);
    });

    // Auto-hide after 60 seconds
    autoHideTimer = setTimeout(() => dismissToolbar(), 60000);
  }

  function dismissToolbar() {
    if (autoHideTimer) clearTimeout(autoHideTimer);
    toolbarEl?.remove();
    toolbarEl = null;
  }

  // ── Comment Box Interaction ────────────────────────────────────────────────

  function scrollToCommentBox() {
    // Try to find and scroll to the comment box
    const selectors = [
      'div[contenteditable="true"]',          // New Reddit Fancy Pants
      'textarea[name="body"]',                 // New Reddit Markdown mode
      'textarea.commentarea',                  // Old Reddit
      '#TextInputWidget textarea',             // New Reddit variation
      'shreddit-comment-action-row',           // New Reddit (2024+)
    ];

    for (const sel of selectors) {
      const el = document.querySelector(sel);
      if (el) {
        el.scrollIntoView({ behavior: 'smooth', block: 'center' });
        return;
      }
    }

    // Fallback: scroll to bottom
    window.scrollTo({ top: document.body.scrollHeight, behavior: 'smooth' });
  }

  function attemptAutoPaste(draft) {
    // Strategy 1: New Reddit Fancy Pants editor (contentEditable div)
    const richEditor = document.querySelector(
      'div[contenteditable="true"][data-lexical-editor], ' +
      'div[contenteditable="true"][role="textbox"], ' +
      'div[contenteditable="true"]'
    );
    if (richEditor) {
      richEditor.focus();
      richEditor.innerText = draft;
      richEditor.dispatchEvent(new Event('input', { bubbles: true }));
      richEditor.dispatchEvent(new Event('change', { bubbles: true }));
      showPasteSuccess();
      return;
    }

    // Strategy 2: New Reddit Markdown mode textarea
    const mdTextarea = document.querySelector('textarea[name="body"], textarea[placeholder*="comment"]');
    if (mdTextarea) {
      mdTextarea.focus();
      mdTextarea.value = draft;
      mdTextarea.dispatchEvent(new Event('input', { bubbles: true }));
      mdTextarea.dispatchEvent(new Event('change', { bubbles: true }));
      showPasteSuccess();
      return;
    }

    // Strategy 3: Old Reddit textarea
    const oldTextarea = document.querySelector('.commentarea textarea, #thing_thing textarea');
    if (oldTextarea) {
      oldTextarea.focus();
      oldTextarea.value = draft;
      oldTextarea.dispatchEvent(new Event('input', { bubbles: true }));
      showPasteSuccess();
      return;
    }

    // Could not find editor — draft is still in clipboard
    const msg = toolbarEl?.querySelector('.rp-toolbar-msg');
    if (msg) {
      msg.innerHTML = '<span style="color:#f59e0b;">Could not find comment box — use Ctrl+V to paste</span>';
    }
  }

  function showPasteSuccess() {
    const msg = toolbarEl?.querySelector('.rp-toolbar-msg');
    if (msg) {
      msg.innerHTML = '<span style="color:#10b981;">✓ Draft pasted — review and click Post</span>';
    }
    const pasteBtn = document.getElementById('rp-paste-btn');
    if (pasteBtn) pasteBtn.style.display = 'none';
  }

  // ── Run ────────────────────────────────────────────────────────────────────

  // Wait for page to be reasonably loaded
  if (document.readyState === 'complete') {
    init();
  } else {
    window.addEventListener('load', () => setTimeout(init, 500));
  }
})();
