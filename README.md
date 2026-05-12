# Matrix X

A Chrome extension that replaces the X.com (Twitter) UI with a Matrix-style overlay. Real tweets stream horizontally across the screen as glowing green Courier text, with a falling-glyph rain canvas behind them. You drive the whole thing with the keyboard.

The underlying X page is not removed — it's hidden behind the overlay (`opacity: 0`) so it can keep scrolling in the background and trigger X's own pagination as you scroll.

## Features

- Live tweet stream: as new tweets render in X's hidden timeline, they're scraped and added to the streaming rows.
- Engagement-based styling: tweets are bucketed into 4 "heat" levels by like/retweet count, controlling scroll speed and brightness.
- Inline media markers: `[IMAGE]` and `[VIDEO]` tags appear on tweets with media; click them to open an in-overlay viewer (HLS streams supported via `hls.js`).
- Direct interaction with the selected tweet — like, retweet, view replies, post a reply, compose a new tweet, run a live search — all without leaving the overlay.

### Keyboard controls

| Key       | Action                                          |
| --------- | ----------------------------------------------- |
| `↑` / `↓` | Move the selection between streaming rows       |
| `1`       | Like / unlike the selected tweet                |
| `0`       | Retweet / undo retweet the selected tweet       |
| `2`       | Open the reply viewer for the selected tweet    |
| `R`       | Reply to the tweet whose replies are open       |
| `X`       | Open the compose box (new tweet)                |
| `F`       | Open the search box                             |
| `Esc`     | Exit search mode and return to the home feed    |

The fullscreen button (`⛶`) in the top-left toggles fullscreen.

## How it works

The extension runs in three execution contexts:

- **Content script** (`content.js` + `styles.css`) — runs in the isolated content-script world. Builds the overlay, scrapes tweets out of the hidden X DOM, runs the canvas animation loop, and makes authenticated GraphQL calls back to X for likes/retweets/replies/posts/search.
- **MAIN-world scripts** (`interceptor.js`, `hlsplayer.js`, `hls.min.js`) — injected by the service worker into the page's own JavaScript context so they can patch `fetch`/`XMLHttpRequest` and access the `Hls` global. The interceptor sniffs X's GraphQL traffic to capture video URLs and `queryId`s; the HLS player attaches m3u8 streams to `<video>` elements in the overlay.
- **Service worker** (`background.js`) — listens for X tabs loading and injects the three MAIN-world scripts.

To make API calls, the content script discovers the page's `Bearer` token and per-operation `queryId`s by regex-scanning X's own JS bundles on first load (`discoverFromScripts` in `content.js`). Authentication piggybacks on the user's existing `ct0` cookie. Nothing is sent off-device.

## Installing locally

### 1. Get the missing asset

`hls.min.js` is gitignored and must be obtained separately before loading. It's the [hls.js](https://github.com/video-dev/hls.js) library, used to play HLS video streams from X. Without it, video playback will fail silently on Chrome. (Safari's native HLS support means MP4 fallback can work without it, but Chrome cannot.)

Download a release build and save it as `hls.min.js` in the project root:

```sh
curl -L -o hls.min.js https://cdn.jsdelivr.net/npm/hls.js@latest/dist/hls.min.js
```

### 2. Load the extension into Chrome

1. Open `chrome://extensions`.
2. Toggle **Developer mode** on (top-right).
3. Click **Load unpacked** and select this project's directory.
4. Open or refresh any `https://x.com/*` or `https://twitter.com/*` tab.

The overlay should activate automatically. The console will log `MATRIX X v1.2 loaded` when the content script runs.

### 3. Reloading after edits

After editing any file, click the reload icon on the extension's card in `chrome://extensions`, then refresh the X tab. The service worker auto-reinjects the MAIN-world scripts on tab navigation, so a tab reload is enough.

## File layout

```
manifest.json     MV3 manifest, host perms for x.com/twitter.com, scripting permission
background.js     Service worker; injects MAIN-world scripts on X tabs
content.js        Overlay UI, tweet scraping, canvas animation, GraphQL client
styles.css        Overlay styling; hides the underlying X UI
interceptor.js    MAIN-world fetch/XHR hook; extracts video URLs + queryIds
hlsplayer.js      MAIN-world HLS attachment helper
hls.min.js        (gitignored) hls.js library — see step 1
icons/icon16.png  toolbar icon
```

## A note on X's API

This extension talks directly to X's private GraphQL endpoints (`/i/api/graphql/{queryId}/{op}`) using a `Bearer` token scraped from X's own JS bundles, plus the user's session cookie. Nothing leaves the user's machine, but this bypasses X's normal client and may violate X's terms of service. Use it on accounts you're willing to risk.
