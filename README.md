# RedditPipe Companion Chrome Extension

Chrome extension companion for RedditPipe — Reddit outreach pipeline manager.

## Features

- **Account Detection**: Automatically detects logged-in Reddit account
- **Opportunity Queue**: View and manage queued Reddit outreach opportunities
- **Auto-Verification**: Automatically verifies posted comments
- **Account Switching**: Easy switching between multiple Reddit accounts with copy/paste credentials
- **Safety Metrics**: Track posting limits and organic:citation ratios
- **Draft Management**: Copy AI-generated comment drafts with one click

## Installation

### From Release
1. Download the latest `redditpipe-extension-X.X.X.zip` from [Releases](https://github.com/mikevillargr/redditpipe-companion-chrome-extension/releases)
2. Unzip the file
3. Open Chrome and navigate to `chrome://extensions/`
4. Enable "Developer mode" (top right)
5. Click "Load unpacked" and select the unzipped `redditpipe-extension` folder

### From Source
1. Clone this repository
2. Open Chrome and navigate to `chrome://extensions/`
3. Enable "Developer mode" (top right)
4. Click "Load unpacked" and select the `redditpipe-extension` folder

## Configuration

1. Click the extension icon to open the popup
2. Click the settings icon (⚙️) to configure:
   - **Server URL**: RedditPipe backend URL (default: `http://76.13.191.149:3200`)
   - **Poll Interval**: How often to check for new opportunities (default: 5 minutes)
   - **Notifications**: Enable/disable browser notifications

## Usage

### Viewing Opportunities
- Click the extension icon to see your queued opportunities
- Badge shows count of new opportunities
- Click "Go to thread" to navigate to the Reddit thread
- Click "Copy draft" to copy the AI-generated comment

### Posting Comments
1. Navigate to a Reddit thread with a queued opportunity
2. Copy the draft from the extension popup
3. Post your comment on Reddit
4. The extension automatically detects and verifies your comment

### Account Switching
1. Click "Logout" in the popup to log out of Reddit
2. The popup will show all available accounts with copy buttons
3. Click 👤 to copy username, 🔑 to copy password
4. Paste credentials into Reddit's login page
5. Extension auto-detects the new account

### Logging Organic Posts
- Click "🌱 Log organic" when you post non-outreach content
- Helps maintain healthy organic:citation ratios

## Development

### Project Structure
```
redditpipe-extension/
├── manifest.json           # Extension manifest
├── background/
│   └── service-worker.js  # Background service worker
├── content/
│   ├── detector.js        # Account & comment detection
│   └── navigator.js       # Thread navigation helper
├── popup/
│   ├── popup.html         # Popup UI
│   ├── popup.js           # Popup logic
│   └── popup.css          # Popup styles
├── lib/
│   └── api.js            # API client
└── icons/                # Extension icons
```

### Deployment

#### Automatic (GitHub Actions)
Push a new version tag:
```bash
git tag v1.2.3
git push origin v1.2.3
```

The GitHub Actions workflow will:
1. Build the extension
2. Deploy to VPS
3. Create a GitHub release

#### Manual
```bash
./deploy-extension.sh
```

## Versioning

This project uses [Semantic Versioning](https://semver.org/):
- **MAJOR**: Breaking changes
- **MINOR**: New features (backward compatible)
- **PATCH**: Bug fixes (backward compatible)

## Changelog

See [CHANGELOG.md](CHANGELOG.md) for version history.

## License

Proprietary - All rights reserved
