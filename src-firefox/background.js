// MV2 background script (persistent) for Ticket Extractor

async function runOnActiveTab(options = {}) {
  const runtimeOptions = {
    copyFormat: options.copyFormat || 'json',
    anonymize: Boolean(options.anonymize),
    downloadJson: Boolean(options.downloadJson)
  };

  console.log('[BG] Starting extraction with options:', runtimeOptions);
  const tabs = await browser.tabs.query({ active: true, currentWindow: true });
  const tab = tabs[0];
  if (!tab || !tab.id) {
    console.error('[BG] No active tab found');
    throw new Error('No active tab');
  }
  console.log('[BG] Tab found:', tab.id, tab.url);

  try {
    console.log('[BG] Injecting script...');
    const extractCode = extractAndCopy.toString();
    console.log('[BG] Extract function length:', extractCode.length);

    // Use message passing to get the result since executeScript doesn't properly await Promises in MV2
    return new Promise((resolve) => {
      // Set up one-time listener for the result
      const listener = (msg) => {
        if (msg && msg.type === 'EXTRACTION_RESULT') {
          browser.runtime.onMessage.removeListener(listener);
          console.log('[BG] Received result via message:', msg.result);

          if (msg.result && msg.result.ok) {
            (async () => {
              let downloadedJson = false;
              if (runtimeOptions.downloadJson && msg.result.json) {
                try {
                  const filename = msg.result.filename || `ticket-${Date.now()}.json`;
                  const jsonPayload = JSON.stringify(msg.result.json, null, 2);
                  const blobUrl = URL.createObjectURL(new Blob([jsonPayload], { type: 'application/json' }));
                  await browser.downloads.download({ url: blobUrl, filename, saveAs: false });
                  downloadedJson = true;
                  console.log('[BG] JSON downloaded:', filename);
                  setTimeout(() => URL.revokeObjectURL(blobUrl), 10_000);
                } catch (downloadError) {
                  console.error('[BG] Failed to download JSON:', downloadError);
                }
              }

              const messageParts = [];
              if (msg.result.copied) {
                messageParts.push(`Copied ${runtimeOptions.copyFormat === 'json' ? 'JSON' : 'text'} to clipboard`);
              } else {
                messageParts.push('Failed to copy to clipboard');
              }
              if (downloadedJson) {
                messageParts.push('JSON downloaded');
              } else if (runtimeOptions.downloadJson) {
                messageParts.push('JSON download failed');
              }

              resolve({
                ...msg.result,
                downloadedJson,
                message: msg.result.message || messageParts.filter(Boolean).join('. ')
              });
            })();
          } else {
            resolve(msg.result || { ok: false, error: 'No result returned' });
          }
        }
      };

      browser.runtime.onMessage.addListener(listener);

      // Inject script that sends message back
      browser.tabs.executeScript(tab.id, {
        code: `
          (async function() {
            console.log('[INJECTED] Script starting...');
            try {
              ${extractCode}
              
              const injectedOptions = ${JSON.stringify(runtimeOptions)};
              console.log('[INJECTED] Calling extractAndCopy with options:', injectedOptions);
              const result = await extractAndCopy(injectedOptions);
              console.log('[INJECTED] ExtractAndCopy returned:', result);
              
              // Send result back via message
              browser.runtime.sendMessage({
                type: 'EXTRACTION_RESULT',
                result: result
              });
            } catch (e) {
              console.error('[INJECTED] Extraction error:', e);
              browser.runtime.sendMessage({
                type: 'EXTRACTION_RESULT',
                result: { 
                  ok: false, 
                  error: e?.message || String(e), 
                  stack: e?.stack,
                  name: e?.name
                }
              });
            }
          })();
        `
      }).catch((e) => {
        browser.runtime.onMessage.removeListener(listener);
        console.error('[BG] Failed to inject script:', e);
        resolve({ ok: false, error: e?.message || String(e) });
      });
    });
  } catch (e) {
    console.error('[BG] Background script error:', e);
    console.error('[BG] Error stack:', e?.stack);
    console.error('[BG] Error name:', e?.name);
    return { ok: false, error: e?.message || String(e), stack: e?.stack, name: e?.name };
  }
}

browser.runtime.onMessage.addListener((msg) => {
  if (msg && msg.type === 'RUN_EXTRACTION') {
    return runOnActiveTab(msg.options || {});
  }
});
