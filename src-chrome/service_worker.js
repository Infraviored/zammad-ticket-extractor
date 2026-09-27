// Chrome MV3 service worker. Same job as src/background.js (Firefox MV2), but
// Chrome forbids injecting code strings, so the extraction function itself is
// passed to chrome.scripting.executeScript, which also awaits its promise.
importScripts('extract.js');

async function runOnActiveTab(options = {}) {
  const runtimeOptions = {
    copyFormat: options.copyFormat || 'json',
    anonymize: Boolean(options.anonymize),
    downloadJson: Boolean(options.downloadJson)
  };
  const [tab] = await chrome.tabs.query({ active: true, currentWindow: true });
  if (!tab || !tab.id) return { ok: false, error: 'No active tab' };

  let result;
  try {
    const [injection] = await chrome.scripting.executeScript({
      target: { tabId: tab.id },
      func: extractAndCopy,
      args: [runtimeOptions]
    });
    result = injection && injection.result;
  } catch (e) {
    return { ok: false, error: e?.message || String(e) };
  }
  if (!result || !result.ok) return result || { ok: false, error: 'No result returned' };

  let downloadedJson = false;
  if (runtimeOptions.downloadJson && result.json) {
    try {
      // no URL.createObjectURL in a service worker; a ticket's JSON stays far below the 2 MB data: URL cap
      const url = 'data:application/json;charset=utf-8,' + encodeURIComponent(JSON.stringify(result.json, null, 2));
      await chrome.downloads.download({ url, filename: result.filename || `ticket-${Date.now()}.json`, saveAs: false });
      downloadedJson = true;
    } catch (e) {
      console.error('[SW] Failed to download JSON:', e);
    }
  }

  const parts = [result.copied ? `Copied ${runtimeOptions.copyFormat === 'json' ? 'JSON' : 'text'} to clipboard` : 'Failed to copy to clipboard'];
  if (downloadedJson) parts.push('JSON downloaded');
  else if (runtimeOptions.downloadJson) parts.push('JSON download failed');
  return { ...result, downloadedJson, message: result.message || parts.join('. ') };
}

// Chrome ignores promises returned from onMessage listeners: answer via sendResponse.
chrome.runtime.onMessage.addListener((msg, sender, sendResponse) => {
  if (msg && msg.type === 'RUN_EXTRACTION') {
    runOnActiveTab(msg.options || {}).then(sendResponse, e => sendResponse({ ok: false, error: e?.message || String(e) }));
    return true;
  }
});
