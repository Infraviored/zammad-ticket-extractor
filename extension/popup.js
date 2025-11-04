function setStatus(msg, isError = false) {
  const el = document.getElementById('status');
  if (el) {
    el.textContent = msg || '';
    el.className = isError ? 'error' : (msg && msg.includes('Copied') ? 'success' : '');
  }
}

async function runExtraction(alsoJson) {
  setStatus('Running…');
  try {
    const res = await browser.runtime.sendMessage({ type: 'RUN_EXTRACTION', alsoJson });
    if (!res || !res.ok) {
      const errorMsg = res?.error || res?.message || 'unknown error';
      setStatus(`Failed: ${errorMsg}`, true);
      console.error('Extension error:', res);
      return false;
    }
    const msg = res?.message || 'Copied to clipboard.' + (alsoJson ? ' JSON downloaded.' : '');
    setStatus(msg, false);
    return true;
  } catch (e) {
    setStatus(`Failed: ${e?.message || String(e)}`, true);
    console.error('Popup error:', e);
    return false;
  }
}

document.addEventListener('DOMContentLoaded', async () => {
  const copyBtn = document.getElementById('copyBtn');
  const downloadJsonBtn = document.getElementById('downloadJsonBtn');
  
  let isRunning = false;
  
  copyBtn.addEventListener('click', async () => {
    if (isRunning) return;
    isRunning = true;
    copyBtn.disabled = true;
    downloadJsonBtn.disabled = true;
    
    const success = await runExtraction(false);
    
    isRunning = false;
    copyBtn.disabled = false;
    downloadJsonBtn.disabled = false;
  });
  
  downloadJsonBtn.addEventListener('click', async () => {
    if (isRunning) return;
    isRunning = true;
    copyBtn.disabled = true;
    downloadJsonBtn.disabled = true;
    
    const success = await runExtraction(true);
    
    isRunning = false;
    copyBtn.disabled = false;
    downloadJsonBtn.disabled = false;
  });
});
