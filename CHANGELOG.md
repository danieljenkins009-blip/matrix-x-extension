# Changelog

All notable changes to this project will be documented in this file.

The format is based on [Keep a Changelog](https://keepachangelog.com/en/1.1.0/),
and this project adheres to [Semantic Versioning](https://semver.org/spec/v2.0.0.html).

## [0.1.2] — 2026-05-03

Dans Initial MVP

### Added

- Full-screen Matrix-themed overlay that activates on `x.com` / `twitter.com`. The underlying X UI is hidden via CSS but kept scrollable in the background so the timeline continues paginating.
- Background canvas of falling Japanese/ASCII glyphs ("rain").
- Foreground canvas streaming live tweets horizontally, scraped from the hidden X timeline.
- Engagement-based "heat" classification (4 levels) derived from like/retweet counts, controlling per-row scroll speed and brightness.
- Inline `[IMAGE]` and `[VIDEO]` markers on tweets with media; clicking a marker opens an in-overlay viewer.
- HLS video playback via [hls.js](https://github.com/video-dev/hls.js) injected into the page's MAIN world (`hlsplayer.js`). MP4 fallback when available.
- MAIN-world `fetch` / `XMLHttpRequest` interceptor (`interceptor.js`) that captures X's GraphQL responses to extract video URLs and per-operation `queryId`s.
- Auth bootstrapping (`discoverFromScripts` in `content.js`): regex-scans X's own JS bundles on first load to recover the `Bearer` token and the `queryId`s for `FavoriteTweet`, `UnfavoriteTweet`, `CreateRetweet`, `DeleteRetweet`, `TweetDetail`, and `CreateTweet`. CSRF is taken from the `ct0` cookie.
- Keyboard-driven interaction with the selected row:
  - `↑` / `↓` — move the selection
  - `1` — like / unlike
  - `0` — retweet / undo retweet
  - `2` — open the reply viewer for the selected tweet
  - `R` — reply (from inside the reply viewer)
  - `X` — open the compose box (new tweet)
  - `F` — open the search box
  - `Esc` — exit search mode and restore the home feed
- Reply viewer that fetches threaded replies via the `TweetDetail` GraphQL operation.
- Compose / reply box that posts via the `CreateTweet` GraphQL operation.
- Live search backed by `SearchTimeline`, with two execution paths:
  - Direct call when the `queryId` is already known.
  - Router fallback that pushes history to `/search?q=...&f=live` and lets the interceptor capture X's own response.
- Wheel-scroll hijacking that forwards scroll to X's hidden timeline container so new tweets keep loading.
- `MutationObserver` on `[data-testid="primaryColumn"]` plus a 3-second safety poll so the tweet stream keeps up with X's React re-renders.
- Fullscreen toggle button (`⛶`) in the top-left of the overlay.
