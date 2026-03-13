# Changelog

All notable changes to this project will be documented in this file.

The format is based on [Keep a Changelog](https://keepachangelog.com/en/1.0.0/),
and this project adheres to [Semantic Versioning](https://semver.org/spec/v2.0.0.html).

## [1.0.0] - 2026-03-13

### Added
- Initial release
- Account detection via Reddit API and DOM parsing
- Automatic comment verification
- Opportunity queue management
- Account switching with copy/paste credentials
- Safety metrics (posting limits, organic:citation ratio)
- Draft management with one-click copy
- Browser notifications for verified comments
- Configurable server URL and poll interval

### Fixed
- Citation ratio now uses correct fields (organicPostsTotal/citationPostsTotal)
- Citation ratio label format matches dashboard (organic:citation)
- Go to Thread now uses current window instead of opening duplicate tabs
- Account detection after manual login with aggressive re-detection
- Popup auto-refreshes to pick up background poll results

### Changed
- Popup size increased to 480x600px for better usability
- Removed debugger-based auto-fill (switched to manual copy/paste workflow)
- Logout button clears all Reddit cookies and navigates to login page

## [0.9.0] - 2026-03-12

### Added
- Debugger-based auto-fill login (later removed in 1.0.0)
- Copy username and password buttons for manual login

### Fixed
- Cookie clearing now properly removes all Reddit cookies including HttpOnly
- Added wildcard host permission for *.reddit.com

## [0.8.0] - 2026-03-10

### Added
- Account logout functionality
- Login account list when logged out
- Aggressive post-login account detection

### Fixed
- Extension now detects logged-in state after manual login

## [0.7.0] - 2026-03-08

### Added
- Detailed logging for comment detection debugging
- Console logs for verification flow

## [0.6.0] - 2026-03-05

### Added
- Initial comment auto-verification
- MutationObserver for comment detection
- Support for both new and old Reddit

## [0.5.0] - 2026-03-01

### Added
- Opportunity queue display
- Draft copy functionality
- Manual verification button

## [0.4.0] - 2026-02-25

### Added
- Safety bar with posting limits
- Organic:citation ratio tracking
- Warning indicators

## [0.3.0] - 2026-02-20

### Added
- Account dropdown with switching
- Preview mode for other accounts
- Status chips (active, warming, flagged, retired)

## [0.2.0] - 2026-02-15

### Added
- Basic popup UI
- Connection status indicator
- Settings page

## [0.1.0] - 2026-02-10

### Added
- Initial project setup
- Account detection
- Background polling
- Basic API integration
