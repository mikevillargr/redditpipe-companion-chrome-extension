# RedditPipe Chrome Extension

Companion Chrome extension for RedditPipe — eliminates manual friction of switching Chrome profiles, copy-pasting drafts, and verifying posted comments.

## Installation

1. Open Chrome → `chrome://extensions/`
2. Enable **Developer mode** (top-right toggle)
3. Click **Load unpacked** → select the `redditpipe-extension/` folder
4. Click the extension icon → go to **Options** → set your RedditPipe server URL (default: `http://localhost:8000`)
5. Click **Test** to verify connection

## Features

| # | Feature | Description |
|---|---------|-------------|
| 1 | **Account Detection** | Auto-detects which Reddit account is logged in (new/old Reddit + API fallback) |
| 2 | **Account Switcher** | Switch Reddit accounts from the popup dropdown — clears cookies, logs in via old Reddit API |
| 3 | **Opportunity Queue** | Shows queued opportunities for the current account with relevance scores, drafts, stats |
| 4 | **Navigate + Copy** | "Go to thread" copies the AI draft, opens the thread, shows a floating toolbar to paste |
| 5 | **Auto-Verify** | Detects posted comments via DOM observer, auto-verifies back to RedditPipe |
| 6 | **Organic Tracking** | "Log organic post" button to track non-citation posts and maintain healthy citation ratio |
| 7 | **Pile-On Management** | View/create/publish pile-on comments on published primary opportunities; eligibility countdown |

## Architecture

```
popup/          → Main UI (account dropdown, opportunity cards, safety stats)
content/        → Content scripts injected into Reddit pages
  detector.js   → Account detection + comment detection (auto-injected)
  navigator.js  → Floating toolbar + draft pasting (injected on "Go to thread")
  account-switcher.js → Reddit login switching (injected on account switch)
background/     → Service worker (polling, message routing, badge, caching)
options/        → Settings page (server URL, polling interval, toggles)
lib/api.js      → Shared API client for RedditPipe server
```

## Backend Additions

This extension required the following additions to the RedditPipe backend (in `../RedditPipe/reddit-outreach/backend/`):

**New file:** `src/routes/extension.ts`
- `GET /api/extension/status` — health check for extension connection

**Modified:** `src/routes/accounts.ts`
- Added `?username=` query filter to `GET /api/accounts`
- Added `POST /api/accounts/:id/log-organic` endpoint

**Modified:** `src/routes/opportunities.ts`
- Added `?accountId=` and `?threadId=` query filters to `GET /api/opportunities`

**Modified:** `src/index.ts`
- Added import + mount for extension routes

## Configuration

Settings are stored in `chrome.storage.sync` (persists across devices with Chrome sync):

| Setting | Default | Description |
|---------|---------|-------------|
| Server URL | `http://localhost:8000` | RedditPipe API server |
| Poll interval | 5 min | How often to check for new opportunities |
| Notifications | On | Chrome notifications on verification success |
| Auto-paste | On | Auto-paste draft into Reddit comment box |

## Development

No build step required. Edit files directly and reload the extension:
1. Make changes to any `.js`, `.html`, or `.css` file
2. Go to `chrome://extensions/` → click the refresh icon on the RedditPipe card
3. Close and reopen the popup to see changes

For content script changes, also reload the Reddit tab.

## Permissions

| Permission | Why |
|-----------|-----|
| `activeTab` | Navigate current tab to thread URLs |
| `storage` | Persist settings and cached state |
| `alarms` | Background polling for new opportunities |
| `clipboardWrite` | Copy AI drafts to clipboard |
| `notifications` | Show verification success notifications |
| `reddit.com/*` | Content scripts for account detection, comment detection, account switching |
| `localhost:*/*` | API calls to local RedditPipe server |
