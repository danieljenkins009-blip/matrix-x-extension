# Claude Code instructions for Matrix X

This is a Chrome MV3 extension that overlays x.com / twitter.com with a Matrix-style canvas. See `README.md` for what it does end-to-end.

## Architecture in one paragraph

Three execution contexts:

- **Content script** (`content.js` + `styles.css`, isolated world) — builds the overlay, scrapes tweets from the hidden X DOM, runs the canvas animation, and makes authenticated GraphQL calls back to X.
- **MAIN-world scripts** (`interceptor.js`, `hlsplayer.js`, `hls.min.js`) — injected by the service worker into the page's own JS context. The interceptor patches `fetch`/`XMLHttpRequest` to capture video URLs and per-operation `queryId`s; the HLS player attaches m3u8 streams to `<video>` elements.
- **Service worker** (`background.js`) — listens for X tabs loading and injects the MAIN-world scripts.

Content script and MAIN world cannot share globals. They communicate via `window.postMessage` with `__mx_*` discriminator fields.

## Before committing

Always do these two things before creating a commit:

1. **Check whether `README.md` needs updating.** Did you change install steps, file layout, keyboard controls, dependencies, or behavior the user can see? Update the README in the same commit.
2. **Update `CHANGELOG.md`.** Add an entry under the appropriate version section describing the change. If there is no unreleased section, create one (`## [Unreleased]`). Follow the existing Keep a Changelog format.

## Default to asking, not doing

The user is not a professional developer. For anything in this list, propose the change in chat and wait for confirmation before doing it:

- Adding or deleting a file.
- Changing `manifest.json` (permissions, content script matches, MV version).
- Removing code that looks unused — it may be load-bearing in a way that isn't obvious from grep.
- Committing the gitignored files (`hls.min.js`, `icon*.png`, `.claude/`).
- Any structural refactor that touches more than one file.
