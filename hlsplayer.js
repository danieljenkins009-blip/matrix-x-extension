(function () {
  window.addEventListener("message", e => {
    if (e.source !== window || !e.data?.__mx_hls) return;
    const { videoId, url } = e.data;
    const vid = document.getElementById(videoId);
    if (!vid) return;

    if (typeof Hls !== "undefined" && Hls.isSupported()) {
      const hls = new Hls();
      hls.loadSource(url);
      hls.attachMedia(vid);
      hls.on(Hls.Events.MANIFEST_PARSED, () => vid.play().catch(() => {}));
      vid._hls = hls;
    } else {
      // Safari supports HLS natively via src
      vid.src = url;
      vid.play().catch(() => {});
    }
  });
})();
