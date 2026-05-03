function injectMainScripts(tabId) {
  chrome.scripting.executeScript({ target: { tabId }, world: "MAIN", files: ["hls.min.js"]      }).catch(() => {});
  chrome.scripting.executeScript({ target: { tabId }, world: "MAIN", files: ["interceptor.js"]  }).catch(() => {});
  chrome.scripting.executeScript({ target: { tabId }, world: "MAIN", files: ["hlsplayer.js"]    }).catch(() => {});
}

// Inject into any X tab that loads or navigates
chrome.tabs.onUpdated.addListener((tabId, changeInfo, tab) => {
  if (changeInfo.status === "loading" && tab.url && /https:\/\/(x|twitter)\.com/.test(tab.url)) {
    injectMainScripts(tabId);
  }
});

// Re-inject into already-open X tabs when the extension starts / reloads
chrome.runtime.onStartup.addListener(() => {
  chrome.tabs.query({ url: ["https://x.com/*", "https://twitter.com/*"] }, tabs => {
    tabs.forEach(tab => injectMainScripts(tab.id));
  });
});

chrome.runtime.onInstalled.addListener(() => {
  chrome.tabs.query({ url: ["https://x.com/*", "https://twitter.com/*"] }, tabs => {
    tabs.forEach(tab => injectMainScripts(tab.id));
  });
});
