# JSnitch

JSnitch is a Chrome Manifest V3 extension for passive client-side reconnaissance. It watches network-loaded text resources, scans their contents for interesting keywords, captures in-page `fetch` and `XMLHttpRequest` traffic, and presents the results in a popup UI with a dedicated source viewer.

## What It Does

- Passively watches completed `GET` requests through `chrome.webRequest`.
- Refetches text-based resources such as JavaScript, JSON, HTML, and other `text/*` responses.
- Scans resource contents for a small keyword list:
  - `api`
  - `key`
  - `token`
  - `auth`
  - `bearer`
  - `secret`
  - `password`
- Captures page-level `fetch` and XHR requests by injecting a page-context hook.
- Stores request metadata including URL, method, headers, payload, and response body.
- Shows scoped results for the active site:
  - Findings
  - Resource report
  - Cookies
  - URL structure map
  - Custom search across analyzed resources
  - Network request inspection
- Opens a dedicated viewer that fetches the source file and highlights the matched text with line and column context.

## How It Works

### Background Service Worker

The background worker controls monitoring state, tracks scanned URLs, stores findings, keeps analyzed resource content in memory, and receives captured network traffic from the content script bridge.

When monitoring is enabled:

1. `chrome.webRequest.onHeadersReceived` observes completed responses.
2. Text-like `GET` resources are normalized and refetched.
3. The refetched body is scanned for keyword hits.
4. Findings and resource metadata are stored in memory.

### Content Script and Injection

The extension injects a page-context script because normal content scripts cannot directly monkey-patch the page’s own `fetch` and `XMLHttpRequest` implementations.

- `content.js` injects `injected.js` into the page.
- `injected.js` wraps `window.fetch` and `XMLHttpRequest`.
- Captured request data is sent back via `window.postMessage`.
- The content script forwards it to the background worker through `chrome.runtime.sendMessage`.

### Popup UI

The popup provides two primary views:

- `Scanner`: findings, analyzed resources, cookies, structure, and custom search.
- `Network`: captured XHR/fetch requests with filterable methods and a detail pane.

### Source Viewer

The viewer opens as its own extension page and fetches the selected resource directly. It renders the source line-by-line and highlights the matched range.

## Project Structure

```text
JSnitch/
├── manifest.json
├── README.md
└── src/
    ├── background/
    │   └── background.js
    ├── content/
    │   ├── content.js
    │   └── injected.js
    ├── core/
    │   ├── keywords.js
    │   └── scanner.js
    └── ui/
        ├── popup/
        │   ├── popup.css
        │   ├── popup.html
        │   └── popup.js
        └── viewer/
            ├── viewer.css
            ├── viewer.html
            └── viewer.js
```

## Installation

1. Open Chrome and go to `chrome://extensions`.
2. Enable `Developer mode`.
3. Click `Load unpacked`.
4. Select this project directory: `JSnitch/`.

## Usage

1. Open the target site in Chrome.
2. Open the JSnitch extension popup.
3. Click `Start`.
4. Interact with the site so resources and requests are generated.
5. Review:
   - `Findings` for keyword matches
   - `Report` for scanned resources
   - `Cookies` for domain cookies
   - `Structure` for discovered resource paths
   - `Search` for custom string matching across stored resources
   - `Network` for captured XHR/fetch requests
6. Use `Jump to match` to open the viewer and inspect the exact source location.

## Permissions

- `webRequest`: observe completed network responses.
- `cookies`: list cookies for the current site.
- `activeTab`: scope popup behavior to the active tab.
- `scripting`: supports runtime script-related extension behavior.
- `host_permissions: <all_urls>`: allows monitoring and fetching across sites.

## Notes and Limitations

- Findings and captured data are stored in memory and are cleared when the extension state is reset or the service worker lifecycle drops state.
- Resource scanning is limited to text-like responses and capped by size thresholds in the background worker.
- Network capture is limited to requests made through page `fetch` and XHR, not every browser-level request.
- The source viewer may fail to display some resources if they cannot be fetched from the extension page context.

## Main Files

- [manifest.json](./manifest.json)
- [src/background/background.js](./src/background/background.js)
- [src/content/content.js](./src/content/content.js)
- [src/content/injected.js](./src/content/injected.js)
- [src/core/scanner.js](./src/core/scanner.js)
- [src/core/keywords.js](./src/core/keywords.js)
- [src/ui/popup/popup.html](./src/ui/popup/popup.html)
- [src/ui/popup/popup.js](./src/ui/popup/popup.js)
- [src/ui/popup/popup.css](./src/ui/popup/popup.css)
- [src/ui/viewer/viewer.html](./src/ui/viewer/viewer.html)
- [src/ui/viewer/viewer.js](./src/ui/viewer/viewer.js)
- [src/ui/viewer/viewer.css](./src/ui/viewer/viewer.css)
