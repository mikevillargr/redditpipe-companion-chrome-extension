# RedditPipe Chrome Extension — Product Specification

## Overview

A companion Chrome extension for RedditPipe that eliminates the manual friction of switching Chrome profiles, copy-pasting drafts, and verifying posted comments. The extension connects to a team's self-hosted RedditPipe instance and surfaces relevant opportunities directly in the browser while the team member is on Reddit.

**Core workflow with extension:**
1. Team member opens Reddit — extension detects the logged-in account (e.g., `u/fitness_mike`)
2. Extension pulls queued opportunities for that account from RedditPipe
3. Team member can switch Reddit accounts directly from the extension dropdown (no Chrome profile juggling)
4. Clicks an opportunity → extension opens the thread and copies the draft
5. Team member pastes and posts the comment
6. Extension detects the posted comment, grabs the permalink, and auto-verifies back to RedditPipe
7. No profile switching, no copy-pasting permalinks, no manual "Mark as Published"

---

## Architecture

```
┌─────────────────────┐       ┌──────────────────────┐
│  Chrome Extension    │       │  RedditPipe Server    │
│                      │       │  (self-hosted)        │
│  - Popup UI          │◄─────►│  - /api/opportunities │
│  - Content Script    │  HTTP │  - /api/accounts      │
│  - Background Worker │       │  - /api/extension/*   │
└─────────────────────┘       └──────────────────────┘
```

The extension communicates with the RedditPipe API over HTTP. The server URL is configured in the extension's options page.

**No authentication in v1** — same as the main app (internal tool, secured via network/VPN). The extension trusts that if it can reach the API, it's authorized.

---

## Extension Structure

```
redditpipe-extension/
├── manifest.json              # Manifest V3
├── popup/
│   ├── popup.html             # Main popup UI
│   ├── popup.css              # Styles (dark theme matching RedditPipe)
│   └── popup.js               # Popup logic — fetch opportunities, handle actions
├── content/
│   ├── detector.js            # Content script — detect logged-in user, detect posted comments
│   ├── navigator.js           # Content script — navigate to thread, pre-fill comment box
│   └── account-switcher.js    # Content script — switch Reddit accounts via login API
├── background/
│   └── service-worker.js      # Background — API polling, badge updates, message routing
├── options/
│   ├── options.html           # Settings page
│   └── options.js             # Save/load RedditPipe server URL
├── icons/
│   ├── icon-16.png
│   ├── icon-48.png
│   └── icon-128.png
└── lib/
    └── api.js                 # Shared API client for RedditPipe
```

---

## Manifest V3

```json
{
  "manifest_version": 3,
  "name": "RedditPipe",
  "version": "1.0.0",
  "description": "Companion extension for RedditPipe — Reddit outreach pipeline manager",
  "permissions": [
    "activeTab",
    "storage",
    "alarms",
    "clipboardWrite",
    "notifications"
  ],
  "host_permissions": [
    "https://www.reddit.com/*",
    "https://old.reddit.com/*",
    "http://localhost:*/*"
  ],
  "action": {
    "default_popup": "popup/popup.html",
    "default_icon": {
      "16": "icons/icon-16.png",
      "48": "icons/icon-48.png",
      "128": "icons/icon-128.png"
    }
  },
  "background": {
    "service_worker": "background/service-worker.js"
  },
  "content_scripts": [
    {
      "matches": ["https://www.reddit.com/*", "https://old.reddit.com/*"],
      "js": ["content/detector.js"],
      "run_at": "document_idle"
    }
  ],
  "options_page": "options/options.html",
  "icons": {
    "16": "icons/icon-16.png",
    "48": "icons/icon-48.png",
    "128": "icons/icon-128.png"
  }
}
```

**Note on `host_permissions`:** The localhost permission covers local development. For production deployment on a VPS, the team will need to add their server domain. This can be done via the options page — the extension should request the additional host permission dynamically using `chrome.permissions.request()` when the user sets a non-localhost server URL.

---

## Feature 1: Detect Current Reddit Account

**Content script: `content/detector.js`**

Runs on every Reddit page. Detects which Reddit account is currently logged in.

**Detection methods (try in order):**

1. **New Reddit:** Look for the username in the profile menu. Query selector: `[data-testid="user-drawer-button"]` or the username text in the top-right nav. Alternatively, check `document.cookie` for `reddit_session` and decode, or hit `https://www.reddit.com/api/me.json` from the page context.

2. **Old Reddit:** The logged-in username appears in the top-right header bar. Query selector: `#header .user a` — the text content is the username.

3. **Fallback:** Make a fetch to `https://www.reddit.com/api/me.json` with credentials included (since the user is logged in, cookies will be sent). Parse `data.name` from the response.

**Behavior:**
- On detection, send the username to the background service worker via `chrome.runtime.sendMessage({ type: "ACCOUNT_DETECTED", username })`
- Re-detect on page navigation (Reddit is an SPA on new Reddit — use `MutationObserver` on the URL or `navigation` API)
- If no user detected (logged out), send `{ type: "ACCOUNT_DETECTED", username: null }`

**Background service worker receives the username and:**
- Stores it in `chrome.storage.local` as `currentRedditUser`
- Fetches the matching RedditPipe account via `GET /api/accounts?username={username}`
- If match found, stores account ID and fetches opportunities
- Updates the extension badge with the count of queued opportunities

---

## Feature 2: Account Switcher

**Inspired by Reddit Enhancement Suite (RES).** RES stores username/password pairs in the extension and switches accounts by calling Reddit's login API, clearing the session cookie, and reloading. We do the same, but pull credentials from the RedditPipe API instead of storing them locally in the extension.

**Content script: `content/account-switcher.js`**

**How the switch works:**

1. Extension fetches all RedditPipe accounts via `GET /api/accounts` (includes usernames and passwords)
2. When team member selects a different account from the dropdown:
   a. Clear the current Reddit session cookie: `document.cookie = 'reddit_session=;expires=Thu, 01 Jan 1970;path=/;domain=.reddit.com'`
   b. Also clear `token_v2` and `edgebucket` cookies (new Reddit uses these)
   c. POST to Reddit's login endpoint to establish new session:
      ```
      POST https://www.reddit.com/api/login/{username}
      Content-Type: application/x-www-form-urlencoded
      Body: user={username}&passwd={password}&rem=true&api_type=json
      ```
   d. On success: Reddit returns a new session cookie. Reload the page.
   e. On failure: Show notification "Auto-switch failed — please log in manually" and open `https://www.reddit.com/login` in the current tab

3. After page reload, `detector.js` picks up the new username and the background worker fetches that account's opportunities automatically.

**Handling new Reddit vs old Reddit:**

New Reddit uses a different auth mechanism (OAuth-based session tokens). The `/api/login` endpoint works on old Reddit but may not set the right cookies for new Reddit. To handle this:

- **Strategy A (preferred):** Use old Reddit for the login call: `POST https://old.reddit.com/api/login/{username}`. The session cookie set by old Reddit is valid across both old and new Reddit since it's on the `.reddit.com` domain.
- **Strategy B (fallback):** If the programmatic login fails, use `chrome.tabs.update()` to navigate to `https://www.reddit.com/login` and show a floating bar: "RedditPipe: Please log in as u/{targetUsername}" so the team member can log in manually. After login, detector.js picks up the new account automatically.

**Handling 2FA accounts:**

If a Reddit account has two-factor authentication enabled:
- Reddit's login API responds with `"WRONG_PASSWORD"` or a 2FA challenge
- The extension should detect this and show a modal prompt in the popup: "Enter 2FA code for u/{username}"
- Resubmit the login with the password appended: `passwd={password}:{otp_code}` (this is how Reddit accepts 2FA inline)
- If 2FA is a frequent issue, add a "Requires 2FA" flag per account in RedditPipe so the extension always prompts for the code upfront

**Popup UI — Account Dropdown:**

At the top of the popup, above the opportunity list:

```
┌──────────────────────────────────┐
│ 🔴 u/fitness_mike          ▼    │  ← Dropdown showing current account
│ ● Active · 1/3 posts · 20% cit  │  ← Status + safety stats for current
├──────────────────────────────────┤
│   u/legal_helper (3 queued)      │  ← Other accounts with opportunity counts
│   u/tech_sarah (1 queued)        │
│   u/foodie_jay (0 queued)        │
│   ──────────────────             │
│   Preview only (don't switch)    │  ← Option to view another account's queue
│                                  │     without actually switching Reddit login
└──────────────────────────────────┘
```

**Two modes when selecting a different account:**

1. **"Switch & Go"** (default) — Switches the Reddit login to the selected account, reloads the page, opportunity list updates. The team member is now posting as that account.

2. **"Preview only"** — Shows the selected account's opportunity queue in the popup without switching Reddit login. Useful for planning which account to work on next. If they click "Go to thread" on a previewed opportunity, the extension warns: "You're logged in as u/fitness_mike but this opportunity is for u/legal_helper. Switch account first?" with a "Switch & Go" button.

**Account list source:**
- Fetched from `GET /api/accounts` on popup open and cached in `chrome.storage.local`
- Includes: username, password (needed for switching), status, postsTodayCount, maxPostsPerDay, organicPostsWeek, citationPostsWeek
- Refreshed on each poll cycle
- Accounts with status "retired" or "flagged" are grayed out in the dropdown
- Opportunity counts shown next to each account name (fetched in parallel)

**Security considerations:**
- Passwords are transmitted from RedditPipe server to the extension over HTTP (or HTTPS if the server is behind TLS). This is the same security model as the main app — internal tool on a secured network.
- Passwords are cached in `chrome.storage.local` to avoid fetching on every popup open. Cleared when extension is uninstalled or when the user clicks "Clear cached data" in options.
- The extension never sends passwords anywhere except to Reddit's own login endpoint on `reddit.com`.

---

## Feature 3: Show Queued Opportunities

**Popup UI: `popup/popup.html` + `popup.js`**

When the team member clicks the extension icon, the popup shows:

**Header:**
- RedditPipe logo (RP in orange, small)
- Current account: `u/{username}` with status chip (Active/Warming/etc.)
- If no account detected: "Not logged into Reddit" message with "Open Reddit" button
- If account not in RedditPipe: "Account `u/{username}` not found in RedditPipe" with link to add it

**Account Safety Bar (always visible when account is active):**
- Posts today: `1/3` with progress bar (green/yellow/red)
- Citation ratio: `2:8` with progress bar and 25% target line
- If at daily limit: yellow warning banner "Daily post limit reached — do organic posting or wait"
- If citation ratio unhealthy: yellow warning "Citation ratio high — do some organic posts first"

**Opportunity List:**
- Fetched from `GET /api/opportunities?accountId={id}&status=new` (only new opportunities for this account)
- Sorted by relevance score descending
- Each opportunity card shows:
  - Subreddit chip: `r/fitness`
  - Thread title (truncated to 2 lines)
  - Relevance score dot (green/yellow/red)
  - Client name chip
  - Thread age: "2h ago"
  - Stats: ↑47 💬23
  - **"Go to thread"** button (primary action — orange)
  - **"Copy draft"** button (secondary — copies AI draft to clipboard)
  - Expandable draft preview (tap to expand, shows first 3 lines by default)

**Empty state:** "No opportunities queued for this account. Check RedditPipe for other accounts or run a new search."

**Footer:**
- "Log organic post" button (see Feature 4)
- "Open RedditPipe" link (opens main app in new tab)
- Connection status dot (green = connected to server, red = can't reach API)

**Styling:**
- Dark theme matching RedditPipe: slate-900 bg, slate-800 cards, orange-500 accents
- Popup dimensions: 380px wide × 520px tall (max, scrollable)
- Compact cards — this is a utility popup, not a full dashboard

---

## Feature 4: Auto-Navigate to Thread + Copy Draft

When the team member clicks **"Go to thread"** on an opportunity card:

**Step 1: Copy draft to clipboard**
- Use `navigator.clipboard.writeText(opportunity.aiDraftReply)`
- Show a brief toast in the popup: "Draft copied to clipboard"

**Step 2: Open the thread**
- Open `opportunity.threadUrl` in the current active tab (not a new tab — the team member is already on Reddit)
- Close the popup

**Step 3: Content script activates on the thread page**

Inject `content/navigator.js` on the thread page. This script:

1. **Scrolls to the comment box** at the bottom of the thread (or the main reply box)
2. **Shows a floating RedditPipe toolbar** anchored to the bottom-right of the page:
   - Small dark floating bar (slate-800, rounded, shadow)
   - Shows: "RedditPipe: Draft copied — paste and post" with client name
   - "Paste draft" button — clicks the comment box to focus it, then pastes from clipboard via `document.execCommand('paste')` or by setting the contentEditable div's innerHTML (Reddit uses a rich text editor)
   - "Dismiss" (X) button to hide the toolbar
   - The toolbar auto-hides after 60 seconds or when dismissed

**Handling Reddit's comment editor:**

Reddit uses different editors:
- **New Reddit (Fancy Pants editor):** `div[contenteditable="true"]` inside the comment form. Set `innerText`, dispatch `input` event.
- **New Reddit (Markdown mode):** `textarea[name="body"]`. Set `.value`, dispatch `input` event.
- **Old Reddit:** `textarea#thing_thing_xxx` or `textarea.commentarea`. Set `.value`, dispatch `input` event.

The content script should detect which editor is present and handle accordingly. If auto-paste fails, the "Draft copied to clipboard" notification is the fallback — team member can always Ctrl+V manually.

**Important:** The extension should NOT auto-submit the comment. The team member must review the pasted draft and click Reddit's "Comment" button themselves. This is a safety measure — always human-in-the-loop before posting.

---

## Feature 5: Auto-Detect Posted Comment + Verify

After the team member posts a comment, the extension should detect it and verify back to RedditPipe.

**Content script: `content/detector.js` (extended)**

**Detection approach:**

The content script monitors the current page for new comments by the logged-in user. Two detection strategies:

**Strategy 1: DOM Mutation Observer**
- Watch the comments container for new DOM nodes
- When a new comment appears authored by the current user (check username in comment header), capture it
- Extract the comment permalink from the comment's share/permalink element
- This works on both new and old Reddit, just with different selectors

**Strategy 2: Network request interception (more reliable)**
- Listen for successful POST requests to Reddit's comment endpoint
- New Reddit: `POST https://oauth.reddit.com/api/comment` or `POST https://www.reddit.com/api/comment`
- The response contains the new comment's data including its full name (ID)
- Construct permalink from the response data

**On detection:**
1. Extract the comment permalink URL
2. Extract the thread ID from the current page URL
3. Send to background service worker: `{ type: "COMMENT_POSTED", threadId, permalinkUrl, username }`

**Background service worker:**
1. Look up the opportunity in RedditPipe by threadId + accountId: `GET /api/opportunities?threadId={threadId}&accountId={accountId}`
2. If found and status is "new": call `POST /api/opportunities/{id}/verify` with the permalink
3. If auto-verify succeeds: show Chrome notification "✓ Comment verified for {clientName} in r/{subreddit}"
4. Update the badge count (decrement by 1)
5. If no matching opportunity found (organic post), do nothing unless the user manually logs it

**Floating toolbar update:**
After detection, update the RedditPipe toolbar on the page:
- Change message to "✓ Comment posted and verified in RedditPipe"
- Green checkmark icon
- Auto-hide after 5 seconds

**Edge cases:**
- User posts a comment on a thread that's NOT in RedditPipe → ignore silently
- User posts multiple comments on the same thread → only verify the first one (the opportunity is already published)
- User deletes and reposts → the second post triggers a new detection, which will be a no-op since the opportunity is already published
- Network error reaching RedditPipe API → show notification "Could not verify comment — open RedditPipe to verify manually" with link

---

## Feature 6: Organic Post Tracking

**In the popup footer:**
- "Log organic post" button with a subtle green leaf icon
- Clicking it calls `POST /api/accounts/{id}/log-organic` (new endpoint, see API additions below)
- Increments `organicPostsWeek` by 1
- Shows toast: "Organic post logged ✓ (Ratio: 8:2)"
- Updates the safety bar in real-time

**When to use it:**
The team member has just posted a non-citation comment (helping someone on Reddit without mentioning a client). They click this button to track that they contributed organic content, which improves the account's citation ratio.

**Auto-detect organic posts (stretch goal for v1.1):**
If the content script detects a posted comment AND there's no matching opportunity in RedditPipe for that thread, it could automatically prompt: "This looks like an organic post. Log it?" with a small floating prompt. But for v1, manual button is fine.

---

## New API Endpoints Required

Add these to the RedditPipe server to support the extension:

```
POST /api/accounts/{id}/log-organic
  - Increments organicPostsWeek by 1
  - Returns updated account stats (organicPostsWeek, citationPostsWeek, postsTodayCount)

GET /api/opportunities?threadId={threadId}
  - Existing endpoint, but ensure it supports filtering by threadId as a query param
  - Used by extension to match a posted comment to an opportunity

GET /api/extension/status
  - Health check endpoint
  - Returns { connected: true, version: "1.0.0" }
  - Used by extension to show connection status dot
```

Also ensure existing endpoints support the query patterns the extension needs:
- `GET /api/accounts` should support `?username={username}` filter
- `GET /api/opportunities` should support `?accountId={id}&status=new` and `?threadId={threadId}` filters

---

## Options Page

**`options/options.html`**

Simple settings form:

- **RedditPipe Server URL** (text input, default: `http://localhost:3000`)
  - "Test Connection" button that calls `/api/extension/status`
  - Success: green "Connected ✓" message
  - Failure: red "Cannot reach server" with troubleshooting hint
- **Polling interval** (select: 1 min, 5 min, 15 min — default 5 min)
  - How often the extension checks for new opportunities
- **Notifications** (toggle: on/off — default on)
  - Whether to show Chrome notifications on verification success
- **Auto-paste draft** (toggle: on/off — default on)
  - Whether "Go to thread" should attempt to auto-paste into the comment box
  - If off, it only copies to clipboard

Settings stored via `chrome.storage.sync` so they persist across devices if the user has Chrome sync enabled.

---

## Background Service Worker

**`background/service-worker.js`**

Responsibilities:

1. **Polling:** Use `chrome.alarms` to periodically fetch new opportunities from RedditPipe
   - On alarm: fetch opportunities for the current account, update badge count
   - Badge shows number of queued opportunities (orange background)
   - Badge clears when count is 0

2. **Message routing:** Receive messages from content scripts and popup
   - `ACCOUNT_DETECTED` → store username, fetch account, update badge
   - `COMMENT_POSTED` → look up opportunity, call verify endpoint, show notification
   - `GET_CURRENT_STATE` → return { username, accountId, opportunityCount, accountStats }

3. **Connection management:** Track whether the RedditPipe server is reachable
   - On each poll, if the server is unreachable, set connection status to false
   - Show a gray badge icon when disconnected

4. **Cache:** Keep a local cache of the current account's opportunities to make popup loads instant
   - Refresh on each poll cycle
   - Invalidate on verify/dismiss actions

---

## Design System

Match the main RedditPipe app:

```css
/* Dark theme — matches main app */
--bg-primary: #0f172a;       /* slate-900 */
--bg-card: #1e293b;          /* slate-800 */
--bg-hover: #334155;         /* slate-700 */
--text-primary: #f1f5f9;     /* slate-100 */
--text-secondary: #94a3b8;   /* slate-400 */
--accent-orange: #f97316;    /* orange-500 — primary actions */
--accent-blue: #3b82f6;      /* blue-500 — client tags */
--accent-green: #10b981;     /* emerald-500 — verified, healthy */
--accent-yellow: #f59e0b;    /* amber-500 — warnings */
--accent-red: #ef4444;       /* red-500 — danger */
--font: 'Inter', system-ui, -apple-system, sans-serif;
```

Popup should feel like a compact version of the dashboard — same visual language, just denser.

---

## User Flow Summary

```
1. Team member opens Chrome (single profile — no more profile juggling)
2. Navigates to reddit.com — currently logged in as u/fitness_mike
3. Extension detects u/fitness_mike → fetches 4 queued opportunities
4. Badge shows "4"

5. Team member clicks extension icon
6. Popup shows: account dropdown (u/fitness_mike selected) + stats + 4 opportunity cards
7. Also shows: u/legal_helper (3 queued), u/tech_sarah (1 queued) in dropdown

8. Clicks "Go to thread" on top opportunity
9. Extension: copies draft → opens thread → shows floating toolbar

10. Team member reviews draft, pastes into comment box, clicks Post
11. Extension detects new comment → grabs permalink → calls verify API

12. Floating toolbar: "✓ Comment posted and verified"
13. Chrome notification: "✓ Verified for Gymijet in r/fitness"
14. Badge updates to "3"

15. Team member wants to work on legal opportunities next
16. Opens extension → selects u/legal_helper from dropdown → "Switch & Go"
17. Extension clears Reddit session, logs in as u/legal_helper, page reloads
18. Popup now shows 3 opportunities for u/legal_helper
19. Repeat: Go to thread → paste → post → auto-verify

20. Team member browses Reddit, answers a question organically (no client mention)
21. Clicks extension → "Log organic post" → ratio updates
```

---

## Development Notes

- Build with vanilla JS (no framework needed for a popup this simple)
- Manifest V3 — required for Chrome Web Store and future compatibility
- Content scripts need to handle both new Reddit and old Reddit DOM structures
- Test with Reddit's SPA navigation — new Reddit doesn't do full page loads, so content scripts need to re-run detection on URL changes via `MutationObserver` or the `navigation` API
- The extension does NOT need to be published to Chrome Web Store — it can be loaded as an unpacked extension in developer mode for internal team use. This avoids the review process entirely.
- For distribution to the team: zip the extension folder, share via Slack/Drive, each team member loads it unpacked

---

## Future Enhancements (v1.1+)

- **Auto-detect organic posts:** If a posted comment doesn't match any opportunity, prompt "Log as organic?"
- **Inline draft editing:** Edit the AI draft directly in the popup before pasting
- **AI rewrite from popup:** Trigger regenerate/shorter/casual/formal from the popup toolbar
- **Post scheduling hints:** "Best time to post in r/fitness: 9-11 AM EST" based on subreddit activity patterns
- **Keyboard shortcuts:** Ctrl+Shift+R to open popup, Ctrl+Shift+G to go to next opportunity
- **Batch mode:** "Work through queue" button that auto-opens threads one by one as you post and verify each
- **Account health dashboard:** Expanded view showing all accounts' citation ratios, post counts, and warnings in one grid
