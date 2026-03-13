# Contributing to RedditPipe Companion Chrome Extension

Thank you for your interest in contributing to the RedditPipe Companion Chrome Extension!

## Development Setup

### Prerequisites
- Chrome browser
- Git
- Access to RedditPipe backend (default: http://76.13.191.149:3200)

### Local Development

1. Clone the repository:
```bash
git clone https://github.com/mikevillargr/redditpipe-companion-chrome-extension.git
cd redditpipe-companion-chrome-extension
```

2. Load the extension in Chrome:
   - Open Chrome and navigate to `chrome://extensions/`
   - Enable "Developer mode" (top right)
   - Click "Load unpacked"
   - Select the `redditpipe-extension` folder

3. Make your changes to the extension files

4. Reload the extension:
   - Go to `chrome://extensions/`
   - Click the reload icon on the RedditPipe extension card

### Project Structure

```
redditpipe-extension/
├── manifest.json           # Extension manifest (Manifest V3)
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
│   └── api.js            # API client for RedditPipe backend
└── icons/                # Extension icons
```

## Making Changes

### Code Style
- Use vanilla JavaScript (no frameworks)
- Follow existing code style and patterns
- Use meaningful variable and function names
- Add comments for complex logic
- Keep functions small and focused

### Testing
Before submitting changes:
1. Test the extension with a fresh install
2. Verify all features work as expected
3. Test on both new and old Reddit
4. Check browser console for errors
5. Test account detection and switching
6. Verify comment auto-verification works

### Debugging
- Use Chrome DevTools console for popup debugging
- Check background service worker logs in `chrome://extensions/` → "service worker" link
- Use `console.log('[RedditPipe]', ...)` for consistent logging

## Submitting Changes

### Pull Request Process

1. Create a new branch:
```bash
git checkout -b feature/your-feature-name
```

2. Make your changes and commit:
```bash
git add .
git commit -m "Add feature: description of your changes"
```

3. Push to your fork:
```bash
git push origin feature/your-feature-name
```

4. Open a Pull Request on GitHub with:
   - Clear description of changes
   - Screenshots/videos if UI changes
   - Testing steps
   - Any breaking changes noted

### Commit Message Format
```
<type>: <description>

[optional body]
[optional footer]
```

Types:
- `feat`: New feature
- `fix`: Bug fix
- `docs`: Documentation changes
- `style`: Code style changes (formatting, etc.)
- `refactor`: Code refactoring
- `test`: Adding or updating tests
- `chore`: Maintenance tasks

Example:
```
feat: Add pile-on comment support

- Add pile-on UI to published opportunities
- Implement lazy loading for pile-on comments
- Add purple accent color for pile-on badges
```

## Deployment

### Manual Deployment
```bash
./deploy-extension.sh
```

### Automatic Deployment (GitHub Actions)
Push a new version tag:
```bash
# Update version in manifest.json and CHANGELOG.md first
git tag v1.1.0
git push origin v1.1.0
```

The GitHub Actions workflow will automatically:
- Build the extension
- Deploy to VPS
- Create a GitHub Release

## Versioning

This project follows [Semantic Versioning](https://semver.org/):
- **MAJOR** (x.0.0): Breaking changes
- **MINOR** (1.x.0): New features (backward compatible)
- **PATCH** (1.0.x): Bug fixes (backward compatible)

## Questions?

For questions or discussions, please open an issue on GitHub.
