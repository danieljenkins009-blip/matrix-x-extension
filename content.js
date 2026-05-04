console.log("MATRIX X v2.0 loaded");

// ─── CLEANUP ──────────────────────────────────────────────────────────────────
const _old = document.getElementById("mx-overlay");
if (_old) _old.remove();

// ─── CONFIG ───────────────────────────────────────────────────────────────────
const CFG = {
  ROW_HEIGHT:    18,
  FONT_SIZE:     13,
  MAX_TWEET_LEN: 160,
  SPEEDS:        { 4: 0.9, 3: 0.7, 2: 0.5, 1: 0.35 },
};

const TWEET_FONT = `${CFG.FONT_SIZE}px "Courier New",monospace`;
const BOLD_FONT  = `bold ${CFG.FONT_SIZE}px "Courier New",monospace`;
const HEAT_COLOR = { 4:"#b8ffc8", 3:"#33ff66", 2:"#00aa44", 1:"#1d5c2e" };
const HEAD_STYLE = { 4:"#ffffff", 3:"#eaffef", 2:"#ccffdd", 1:"#88ccaa" };

const GLYPHS = "ｦｧｨｩｪｫｬｭｮｯｱｲｳｴｵｶｷｸｹｺｻｼｽｾｿﾀﾁﾂﾃﾄﾅﾆﾇﾈﾉﾊﾋﾌﾍﾎﾏﾐﾑﾒﾓﾔﾕﾖﾗﾘﾙﾚﾛﾜﾝ" +
  "日月火水木金土年時上下大小中人口心天地語文電機数字" +
  "ABCDEFGHIJKLMNOPQRSTUVWXYZ0123456789@#¥$%&";

// ─── STATE ────────────────────────────────────────────────────────────────────
let orderedTweets = [];
let animPaused    = false;
let viewerOpen    = false;
let capturedAuth  = null;
const queryIds    = {};
let commentBackdrop = null;
let searchMode    = false;
let searchQuery   = "";
let homeTweets    = null;
let searchBanner  = null;
let _searchResolve = null;
let monoW = 8;
let W     = window.innerWidth;
let H     = window.innerHeight;

// ─── BAND STATE ───────────────────────────────────────────────────────────────
const BASE_VEL  = 0.6;   // px/frame base auto-scroll speed
const TWEET_GAP = 28;    // px of breathing room after each tweet before the next head char
const BAND_H    = 46;    // total pixel height of tweet band (single line + hints)
const LINE_H    = 16;    // px between wrapped lines within a card
let bandOffset      = 0;    // total px scrolled (increases as band moves left)
let wheelVel        = 0;    // extra velocity from scroll wheel, decays each frame
let selectedCard    = 0;    // index into orderedTweets of selected tweet
let tweetOffsets    = [];   // parallel array: pixel x of each tweet's start from band origin
let bandTotalWidth  = 0;    // sum of all tweet widths (px)

// Populated by the MAIN-world interceptor via postMessage
const videoUrlById  = new Map();  // id → best MP4 (or m3u8 fallback)
const videoM3u8ById = new Map();  // id → m3u8 stream url

const QID_MAP = {
  FavoriteTweet:    "favorite",
  UnfavoriteTweet:  "unfavorite",
  CreateRetweet:    "retweet",
  DeleteRetweet:    "unretweet",
  TweetDetail:      "tweetDetail",
  CreateTweet:      "createTweet",
  SearchTimeline:   "searchTimeline",
};

window.addEventListener("message", e => {
  if (e.source !== window) return;
  if (e.data?.__mx_videos) {
    Object.entries(e.data.videos || {}).forEach(([id, url]) => videoUrlById.set(id, url));
    Object.entries(e.data.m3u8s  || {}).forEach(([id, url]) => videoM3u8ById.set(id, url));
    return;
  }
  if (e.data?.__mx_qid) {
    const key = QID_MAP[e.data.op];
    if (key && !queryIds[key]) queryIds[key] = e.data.id;
    return;
  }
  if (e.data?.__mx_srch && _searchResolve) {
    const fn = _searchResolve;
    _searchResolve = null;
    fn(e.data.data);
  }
});

// ─── DOM ──────────────────────────────────────────────────────────────────────
const overlay = document.createElement("div");
overlay.id    = "mx-overlay";

const rainCanvas  = document.createElement("canvas");
rainCanvas.id     = "mx-rain";

const tweetCanvas = document.createElement("canvas");
tweetCanvas.id    = "mx-tweets";

const fsBtn       = document.createElement("button");
fsBtn.id          = "mx-fs-btn";
fsBtn.title       = "Fullscreen";
fsBtn.textContent = "⛶";

overlay.appendChild(rainCanvas);
overlay.appendChild(tweetCanvas);
overlay.appendChild(fsBtn);
document.body.appendChild(overlay);

const rainCtx  = rainCanvas.getContext("2d");
const tweetCtx = tweetCanvas.getContext("2d");

// ─── HELPERS ──────────────────────────────────────────────────────────────────
function cleanText(t) { return (t || "").replace(/\s+/g, " ").trim(); }
function truncate(t, n) { return t.length <= n ? t : t.slice(0, n).trimEnd() + "…"; }
function randGlyph() { return GLYPHS[Math.floor(Math.random() * GLYPHS.length)]; }


// ─── TWEET EXTRACTION ─────────────────────────────────────────────────────────
function scoreEngagement(article) {
  let total = 0;
  article.querySelectorAll("[aria-label]").forEach(el => {
    const m = (el.getAttribute("aria-label") || "").match(/^([\d,]+)\s+(like|retweet|reply)/i);
    if (m) total += parseInt(m[1].replace(/,/g, ""), 10);
  });
  article.querySelectorAll(
    '[data-testid="like"] span[data-testid="app-text-transition-container"],' +
    '[data-testid="retweet"] span[data-testid="app-text-transition-container"]'
  ).forEach(el => {
    const n = parseFloat((el.innerText || "").replace(/,/g, "").replace(/k$/i, "e3").replace(/m$/i, "e6"));
    if (!isNaN(n)) total += n;
  });
  return total >= 5000 ? 4 : total >= 500 ? 3 : total >= 30 ? 2 : 1;
}

function extractTweets() {
  const seen    = new Set(orderedTweets.map(t => t.text));
  const results = [];

  document.querySelectorAll("article").forEach(article => {
    try {
      // Handle / username
      const handleEl = article.querySelector('[data-testid="User-Name"]');
      const rawHandle = cleanText(handleEl ? handleEl.innerText : "");
      const handle    = (rawHandle.match(/@[\w]{1,25}/) || ["@?"])[0];

      // Tweet body — try tweetText first, then any lang-tagged element, then innerText
      let tweetText = "";
      const tweetTextEl = article.querySelector('[data-testid="tweetText"]');
      if (tweetTextEl) {
        tweetText = cleanText(tweetTextEl.innerText);
      } else {
        const pieces = [];
        article.querySelectorAll("[lang]").forEach(n => {
          const t = cleanText(n.innerText); if (t.length > 3) pieces.push(t);
        });
        tweetText = pieces.join(" ").trim();
      }

      tweetText = truncate(cleanText(tweetText), CFG.MAX_TWEET_LEN);
      if (!tweetText || tweetText.length < 4) return;

      // Tweet ID (for video URL lookup from interceptor)
      const tweetLink = article.querySelector('a[href*="/status/"]');
      const tweetId   = tweetLink?.href?.match(/\/status\/(\d+)/)?.[1] || null;

      // Media — get largest image size; find non-blob video URL
      const imgEl    = article.querySelector('img[src*="pbs.twimg.com/media"]');
      const imageUrl = imgEl ? imgEl.src.replace(/([?&]name=)\w+/, "$1large") : null;

      let videoUrl = null;
      const videoEl = article.querySelector('video, [data-testid="videoPlayer"] video');
      if (videoEl) {
        // GIF-type MP4: direct src attribute (not a blob)
        const attr = videoEl.getAttribute("src");
        if (attr && !attr.startsWith("blob:")) videoUrl = attr;
        // HLS video: look for <source> children with real URLs
        if (!videoUrl) {
          videoEl.querySelectorAll("source").forEach(s => {
            const u = s.getAttribute("src");
            if (u && !u.startsWith("blob:") && !videoUrl) videoUrl = u;
          });
        }
        // Last resort: poster thumbnail shown as image
        if (!videoUrl && videoEl.poster && !videoEl.poster.startsWith("blob:")) {
          videoUrl = videoEl.poster;  // will render as <img> in viewer
        }
      }

      let mediaTag = "";
      if (videoEl || article.querySelector('[data-testid="videoPlayer"]')) mediaTag = " [VIDEO]";
      else if (imageUrl) mediaTag = " [IMAGE]";

      const text = `${handle} · ${tweetText}${mediaTag}`;
      if (seen.has(text)) return;
      seen.add(text);
      results.push({ text, heat: scoreEngagement(article), imageUrl, videoUrl, tweetId });
    } catch (_) {}
  });

  return results;
}

function scrapeAndUpdate() {
  const fresh = extractTweets();
  if (fresh.length) {
    orderedTweets.push(...fresh);
    appendOffsets(fresh);
  }
}

// Append offset entries for newly added tweets (called after push)
function appendOffsets(tweets) {
  for (const t of tweets) {
    t._w = monoW + measureWidth(t.text.slice(1)) + TWEET_GAP;
    tweetOffsets.push(bandTotalWidth);
    bandTotalWidth += t._w;
  }
}

// Rebuild entire offset table (call after orderedTweets is replaced wholesale)
function rebuildOffsets() {
  tweetOffsets   = [];
  bandTotalWidth = 0;
  for (const t of orderedTweets) {
    if (!t._w) t._w = monoW + measureWidth(t.text.slice(1)) + TWEET_GAP;
    tweetOffsets.push(bandTotalWidth);
    bandTotalWidth += t._w;
  }
}

// ─── ANIMATION LOOP ───────────────────────────────────────────────────────────
let frame = 0;

function animate() {
  if (animPaused) { requestAnimationFrame(animate); return; }
  frame++;

  // Advance band position with velocity + momentum decay
  wheelVel  *= 0.94;
  const vel  = BASE_VEL + wheelVel;
  bandOffset = Math.max(0, bandOffset + vel);

  // Load more when within ~2 screen-widths of the end of loaded tweets
  if (bandTotalWidth > 0 && bandOffset + W * 3 >= bandTotalWidth) {
    window.scrollBy(0, 400);
    const xc = findScrollContainer();
    if (xc) xc.scrollTop += 400;
  }

  tweetCtx.clearRect(0, 0, W, H);
  tweetCtx.font         = TWEET_FONT;
  tweetCtx.textBaseline = "alphabetic";

  const bandY = Math.floor(H / 2);

  // Deco rows — scrolling fake-tweet glyphs filling top and bottom areas
  tweetCtx.textBaseline = "alphabetic";
  for (const row of decoRows) {
    row.offset += row.speed;
    if (row.offset >= row.textWidth) row.offset -= row.textWidth;
    tweetCtx.globalAlpha = row.alpha;
    tweetCtx.fillStyle   = HEAT_COLOR[row.heat] || HEAT_COLOR[1];
    let sx = -(row.offset % row.textWidth);
    for (let x = sx; x < W; x += row.textWidth) tweetCtx.fillText(row.text, x, row.y);
  }
  tweetCtx.globalAlpha = 1;

  if (orderedTweets.length === 0) {
    tweetCtx.fillStyle = "rgba(0,200,60,0.5)";
    tweetCtx.fillText("loading tweets…", 40, bandY);
    requestAnimationFrame(animate);
    return;
  }

  // Binary search: find last tweet whose start <= bandOffset (first potentially visible)
  let firstIdx = 0;
  if (tweetOffsets.length > 1) {
    let lo = 0, hi = tweetOffsets.length - 1;
    while (lo < hi) {
      const mid = (lo + hi + 1) >> 1;
      if (tweetOffsets[mid] <= bandOffset) lo = mid; else hi = mid - 1;
    }
    firstIdx = Math.max(0, lo);
  }

  for (let i = firstIdx; i < orderedTweets.length; i++) {
    const tweet = orderedTweets[i];
    const cardX = Math.floor((tweetOffsets[i] || 0) - bandOffset);
    if (cardX > W) break;

    const isSelected = i === selectedCard;
    const color      = isSelected ? "#ffffff" : (HEAT_COLOR[tweet.heat] || HEAT_COLOR[1]);
    const tw         = tweet._w || (monoW + measureWidth(tweet.text.slice(1)) + TWEET_GAP);

    // Clip to this tweet's exact pixel width so nothing bleeds
    tweetCtx.save();
    tweetCtx.beginPath();
    tweetCtx.rect(cardX, 0, tw, H);
    tweetCtx.clip();

    if (isSelected) {
      tweetCtx.shadowColor = "#00ff55";
      tweetCtx.shadowBlur  = 24;
    }

    // Full tweet body — no truncation, width is sized to fit
    tweetCtx.fillStyle = color;
    tweetCtx.fillText(tweet.text.slice(1), cardX + monoW, bandY);
    if (isSelected) tweetCtx.fillText(tweet.text.slice(1), cardX + monoW, bandY);

    // Flashing Matrix head character
    const headOn = (frame + i) % 6 < 3;
    tweetCtx.fillStyle = headOn ? "#ffffff" : (HEAD_STYLE[tweet.heat] || HEAD_STYLE[1]);
    tweetCtx.fillText(headOn ? tweet.text[0] : randGlyph(), cardX, bandY);

    if (isSelected) {
      tweetCtx.shadowBlur = 0;
      const hintsY   = bandY + LINE_H + 2;
      const likeStr  = tweet.liked     ? " ♥"    : " ♥[1]";
      const rtStr    = tweet.retweeted ? " ↺"    : " ↺[0]";
      const mediaStr = (tweet.imageUrl || tweet.videoUrl ||
                        videoUrlById.has(tweet.tweetId)  ||
                        videoM3u8ById.has(tweet.tweetId)) ? " ▶[↵]" : "";
      tweetCtx.fillStyle = tweet.liked     ? "#ff4466" : "rgba(180,180,180,0.75)";
      tweetCtx.fillText(likeStr, cardX, hintsY);
      tweetCtx.fillStyle = tweet.retweeted ? "#00ff55" : "rgba(180,180,180,0.75)";
      tweetCtx.fillText(rtStr, cardX + measureWidth(likeStr), hintsY);
      tweetCtx.fillStyle = "rgba(180,180,180,0.75)";
      tweetCtx.fillText(" »[2]" + mediaStr, cardX + measureWidth(likeStr + rtStr), hintsY);
    }

    tweetCtx.restore();

    // Subtle separator tick in the gap between tweets
    tweetCtx.fillStyle = "rgba(0,180,60,0.22)";
    tweetCtx.fillRect(cardX + tw - Math.floor(TWEET_GAP / 2), bandY - BAND_H / 2, 1, BAND_H);
  }

  requestAnimationFrame(animate);
}

// Hover over the band to select the card under the cursor
overlay.addEventListener("mousemove", e => {
  const bandY = Math.floor(H / 2);
  if (Math.abs(e.clientY - bandY) > BAND_H / 2 + 10) return;
  const absX = e.clientX + bandOffset;
  // Binary search for tweet containing absX
  let lo = 0, hi = tweetOffsets.length - 1;
  while (lo < hi) {
    const mid = (lo + hi + 1) >> 1;
    if (tweetOffsets[mid] <= absX) lo = mid; else hi = mid - 1;
  }
  if (lo >= 0 && lo < orderedTweets.length && lo !== selectedCard) selectedCard = lo;
});

// ─── TWEET INTERACTION ────────────────────────────────────────────────────────

// Scan X's cached JS bundles for Bearer token + all GraphQL queryIds we need.
// Scripts are already in the browser cache so fetching them is instant.
let _discovering = false;
async function discoverFromScripts() {
  if (_discovering) return;
  _discovering = true;
  const ops = {
    favorite:       /queryId:"([^"]+)",operationName:"FavoriteTweet"/,
    unfavorite:     /queryId:"([^"]+)",operationName:"UnfavoriteTweet"/,
    retweet:        /queryId:"([^"]+)",operationName:"CreateRetweet"/,
    unretweet:      /queryId:"([^"]+)",operationName:"DeleteRetweet"/,
    tweetDetail:    /queryId:"([^"]+)",operationName:"TweetDetail"/,
    createTweet:    /queryId:"([^"]+)",operationName:"CreateTweet"/,
  };
  const bearerRe = /Bearer (AAAAAAAAAA[A-Za-z0-9%+/=_-]{30,})/;

  function scan(text) {
    if (!capturedAuth) {
      const m = text.match(bearerRe);
      if (m) {
        const csrf = document.cookie.match(/ct0=([^;]+)/)?.[1] || "";
        capturedAuth = { auth: `Bearer ${m[1]}`, csrf };
      }
    }
    for (const [key, re] of Object.entries(ops)) {
      if (!queryIds[key]) {
        const m = text.match(re);
        if (m) queryIds[key] = m[1];
      }
    }
  }

  for (const s of document.querySelectorAll('script:not([src])')) scan(s.textContent || "");

  for (const s of document.querySelectorAll('script[src]')) {
    if (capturedAuth && Object.keys(queryIds).length >= Object.keys(ops).length) break;
    try {
      const r = await fetch(s.src, { cache: 'force-cache' });
      scan(await r.text());
    } catch (_) {}
  }
  _discovering = false;
}

async function ensureAuth() {
  if (!capturedAuth || !queryIds.favorite) await discoverFromScripts();
}

async function apiPost(queryId, operationName, variables, features = null) {
  const csrf = capturedAuth?.csrf || document.cookie.match(/ct0=([^;]+)/)?.[1] || "";
  const body = { variables, queryId };
  if (features) body.features = features;
  const res  = await fetch(`https://x.com/i/api/graphql/${queryId}/${operationName}`, {
    method: "POST",
    headers: {
      Authorization:           capturedAuth.auth,
      "x-csrf-token":          csrf,
      "content-type":          "application/json",
      "x-twitter-active-user": "yes",
      "x-twitter-auth-type":   "OAuth2Session",
    },
    credentials: "include",
    body: JSON.stringify(body),
  });
  if (!res.ok) throw new Error(`API ${res.status}`);
  return res.json();
}

async function likeTweet() {
  const tweet = orderedTweets[selectedCard];
  if (!tweet || tweet.isFallback || !tweet.tweetId) return;
  await ensureAuth();
  const op  = tweet.liked ? "UnfavoriteTweet" : "FavoriteTweet";
  const qid = tweet.liked ? queryIds.unfavorite : queryIds.favorite;
  if (!qid) return;
  tweet.liked = !tweet.liked;
  apiPost(qid, op, { tweet_id: tweet.tweetId }).catch(() => { tweet.liked = !tweet.liked; });
}

async function retweetTweet() {
  const tweet = orderedTweets[selectedCard];
  if (!tweet || tweet.isFallback || !tweet.tweetId) return;
  await ensureAuth();
  const removing = tweet.retweeted;
  const op       = removing ? "DeleteRetweet"  : "CreateRetweet";
  const qid      = removing ? queryIds.unretweet : queryIds.retweet;
  if (!qid) return;
  tweet.retweeted = !tweet.retweeted;
  // DeleteRetweet uses source_tweet_id; CreateRetweet uses tweet_id
  const vars = removing ? { source_tweet_id: tweet.tweetId } : { tweet_id: tweet.tweetId };
  apiPost(qid, op, vars).catch(() => { tweet.retweeted = !tweet.retweeted; });
}

document.addEventListener("keydown", e => {
  if (e.key === "2") {
    if (commentBackdrop && document.contains(commentBackdrop)) {
      commentBackdrop.click();
    } else if (!viewerOpen) {
      const tweet = orderedTweets[selectedCard];
      if (tweet && !tweet.isFallback) openCommentViewer(tweet);
    }
    return;
  }
  if (e.key === "r" || e.key === "R") {
    if (commentBackdrop && document.contains(commentBackdrop)) {
      const tweetForReply = orderedTweets[selectedCard];
      commentBackdrop.click();
      if (tweetForReply && !tweetForReply.isFallback) openComposeBox(tweetForReply);
    }
    return;
  }
  if (e.key === "x" || e.key === "X") {
    if (!viewerOpen) openComposeBox(null);
    return;
  }
  if (e.key === "f" || e.key === "F") {
    if (!viewerOpen) openSearchBox();
    return;
  }
  if (e.key === "Escape" && searchMode) {
    orderedTweets.length = 0;
    orderedTweets.push(...homeTweets);
    homeTweets   = null;
    searchMode   = false;
    searchQuery  = "";
    bandOffset   = 0;
    selectedCard = 0;
    rebuildOffsets();
    updateSearchBanner();
    return;
  }
  if (viewerOpen) {
    if (e.key === "Enter") document.getElementById("mx-viewer")?.click();
    return;
  }
  if (e.key === "ArrowRight") {
    selectedCard      = Math.min(orderedTweets.length - 1, selectedCard + 1);
    const selOff      = tweetOffsets[selectedCard] || 0;
    const selW        = orderedTweets[selectedCard]?._w || 200;
    if (selOff - bandOffset + selW > W) bandOffset = selOff - W + selW + 20;
  } else if (e.key === "ArrowLeft") {
    selectedCard      = Math.max(0, selectedCard - 1);
    const selOff      = tweetOffsets[selectedCard] || 0;
    if (selOff - bandOffset < 0) bandOffset = Math.max(0, selOff - 20);
  } else if (e.key === "1") {
    likeTweet();
  } else if (e.key === "0") {
    retweetTweet();
  } else if (e.key === "Enter") {
    const tweet = orderedTweets[selectedCard];
    if (tweet && !tweet.isFallback) {
      const mp4  = tweet.tweetId ? videoUrlById.get(tweet.tweetId)  : null;
      const m3u8 = tweet.tweetId ? videoM3u8ById.get(tweet.tweetId) : null;
      const url  = mp4 || m3u8 || tweet.videoUrl || tweet.imageUrl;
      if (url) openMediaViewer(url, (tweet.videoUrl || mp4 || m3u8) ? "video" : "img", !mp4 && !!m3u8, tweet.text);
    }
  }
});

// ─── SCROLL ───────────────────────────────────────────────────────────────────
let cachedScrollEl = null;
function findScrollContainer() {
  if (cachedScrollEl && document.contains(cachedScrollEl)) return cachedScrollEl;
  const article = document.querySelector("article");
  if (article) {
    let el = article.parentElement;
    while (el && el !== document.documentElement) {
      const s = window.getComputedStyle(el);
      if ((s.overflowY === "auto" || s.overflowY === "scroll") &&
           el.scrollHeight > el.clientHeight + 100) {
        return (cachedScrollEl = el);
      }
      el = el.parentElement;
    }
  }
  for (const sel of [
    '[data-testid="ScrollSnap-List"]',
    '[aria-label*="Timeline"]',
    '[data-testid="primaryColumn"] > div',
  ]) {
    const el = document.querySelector(sel);
    if (el && el.scrollHeight > el.clientHeight + 100) return (cachedScrollEl = el);
  }
  return null;
}

overlay.addEventListener("wheel", e => {
  e.preventDefault();
  const dir = e.deltaY > 0 ? 1 : -1;
  wheelVel  = Math.max(-BASE_VEL - 12, Math.min(18, wheelVel + dir * 3.5));
}, { passive: false });

// ─── COMMENT VIEWER ───────────────────────────────────────────────────────────
async function fetchReplies(tweet) {
  if (!tweet.tweetId) throw new Error("no tweetId");
  await ensureAuth();
  if (!capturedAuth)      throw new Error("could not discover auth from page scripts");
  if (!queryIds.tweetDetail) throw new Error("could not discover TweetDetail queryId");

  const vars = JSON.stringify({
    focalTweetId: tweet.tweetId,
    referrer: "home",
    count: 20,
    includePromotedContent: true,
    withCommunity: true,
    withQuickPromoteEligibilityTweetFields: true,
    withBirdwatchNotes: true,
    withVoice: true,
  });

  const csrf     = capturedAuth.csrf || document.cookie.match(/ct0=([^;]+)/)?.[1] || "";
  const features = JSON.stringify({
    rweb_tipjar_consumption_enabled: true,
    responsive_web_graphql_exclude_directive_enabled: true,
    verified_phone_label_enabled: false,
    creator_subscriptions_tweet_preview_api_enabled: true,
    responsive_web_graphql_timeline_navigation_enabled: true,
    responsive_web_graphql_skip_user_profile_image_extensions_enabled: false,
    communities_web_enable_tweet_community_results_fetch: true,
    c9s_tweet_anatomy_moderator_badge_enabled: true,
    articles_preview_enabled: true,
    responsive_web_edit_tweet_api_enabled: true,
    graphql_is_translatable_rweb_tweet_is_translatable_enabled: true,
    view_counts_everywhere_api_enabled: true,
    longform_notetweets_consumption_enabled: true,
    responsive_web_twitter_article_tweet_consumption_enabled: true,
    tweet_awards_web_tipping_enabled: false,
    creator_subscriptions_quote_tweet_preview_enabled: false,
    freedom_of_speech_not_reach_the_sky_enabled: true,
    standardized_nudges_misinfo: true,
    tweet_with_visibility_results_prefer_gql_limited_actions_policy_enabled: true,
    rweb_video_timestamps_enabled: true,
    longform_notetweets_rich_text_read_enabled: true,
    longform_notetweets_inline_media_enabled: true,
    responsive_web_enhance_cards_enabled: false,
  });
  const url = `https://x.com/i/api/graphql/${queryIds.tweetDetail}/TweetDetail?variables=${encodeURIComponent(vars)}&features=${encodeURIComponent(features)}`;

  const res = await fetch(url, {
    headers: {
      Authorization:           capturedAuth.auth,
      "x-csrf-token":          csrf,
      "x-twitter-active-user": "yes",
      "x-twitter-auth-type":   "OAuth2Session",
      "content-type":          "application/json",
    },
    credentials: "include",
  });
  if (!res.ok) throw new Error(`API ${res.status}`);
  return res.json();
}

function parseReplies(json, focalId) {
  const results = [];
  try {
    const instructions = json?.data?.threaded_conversation_with_injections_v2?.instructions || [];
    for (const inst of instructions) {
      for (const entry of (inst.entries || [])) {
        if (entry.entryId === `tweet-${focalId}`) continue;
        const r = entry?.content?.itemContent?.tweet_results?.result;
        if (r) pushReply(r, results);
        for (const item of (entry?.content?.items || [])) {
          const r2 = item?.item?.itemContent?.tweet_results?.result;
          if (r2) pushReply(r2, results);
        }
      }
    }
  } catch (_) {}
  return results;
}

// Recursively find the first occurrence of a key in an object tree
function findFirstVal(obj, key, depth) {
  if (!obj || typeof obj !== "object" || depth < 0) return null;
  if (Object.prototype.hasOwnProperty.call(obj, key)) return obj[key];
  for (const v of Object.values(obj)) {
    const found = findFirstVal(v, key, depth - 1);
    if (found) return found;
  }
  return null;
}

function pushReply(result, arr) {
  const tweet = result?.tweet || result;
  const text  = tweet?.legacy?.full_text;
  if (!text) return;

  // Explicit path first; recursive walk as fallback
  let user = tweet?.core?.user_results?.result?.legacy?.screen_name
          || result?.core?.user_results?.result?.legacy?.screen_name;
  if (!user) user = findFirstVal(result, "screen_name", 8);

  arr.push({ handle: user ? `@${user}` : "@anon", text: cleanText(text) });
}

function openCommentViewer(tweet) {
  if (viewerOpen || !tweet || tweet.isFallback || !tweet.tweetId) return;
  viewerOpen = true;
  animPaused = true;

  const backdrop = document.createElement("div");
  backdrop.id = "mx-viewer";

  const box = document.createElement("div");
  box.id = "mx-cmt-box";

  const header = document.createElement("div");
  header.id = "mx-viewer-tweet";
  header.textContent = tweet.text;
  box.appendChild(header);

  const list = document.createElement("div");
  list.id = "mx-cmt-list";
  list.textContent = "loading replies…";
  box.appendChild(list);

  const replyBtn = document.createElement("button");
  replyBtn.id = "mx-cmt-reply-btn";
  replyBtn.textContent = "Reply [R]";
  replyBtn.addEventListener("click", e => {
    e.stopPropagation();
    backdrop.remove();
    commentBackdrop = null;
    viewerOpen = false;
    animPaused = false;
    openComposeBox(tweet);
  });
  box.appendChild(replyBtn);

  // Explicit wheel scroll on the list — stops propagation so the overlay never sees it
  list.addEventListener("wheel", e => {
    e.preventDefault();
    e.stopPropagation();
    list.scrollTop += e.deltaY;
  }, { passive: false });

  box.addEventListener("click", e => e.stopPropagation());
  commentBackdrop = backdrop;
  backdrop.addEventListener("click", () => {
    backdrop.remove();
    commentBackdrop = null;
    viewerOpen = false;
    animPaused = false;
  });

  backdrop.appendChild(box);
  overlay.appendChild(backdrop);

  fetchReplies(tweet).then(json => {
    const replies = parseReplies(json, tweet.tweetId);
    list.textContent = "";
    if (!replies.length) { list.textContent = "no replies found."; return; }
    for (const r of replies) {
      const el  = document.createElement("div");
      el.className = "mx-cmt-reply";
      const hdl = document.createElement("span");
      hdl.className = "mx-cmt-handle";
      hdl.textContent = r.handle + " ";
      el.appendChild(hdl);
      el.appendChild(document.createTextNode(r.text));
      list.appendChild(el);
    }
  }).catch(err => {
    list.textContent = `error: ${err.message}`;
  });
}

// ─── COMPOSE ──────────────────────────────────────────────────────────────────
function openComposeBox(replyToTweet = null) {
  if (viewerOpen) return;
  viewerOpen = true;
  animPaused = true;

  const backdrop = document.createElement("div");
  backdrop.id = "mx-viewer";

  const box = document.createElement("div");
  box.id = "mx-compose-box";

  if (replyToTweet) {
    const ctx = document.createElement("div");
    ctx.id = "mx-viewer-tweet";
    ctx.textContent = "Replying to: " + replyToTweet.text;
    box.appendChild(ctx);
  }

  const area = document.createElement("textarea");
  area.id = "mx-compose-area";
  area.placeholder = replyToTweet ? "Post your reply…" : "What is happening?!";
  area.maxLength = 280;
  box.appendChild(area);

  const footer = document.createElement("div");
  footer.id = "mx-compose-footer";

  const counter = document.createElement("span");
  counter.id = "mx-compose-counter";
  counter.textContent = "280";
  area.addEventListener("input", () => { counter.textContent = 280 - area.value.length; });

  const sendBtn = document.createElement("button");
  sendBtn.id = "mx-compose-send";
  sendBtn.textContent = replyToTweet ? "Reply" : "Post";

  footer.appendChild(counter);
  footer.appendChild(sendBtn);
  box.appendChild(footer);

  const status = document.createElement("div");
  status.id = "mx-compose-status";
  box.appendChild(status);

  const close = () => { backdrop.remove(); viewerOpen = false; animPaused = false; };

  sendBtn.addEventListener("click", async e => {
    e.stopPropagation();
    const text = area.value.trim();
    if (!text) return;
    sendBtn.disabled = true;
    status.textContent = "posting…";
    try {
      await ensureAuth();
      if (!queryIds.createTweet) throw new Error("createTweet queryId not found");
      const vars = {
        tweet_text: text,
        dark_request: false,
        media: { media_ids: [], tagged_users: [] },
        semantic_annotation_ids: [],
      };
      if (replyToTweet) {
        vars.reply = { in_reply_to_tweet_id: replyToTweet.tweetId, exclude_reply_user_ids: [] };
      }
      const createFeatures = {
        communities_web_enable_tweet_community_results_fetch: true,
        c9s_tweet_anatomy_moderator_badge_enabled: true,
        responsive_web_edit_tweet_api_enabled: true,
        graphql_is_translatable_rweb_tweet_is_translatable_enabled: true,
        view_counts_everywhere_api_enabled: true,
        longform_notetweets_consumption_enabled: true,
        responsive_web_twitter_article_tweet_consumption_enabled: true,
        tweet_awards_web_tipping_enabled: false,
        creator_subscriptions_quote_tweet_preview_enabled: false,
        longform_notetweets_rich_text_read_enabled: true,
        longform_notetweets_inline_media_enabled: true,
        articles_preview_enabled: true,
        rweb_video_timestamps_enabled: true,
        rweb_tipjar_consumption_enabled: true,
        responsive_web_graphql_exclude_directive_enabled: true,
        verified_phone_label_enabled: false,
        creator_subscriptions_tweet_preview_api_enabled: true,
        responsive_web_graphql_timeline_navigation_enabled: true,
        responsive_web_graphql_skip_user_profile_image_extensions_enabled: false,
        freedom_of_speech_not_reach_the_sky_enabled: true,
        standardized_nudges_misinfo: true,
        tweet_with_visibility_results_prefer_gql_limited_actions_policy_enabled: true,
        responsive_web_enhance_cards_enabled: false,
      };
      await apiPost(queryIds.createTweet, "CreateTweet", vars, createFeatures);
      status.textContent = replyToTweet ? "Reply posted!" : "Tweet posted!";
      setTimeout(close, 800);
    } catch (err) {
      status.textContent = "error: " + err.message;
      sendBtn.disabled = false;
    }
  });

  box.addEventListener("click", e => e.stopPropagation());
  box.addEventListener("wheel", e => e.stopPropagation(), { passive: true });
  backdrop.addEventListener("click", close);
  box.addEventListener("keydown", e => {
    if (e.key === "Escape") close();
    e.stopPropagation();
  });

  backdrop.appendChild(box);
  overlay.appendChild(backdrop);
  requestAnimationFrame(() => area.focus());
}

// ─── SEARCH ───────────────────────────────────────────────────────────────────
function updateSearchBanner() {
  if (searchBanner) { searchBanner.remove(); searchBanner = null; }
  if (!searchMode) return;
  searchBanner = document.createElement("div");
  searchBanner.id = "mx-search-banner";
  searchBanner.textContent = `SEARCH: ${searchQuery}   [ESC = back to feed]`;
  overlay.appendChild(searchBanner);
}

function parseSearchResults(json) {
  const results = [];
  try {
    const entries = json?.data?.search_by_raw_query?.search_timeline?.timeline
                        ?.instructions?.flatMap(i => i.entries || []) || [];
    for (const entry of entries) {
      const r = entry?.content?.itemContent?.tweet_results?.result;
      if (!r) continue;
      const tweet   = r?.tweet || r;
      const text    = tweet?.legacy?.full_text;
      if (!text) continue;
      const uRes    = tweet?.core?.user_results?.result || r?.core?.user_results?.result;
      let handle    = uRes?.legacy?.screen_name;
      if (!handle) handle = findFirstVal(r, "screen_name", 8);
      const tweetId = tweet?.legacy?.id_str || tweet?.rest_id || null;
      results.push({
        text: truncate(cleanText(`${handle ? "@" + handle : "@?"} · ${text}`), CFG.MAX_TWEET_LEN),
        heat: 1, imageUrl: null, videoUrl: null, tweetId, isFallback: false,
      });
    }
  } catch (_) {}
  return results;
}

// Make a direct GraphQL search call (works once queryIds.searchTimeline is known)
async function fetchSearchDirect(query) {
  const csrf = capturedAuth.csrf || document.cookie.match(/ct0=([^;]+)/)?.[1] || "";
  const vars = JSON.stringify({ rawQuery: query, count: 40, querySource: "typed_query", product: "Latest" });
  const features = JSON.stringify({
    rweb_tipjar_consumption_enabled: true,
    responsive_web_graphql_exclude_directive_enabled: true,
    verified_phone_label_enabled: false,
    creator_subscriptions_tweet_preview_api_enabled: true,
    responsive_web_graphql_timeline_navigation_enabled: true,
    responsive_web_graphql_skip_user_profile_image_extensions_enabled: false,
    communities_web_enable_tweet_community_results_fetch: true,
    articles_preview_enabled: true,
    responsive_web_edit_tweet_api_enabled: true,
    graphql_is_translatable_rweb_tweet_is_translatable_enabled: true,
    view_counts_everywhere_api_enabled: true,
    longform_notetweets_consumption_enabled: true,
    tweet_with_visibility_results_prefer_gql_limited_actions_policy_enabled: true,
    longform_notetweets_rich_text_read_enabled: true,
    responsive_web_enhance_cards_enabled: false,
  });
  const fieldToggles = JSON.stringify({
    withArticleRichContentState: true, withArticlePlainText: false,
    withGrokAnalyze: false, withDisallowedReplyControls: false,
  });
  const url = `https://x.com/i/api/graphql/${queryIds.searchTimeline}/SearchTimeline`
            + `?variables=${encodeURIComponent(vars)}&features=${encodeURIComponent(features)}&fieldToggles=${encodeURIComponent(fieldToggles)}`;
  const res = await fetch(url, {
    headers: {
      Authorization: capturedAuth.auth, "x-csrf-token": csrf,
      "x-twitter-active-user": "yes", "x-twitter-auth-type": "OAuth2Session",
    },
    credentials: "include",
  });
  if (!res.ok) {
    let detail = "";
    try { const j = await res.clone().json(); detail = j?.errors?.[0]?.message || ""; } catch (_) {}
    throw new Error(`API ${res.status}${detail ? ": " + detail : ""}`);
  }
  return res.json();
}

// Navigate X's SPA to /search to trigger its own SearchTimeline call,
// which the interceptor captures and resolves via __mx_srch message.
async function fetchSearch(query) {
  await ensureAuth();

  // Fast path: queryId already captured from a prior X request
  if (queryIds.searchTimeline) return fetchSearchDirect(query);

  // Slow path: trigger X's router to load the search page
  const savedPath = location.pathname + location.search + location.hash;
  return new Promise((resolve, reject) => {
    let settled = false;
    const finish = (fn, arg) => {
      if (settled) return;
      settled = true;
      _searchResolve = null;
      clearTimeout(timer);
      try { history.pushState({}, "", savedPath); } catch (_) {}
      fn(arg);
    };

    _searchResolve = data => finish(resolve, data);

    const timer = setTimeout(() => {
      finish(reject, new Error("search timed out"));
    }, 8000);

    try {
      history.pushState({}, "", `/search?q=${encodeURIComponent(query)}&src=typed_query&f=live`);
      window.dispatchEvent(new PopStateEvent("popstate", { state: null }));
    } catch (err) {
      finish(reject, err);
    }
  });
}

function openSearchBox() {
  if (viewerOpen) return;
  viewerOpen = true;
  animPaused = true;

  const backdrop = document.createElement("div");
  backdrop.id = "mx-viewer";

  const box = document.createElement("div");
  box.id = "mx-compose-box";

  const label = document.createElement("div");
  label.id = "mx-viewer-tweet";
  label.textContent = "Search X  [Enter to search]";
  box.appendChild(label);

  const input = document.createElement("input");
  input.id = "mx-search-input";
  input.type = "text";
  input.placeholder = "Enter search query…";
  box.appendChild(input);

  const status = document.createElement("div");
  status.id = "mx-compose-status";
  box.appendChild(status);

  const close = () => { backdrop.remove(); viewerOpen = false; animPaused = false; };

  const doSearch = async () => {
    const q = input.value.trim();
    if (!q) return;
    status.textContent = "searching…";
    try {
      const json    = await fetchSearch(q);
      const results = parseSearchResults(json);
      if (!results.length) { status.textContent = "no results."; return; }
      if (!searchMode) homeTweets = orderedTweets.slice();
      searchMode  = true;
      searchQuery = q;
      orderedTweets.length = 0;
      orderedTweets.push(...results);
      bandOffset   = 0;
      selectedCard = 0;
      rebuildOffsets();
      updateSearchBanner();
      close();
    } catch (err) {
      status.textContent = "error: " + err.message;
    }
  };

  input.addEventListener("keydown", e => {
    e.stopPropagation();
    if (e.key === "Enter") doSearch();
    if (e.key === "Escape") close();
  });
  box.addEventListener("click", e => e.stopPropagation());
  box.addEventListener("keydown", e => e.stopPropagation());
  backdrop.addEventListener("click", close);

  backdrop.appendChild(box);
  overlay.appendChild(backdrop);
  requestAnimationFrame(() => input.focus());
}

// ─── MEDIA VIEWER ─────────────────────────────────────────────────────────────
function openMediaViewer(url, type, forceHls = false, tweetText = "") {
  if (viewerOpen || !url || url.startsWith("blob:")) return;
  viewerOpen = true;
  animPaused = true;
  overlay.style.cursor = "";

  const backdrop = document.createElement("div");
  backdrop.id    = "mx-viewer";

  const box = document.createElement("div");
  box.id    = "mx-viewer-box";

  const safe    = url.replace(/"/g, "%22");
  const isHls   = forceHls || url.includes(".m3u8");
  const isVideo = type === "video" && !url.includes("pbs.twimg.com");

  if (isHls) {
    const vid    = document.createElement("video");
    vid.id       = "mx-hls-" + Date.now();
    vid.controls = true;
    box.appendChild(vid);
    window.postMessage({ __mx_hls: 1, videoId: vid.id, url }, "*");
  } else if (isVideo) {
    const vid      = document.createElement("video");
    vid.src        = safe;
    vid.autoplay   = true;
    vid.controls   = true;
    vid.loop       = true;
    box.appendChild(vid);
  } else {
    const img = document.createElement("img");
    img.src   = safe;
    img.alt   = "";
    box.appendChild(img);
  }

  if (tweetText) {
    const p       = document.createElement("div");
    p.id          = "mx-viewer-tweet";
    p.textContent = tweetText;
    box.appendChild(p);
  }

  box.addEventListener("click", e => e.stopPropagation());
  backdrop.addEventListener("click", () => {
    backdrop.querySelector("video")?._hls?.destroy();
    backdrop.remove();
    viewerOpen = false;
    animPaused = false;
  });

  backdrop.appendChild(box);
  overlay.appendChild(backdrop);
}


// ─── FULLSCREEN ───────────────────────────────────────────────────────────────
let suppressResize = false;
fsBtn.addEventListener("click", async () => {
  try {
    if (!document.fullscreenElement) await overlay.requestFullscreen();
    else await document.exitFullscreen();
  } catch (_) {}
});
document.addEventListener("fullscreenchange", () => {
  suppressResize = true;
  setTimeout(() => { suppressResize = false; }, 800);
});

// ─── RESIZE ───────────────────────────────────────────────────────────────────
let resizeTimer;
window.addEventListener("resize", () => {
  if (suppressResize) return;
  clearTimeout(resizeTimer);
  resizeTimer = setTimeout(() => {
    W = window.innerWidth; H = window.innerHeight;
    tweetCanvas.width  = W; tweetCanvas.height = H;
    bandOffset = 0;
    initRain();
  }, 200);
});

// ─── BACKGROUND RAIN ──────────────────────────────────────────────────────────
const R_FONT  = '10px "Courier New",monospace';
const R_ROW_H = 16;
let rainRows = [];
let rainTick = 0;
let decoRows = [];

function initDecoRows() {
  decoRows = [];
  const bandY    = Math.floor(H / 2);
  const topEnd   = bandY - Math.floor(BAND_H / 2) - 6;
  const botStart = bandY + Math.floor(BAND_H / 2) + 6;

  const TIMESTAMPS = ["2m", "4m", "11m", "23m", "1h", "2h", "6h", "14h", "just now"];

  function randWord(len) {
    const l = len || (2 + Math.floor(Math.random() * 8));
    let w = "";
    for (let i = 0; i < l; i++) w += GLYPHS[Math.floor(Math.random() * GLYPHS.length)];
    return w;
  }

  function makeDecoText() {
    const rt     = Math.random() < 0.18 ? "RT " : "";
    const handle = "@" + randWord(3 + Math.floor(Math.random() * 7));
    const ts     = TIMESTAMPS[Math.floor(Math.random() * TIMESTAMPS.length)];

    // Body — 5-12 glyph words, each 2-9 chars, space-separated like real tweet words
    const wCount = 5 + Math.floor(Math.random() * 8);
    const words  = [];
    for (let i = 0; i < wCount; i++) words.push(randWord());

    // Sprinkle a hashtag roughly 1 in 3 tweets
    if (Math.random() < 0.33) {
      const pos = 1 + Math.floor(Math.random() * (words.length - 1));
      words.splice(pos, 0, "#" + randWord(2 + Math.floor(Math.random() * 6)));
    }

    const body = words.join(" ");

    // Engagement metrics at the end — makes it look like a real tweet row
    const likes = Math.random() < 0.5
      ? `  ${(Math.floor(Math.random() * 9000) + 10).toLocaleString()} ♥` : "";
    const rts   = Math.random() < 0.35
      ? `  ${(Math.floor(Math.random() * 999) + 1)} ↺` : "";
    const tag   = Math.random() < 0.11 ? " [VIDEO]"
                : Math.random() < 0.09 ? " [IMAGE]" : "";

    return `${rt}${handle} · ${body} · ${ts}${likes}${rts}${tag}   `;
  }

  function addRow(y) {
    const speed     = 0.15 + Math.random() * 2.0;  // wide random spread
    const alpha     = 0.55 + Math.random() * 0.42;  // near-full brightness, like center row
    const heatIdx   = Math.ceil(Math.random() * 4);
    const text      = makeDecoText();
    const textWidth = Math.max(1, measureWidth(text));
    decoRows.push({ y, offset: Math.random() * textWidth, speed, text, textWidth, heat: heatIdx, alpha });
  }

  let r = 0;
  for (let y = topEnd - Math.floor(LINE_H / 2); y > LINE_H; y -= LINE_H) {
    addRow(y);
    if (++r > 50) break;
  }
  r = 0;
  for (let y = botStart + LINE_H; y < H - LINE_H / 2; y += LINE_H) {
    addRow(y);
    if (++r > 50) break;
  }
}

function initRain() {
  rainCanvas.width  = W;
  rainCanvas.height = H;
  const n = Math.ceil(H / R_ROW_H);
  rainRows = Array.from({ length: n }, () => ({
    x: Math.random() * W, speed: 1.0 + Math.random() * 1.4,
  }));
  rainCtx.fillStyle = "#000";
  rainCtx.fillRect(0, 0, W, H);
  initDecoRows();
}

function animateRain() {
  rainTick++;
  if (rainTick % 2 === 0) {
    rainCtx.fillStyle = "rgba(0,0,0,0.1)";
    rainCtx.fillRect(0, 0, W, H);
    rainCtx.font = R_FONT;
    for (let i = 0; i < rainRows.length; i++) {
      const row = rainRows[i];
      rainCtx.fillStyle = "rgba(0,210,65,0.65)";
      rainCtx.fillText(randGlyph(), row.x, (i + 1) * R_ROW_H);
      row.x -= row.speed;
      if (row.x < -16 && Math.random() > 0.97) {
        row.x     = W + Math.floor(Math.random() * 300);
        row.speed = 1.0 + Math.random() * 1.4;
      }
    }
  }
  requestAnimationFrame(animateRain);
}

// ─── MUTATION OBSERVER ────────────────────────────────────────────────────────
let mutTimer = null;
const observer = new MutationObserver(() => {
  clearTimeout(mutTimer);
  mutTimer = setTimeout(scrapeAndUpdate, 800);
});

let observedRoot = null;
function startObserver() {
  const root = document.querySelector('[data-testid="primaryColumn"]');
  if (!root) { setTimeout(startObserver, 1000); return; }
  observedRoot = root;
  observer.observe(root, { childList: true, subtree: true });
}

// Re-attach observer if React remounts the timeline (happens on navigation)
setInterval(() => {
  const root = document.querySelector('[data-testid="primaryColumn"]');
  if (root && root !== observedRoot) {
    observer.disconnect();
    observedRoot = root;
    observer.observe(root, { childList: true, subtree: true });
  }
  // Periodic safety scrape in case the observer missed something
  scrapeAndUpdate();
}, 3000);

// ─── INIT ─────────────────────────────────────────────────────────────────────
W = window.innerWidth;
H = window.innerHeight;
tweetCanvas.width  = W;
tweetCanvas.height = H;
tweetCtx.font      = TWEET_FONT;
monoW              = tweetCtx.measureText("M").width;

// Exact pixel width — far more accurate than length * monoW for mixed Unicode/emoji
function measureWidth(text) {
  tweetCtx.font = TWEET_FONT;
  return tweetCtx.measureText(text).width;
}

// Truncate text to fit maxPx, always preserving trailing [VIDEO]/[IMAGE] tag
function fitText(text, maxPx) {
  if (measureWidth(text) <= maxPx) return text;
  const tagM = text.match(/( \[(?:VIDEO|IMAGE)\])$/);
  const tag  = tagM ? tagM[1] : "";
  const base = tag ? text.slice(0, -tag.length) : text;
  const tail = "…" + tag;
  const tailW = measureWidth(tail);
  let s = base;
  while (s.length > 0 && measureWidth(s) + tailW > maxPx) s = s.slice(0, -1);
  return s + tail;
}

function wrapText(text, maxWidth) {
  const words = text.split(" ");
  const lines = [];
  let line = "";
  for (const word of words) {
    const test = line ? line + " " + word : word;
    if (measureWidth(test) > maxWidth && line) {
      lines.push(line);
      line = word;
    } else {
      line = test;
    }
  }
  if (line) lines.push(line);
  return lines.slice(0, 4);
}

selectedCard = 0;
bandOffset   = 0;
discoverFromScripts();
startObserver();
requestAnimationFrame(animate);
initRain();
requestAnimationFrame(animateRain);

// Retry scraping every 500ms until tweets appear (X.com SPA renders asynchronously)
let scrapeRetries = 0;
function initialScrape() {
  scrapeAndUpdate();
  if (orderedTweets.length === 0 && scrapeRetries < 40) {
    scrapeRetries++;
    setTimeout(initialScrape, 500);
  }
}
initialScrape();
