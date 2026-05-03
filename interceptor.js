(function () {
  if (window.__mxHooked) return;
  window.__mxHooked = true;

  const TARGET   = /HomeTimeline|HomeLatestTimeline|TweetDetail|SearchTimeline|UserTweets/i;
  const GQL_RE   = /\/graphql\/([^/?#]+)\/(\w+)/;

  function extractVideos(data) {
    try {
      const videos = {};
      const m3u8s  = {};
      const seen   = new WeakSet();

      function walk(o, d) {
        if (!o || typeof o !== "object" || d > 25 || seen.has(o)) return;
        seen.add(o);
        const id    = o.rest_id || o.id_str;
        const media = (o.legacy?.extended_entities?.media || o.extended_entities?.media || []);
        media.forEach(m => {
          if ((m.type === "video" || m.type === "animated_gif") && id) {
            const variants = m.video_info?.variants || [];
            let best = null, m3u8 = null;
            variants.forEach(v => {
              if (v.content_type === "video/mp4") {
                if (!best || (v.bitrate || 0) > (best.bitrate || 0)) best = v;
              }
              if (v.content_type === "application/x-mpegURL") m3u8 = v.url;
            });
            if (best)      videos[id] = best.url;
            else if (m3u8) videos[id] = m3u8;
            if (m3u8)      m3u8s[id]  = m3u8;
          }
        });
        (Array.isArray(o) ? o : Object.values(o)).forEach(v => {
          if (v && typeof v === "object") walk(v, d + 1);
        });
      }

      walk(data, 0);
      if (Object.keys(videos).length || Object.keys(m3u8s).length) {
        window.postMessage({ __mx_videos: 1, videos, m3u8s }, "*");
      }
    } catch (_) {}
  }

  function handleResponse(url, data) {
    extractVideos(data);
    // Forward SearchTimeline results to content script
    if (/SearchTimeline/.test(url)) {
      window.postMessage({ __mx_srch: 1, data }, "*");
    }
    // Capture queryId from every GraphQL URL so content script can reuse it
    const m = url.match(GQL_RE);
    if (m) window.postMessage({ __mx_qid: 1, id: m[1], op: m[2] }, "*");
  }

  // Hook fetch
  const origFetch = window.fetch;
  window.fetch = async function (...a) {
    const res = await origFetch.apply(this, a);
    try {
      const url = typeof a[0] === "string" ? a[0] : (a[0]?.url || "");
      if (TARGET.test(url)) {
        res.clone().json().then(data => handleResponse(url, data)).catch(() => {});
      } else {
        const m = url.match(GQL_RE);
        if (m) window.postMessage({ __mx_qid: 1, id: m[1], op: m[2] }, "*");
      }
    } catch (_) {}
    return res;
  };

  // Hook XHR
  const OrigXHR = window.XMLHttpRequest;
  function HookedXHR() {
    const xhr = new OrigXHR();
    let trackedUrl = "";
    const origOpen = xhr.open.bind(xhr);
    xhr.open = function (method, url, ...rest) {
      trackedUrl = url || "";
      return origOpen(method, url, ...rest);
    };
    xhr.addEventListener("load", function () {
      if (!TARGET.test(trackedUrl)) return;
      try { handleResponse(trackedUrl, JSON.parse(xhr.responseText)); } catch (_) {}
    });
    return xhr;
  }
  HookedXHR.prototype = OrigXHR.prototype;
  window.XMLHttpRequest = HookedXHR;
})();
