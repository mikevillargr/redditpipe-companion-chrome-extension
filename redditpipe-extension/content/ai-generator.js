/**
 * AI Generator Content Script
 * Injects "Generate AI Reply" buttons into Reddit comment boxes
 */

(async function() {
  'use strict';

  // Wait for API to be loaded (it's loaded by lib/api.js in the same content script)
  let api = globalThis.RedditPipeAPI;
  if (!api) {
    console.log('[RedditPipe AI Generator] Waiting for API to load...');
    // Wait a bit for api.js to load
    await new Promise(resolve => setTimeout(resolve, 100));
    api = globalThis.RedditPipeAPI;
    if (!api) {
      console.error('[RedditPipe AI Generator] API not loaded after waiting');
      return;
    }
  }
  
  console.log('[RedditPipe AI Generator] API loaded successfully');

  let currentAccountId = null;
  let currentAccountUsername = null;

  // Listen for account updates from background
  chrome.runtime.onMessage.addListener((msg) => {
    if (msg.type === 'ACCOUNT_DETECTED') {
      currentAccountUsername = msg.username;
      // Fetch account ID from background state
      chrome.runtime.sendMessage({ type: 'GET_CURRENT_STATE' }, (response) => {
        if (response && response.accountId) {
          currentAccountId = response.accountId;
          console.log('[RedditPipe AI Generator] Account detected:', currentAccountUsername, currentAccountId);
        }
      });
    }
  });

  // Get initial account state
  chrome.runtime.sendMessage({ type: 'GET_CURRENT_STATE' }, (response) => {
    if (response && response.accountId && response.currentRedditUser) {
      currentAccountId = response.accountId;
      currentAccountUsername = response.currentRedditUser;
      console.log('[RedditPipe AI Generator] Initial account:', currentAccountUsername, currentAccountId);
    }
  });

  // Extract thread context from current page
  function extractThreadContext() {
    const url = window.location.href;
    
    let threadTitle = '';
    let threadBody = '';
    let threadId = '';
    let subreddit = '';

    // Extract subreddit from URL
    const subredditMatch = url.match(/\/r\/([^/]+)/);
    if (subredditMatch) {
      subreddit = subredditMatch[1];
    }

    // Extract thread ID from URL
    const threadIdMatch = url.match(/\/comments\/([a-z0-9]+)/);
    if (threadIdMatch) {
      threadId = threadIdMatch[1];
    }

    // Try multiple selectors for title (new Reddit has various layouts)
    const titleSelectors = [
      'h1[slot="title"]', // New Reddit shreddit-post
      '[data-test-id="post-content"] h1',
      '[data-adclicklocation="title"] h1',
      'shreddit-post h1',
      '.thing.link .title a.title', // Old Reddit
    ];

    for (const selector of titleSelectors) {
      const titleEl = document.querySelector(selector);
      if (titleEl && titleEl.textContent.trim()) {
        threadTitle = titleEl.textContent.trim();
        break;
      }
    }

    // Try multiple selectors for body
    const bodySelectors = [
      '[slot="text-body"]', // New Reddit shreddit-post
      '[data-test-id="post-content"] [data-click-id="text"]',
      'shreddit-post [slot="text-body"]',
      '.thing.link .usertext-body .md', // Old Reddit
    ];

    for (const selector of bodySelectors) {
      const bodyEl = document.querySelector(selector);
      if (bodyEl && bodyEl.textContent.trim()) {
        threadBody = bodyEl.textContent.trim();
        break;
      }
    }

    const context = {
      threadTitle,
      threadBody,
      threadId,
      threadUrl: url,
      subreddit,
    };

    console.log('[RedditPipe AI Generator] Extracted thread context:', context);

    // Validate required fields
    if (!threadTitle || !subreddit) {
      console.error('[RedditPipe AI Generator] Missing required context:', { threadTitle, subreddit });
      return null;
    }

    return context;
  }

  // Extract parent comment context if replying to a comment
  function extractParentCommentContext(commentBox) {
    try {
      // Find the parent comment element
      let parentComment = commentBox.closest('[data-testid="comment"]');
      if (!parentComment) {
        // Try old Reddit
        parentComment = commentBox.closest('.thing.comment');
      }

      if (!parentComment) return null;

      // Extract comment body
      let commentBody = '';
      let commentAuthor = '';

      // New Reddit
      const bodyEl = parentComment.querySelector('[data-testid="comment"] > div > div:nth-child(2)');
      const authorEl = parentComment.querySelector('a[href*="/user/"]');
      
      if (bodyEl) {
        commentBody = bodyEl.textContent.trim();
      }
      if (authorEl) {
        const authorMatch = authorEl.getAttribute('href').match(/\/user\/([^/?#]+)/);
        if (authorMatch) commentAuthor = authorMatch[1];
      }

      // Old Reddit fallback
      if (!commentBody) {
        const oldBodyEl = parentComment.querySelector('.usertext-body .md');
        if (oldBodyEl) commentBody = oldBodyEl.textContent.trim();
      }
      if (!commentAuthor) {
        const oldAuthorEl = parentComment.querySelector('.author');
        if (oldAuthorEl) commentAuthor = oldAuthorEl.textContent.trim();
      }

      return commentBody && commentAuthor ? { commentBody, commentAuthor } : null;
    } catch (err) {
      console.error('[RedditPipe AI Generator] Error extracting parent comment:', err);
      return null;
    }
  }

  // Create and inject AI generation button
  function injectAIButton(commentBox) {
    console.log('[RedditPipe AI Generator] Attempting to inject button into:', commentBox);
    
    // Check if button already exists
    if (commentBox.querySelector('.rp-ai-generate-btn')) {
      console.log('[RedditPipe AI Generator] Button already exists, skipping');
      return;
    }

    const button = document.createElement('button');
    button.className = 'rp-ai-generate-btn';
    button.textContent = '✨ Generate AI Reply';
    button.style.cssText = `
      background: linear-gradient(135deg, #f97316 0%, #ea580c 100%);
      color: white;
      border: none;
      padding: 6px 12px;
      border-radius: 6px;
      font-size: 12px;
      font-weight: 600;
      cursor: pointer;
      margin: 8px 8px 8px 0;
      display: inline-flex;
      align-items: center;
      gap: 4px;
      transition: all 0.2s;
      box-shadow: 0 2px 4px rgba(249, 115, 22, 0.3);
      position: relative;
      z-index: 1000;
    `;

    button.addEventListener('mouseenter', () => {
      button.style.transform = 'translateY(-1px)';
      button.style.boxShadow = '0 4px 8px rgba(249, 115, 22, 0.4)';
    });

    button.addEventListener('mouseleave', () => {
      button.style.transform = 'translateY(0)';
      button.style.boxShadow = '0 2px 4px rgba(249, 115, 22, 0.3)';
    });

    button.addEventListener('click', async (e) => {
      e.preventDefault();
      e.stopPropagation();
      await handleGenerateAI(commentBox, button);
    });

    // Find the appropriate place to insert the button
    // For shreddit-composer, we need to insert OUTSIDE it (it uses Shadow DOM)
    let container = commentBox;
    
    // Special handling for shreddit-composer
    if (commentBox.tagName === 'SHREDDIT-COMPOSER') {
      // Insert button right before the shreddit-composer element
      // This avoids Shadow DOM issues
      if (commentBox.parentElement) {
        commentBox.parentElement.insertBefore(button, commentBox);
        console.log('[RedditPipe AI Generator] Button inserted before shreddit-composer');
        return;
      }
    }
    
    // For contenteditable textbox, find the parent form/container
    if (commentBox.getAttribute('contenteditable') === 'true') {
      // Find parent form or container
      container = commentBox.closest('form') || commentBox.closest('[class*="comment"]') || commentBox.parentElement;
    }

    // New Reddit: insert after the markdown toolbar
    let insertTarget = container.querySelector('[role="toolbar"]');
    if (insertTarget) {
      insertTarget.parentElement.insertBefore(button, insertTarget.nextSibling);
      console.log('[RedditPipe AI Generator] Button inserted after toolbar');
      return;
    }

    // Try to insert before the textbox/textarea
    const textarea = container.querySelector('textarea');
    if (textarea) {
      textarea.parentElement.insertBefore(button, textarea);
      console.log('[RedditPipe AI Generator] Button inserted before textarea');
      return;
    }

    // For contenteditable, insert before it
    if (commentBox.getAttribute('contenteditable') === 'true') {
      commentBox.parentElement.insertBefore(button, commentBox);
      console.log('[RedditPipe AI Generator] Button inserted before contenteditable');
      return;
    }

    // Fallback: prepend to container
    container.insertBefore(button, container.firstChild);
    console.log('[RedditPipe AI Generator] Button inserted (fallback) into container:', container);
  }

  // Handle AI generation
  async function handleGenerateAI(commentBox, button) {
    if (!currentAccountId) {
      showNotification('Please log in to a Reddit account first', 'error');
      return;
    }

    const originalText = button.textContent;
    button.textContent = '⏳ Generating...';
    button.disabled = true;
    button.style.opacity = '0.6';
    button.style.cursor = 'not-allowed';

    try {
      // Extract context
      const threadContext = extractThreadContext();
      
      if (!threadContext) {
        throw new Error('Could not extract thread information. Make sure you are on a Reddit thread page.');
      }

      // Check if replying to a comment
      const parentContext = extractParentCommentContext(commentBox);

      // Build generation request
      const params = {
        accountId: currentAccountId,
        threadTitle: threadContext.threadTitle,
        threadBody: threadContext.threadBody || '',
        threadUrl: threadContext.threadUrl,
        subreddit: threadContext.subreddit,
      };

      if (parentContext) {
        params.parentCommentBody = parentContext.commentBody;
        params.parentCommentAuthor = parentContext.commentAuthor;
      }

      console.log('[RedditPipe AI Generator] Generating with params:', params);

      // Call API via background service worker to avoid CORS issues
      const result = await new Promise((resolve, reject) => {
        chrome.runtime.sendMessage(
          { type: 'GENERATE_ON_DEMAND', params },
          (response) => {
            console.log('[RedditPipe AI Generator] Response from background:', response);
            if (chrome.runtime.lastError) {
              reject(new Error(chrome.runtime.lastError.message));
            } else if (response && response.error) {
              reject(new Error(response.error));
            } else {
              resolve(response);
            }
          }
        );
      });
      
      console.log('[RedditPipe AI Generator] Result:', result);
      
      if (!result || !result.aiDraftReply) {
        console.error('[RedditPipe AI Generator] Invalid result:', result);
        throw new Error('No AI reply generated');
      }
      
      console.log('[RedditPipe AI Generator] AI Draft Reply:', result.aiDraftReply);

      // Insert generated text into comment box
      let inserted = false;

      // For shreddit-composer, find the actual input element
      let targetElement = null;
      
      if (commentBox.tagName === 'SHREDDIT-COMPOSER') {
        // Try to find textarea in shadow DOM or adjacent elements
        targetElement = document.querySelector('shreddit-composer textarea') ||
                       document.querySelector('shreddit-composer [contenteditable="true"]') ||
                       commentBox.shadowRoot?.querySelector('textarea') ||
                       commentBox.shadowRoot?.querySelector('[contenteditable="true"]');
      } else {
        // Try textarea first
        targetElement = commentBox.querySelector('textarea');
        
        // Try contenteditable
        if (!targetElement && commentBox.getAttribute('contenteditable') === 'true') {
          targetElement = commentBox;
        }
        
        // Try finding contenteditable in children
        if (!targetElement) {
          targetElement = commentBox.querySelector('[contenteditable="true"]');
        }
      }

      console.log('[RedditPipe AI Generator] Target element for insertion:', targetElement);

      if (targetElement) {
        if (targetElement.tagName === 'TEXTAREA') {
          targetElement.value = result.aiDraftReply;
          targetElement.dispatchEvent(new Event('input', { bubbles: true }));
          targetElement.dispatchEvent(new Event('change', { bubbles: true }));
        } else {
          targetElement.textContent = result.aiDraftReply;
          targetElement.dispatchEvent(new Event('input', { bubbles: true }));
          targetElement.dispatchEvent(new Event('change', { bubbles: true }));
        }
        targetElement.focus();
        inserted = true;
        showNotification('AI reply generated! ✨', 'success');
      } else {
        // Copy to clipboard as fallback
        await navigator.clipboard.writeText(result.aiDraftReply);
        showNotification('AI reply copied to clipboard! ✨', 'success');
        console.log('[RedditPipe AI Generator] Could not find input element, copied to clipboard');
      }

    } catch (err) {
      console.error('[RedditPipe AI Generator] Generation failed:', err);
      showNotification(`Generation failed: ${err.message}`, 'error');
    } finally {
      button.textContent = originalText;
      button.disabled = false;
      button.style.opacity = '1';
      button.style.cursor = 'pointer';
    }
  }

  // Show notification
  function showNotification(message, type = 'info') {
    const notification = document.createElement('div');
    notification.className = 'rp-ai-notification';
    notification.textContent = message;
    notification.style.cssText = `
      position: fixed;
      top: 20px;
      right: 20px;
      background: ${type === 'error' ? '#ef4444' : type === 'success' ? '#10b981' : '#3b82f6'};
      color: white;
      padding: 12px 20px;
      border-radius: 8px;
      font-size: 14px;
      font-weight: 500;
      box-shadow: 0 4px 12px rgba(0, 0, 0, 0.15);
      z-index: 10000;
      animation: slideIn 0.3s ease-out;
    `;

    document.body.appendChild(notification);

    setTimeout(() => {
      notification.style.animation = 'slideOut 0.3s ease-in';
      setTimeout(() => notification.remove(), 300);
    }, 3000);
  }

  // Add CSS animations
  const style = document.createElement('style');
  style.textContent = `
    @keyframes slideIn {
      from {
        transform: translateX(400px);
        opacity: 0;
      }
      to {
        transform: translateX(0);
        opacity: 1;
      }
    }
    @keyframes slideOut {
      from {
        transform: translateX(0);
        opacity: 1;
      }
      to {
        transform: translateX(400px);
        opacity: 0;
      }
    }
  `;
  document.head.appendChild(style);

  // Observe for comment boxes and inject buttons
  function observeCommentBoxes() {
    const observer = new MutationObserver((mutations) => {
      for (const mutation of mutations) {
        for (const node of mutation.addedNodes) {
          if (node.nodeType !== Node.ELEMENT_NODE) continue;

          // Log what was added to help debug
          if (node.tagName && (node.querySelector?.('textarea') || node.querySelector?.('[contenteditable="true"]'))) {
            console.log('[RedditPipe AI Generator] Detected element with text input:', node.tagName, node.className, node);
          }

          // Try multiple selectors for different Reddit UI variations
          const selectors = [
            'shreddit-composer', // New Reddit composer element
            '[data-testid="comment-submission-form-richtext"]',
            '[contenteditable="true"][role="textbox"]', // New Reddit contenteditable
            '.usertext-edit', // Old Reddit
            'form[id*="commentForm"]', // Generic comment form
          ];

          for (const selector of selectors) {
            const boxes = node.matches?.(selector)
              ? [node]
              : (node.querySelectorAll?.(selector) || []);

            if (boxes.length > 0) {
              console.log(`[RedditPipe AI Generator] MutationObserver found ${boxes.length} boxes matching "${selector}"`);
            }

            for (const box of boxes) {
              injectAIButton(box);
            }
          }
        }
      }
    });

    observer.observe(document.body, { childList: true, subtree: true });

    // Also inject into existing comment boxes - try all selectors
    const allSelectors = [
      'shreddit-composer',
      '[data-testid="comment-submission-form-richtext"]',
      '[contenteditable="true"][role="textbox"]',
      '.usertext-edit',
      'form[id*="commentForm"]',
    ];
    
    let foundCount = 0;
    allSelectors.forEach(selector => {
      const elements = document.querySelectorAll(selector);
      console.log(`[RedditPipe AI Generator] Found ${elements.length} elements matching "${selector}"`);
      elements.forEach(el => {
        injectAIButton(el);
        foundCount++;
      });
    });

    console.log(`[RedditPipe AI Generator] Observing comment boxes (injected into ${foundCount} existing boxes)`);
  }

  // Start observing after page load
  if (document.readyState === 'loading') {
    document.addEventListener('DOMContentLoaded', observeCommentBoxes);
  } else {
    observeCommentBoxes();
  }

  console.log('[RedditPipe AI Generator] Initialized');
})();
