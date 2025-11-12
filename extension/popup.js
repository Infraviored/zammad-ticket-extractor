function setStatus(msg, isError = false) {
  const el = document.getElementById('status');
  if (el) {
    const hasMessage = Boolean(msg);
    el.textContent = hasMessage ? msg : '';
    el.classList.remove('error', 'success');
    if (isError) {
      el.classList.add('error');
    } else if (hasMessage && msg.includes('Copied')) {
      el.classList.add('success');
    }
    el.classList.toggle('hidden', !hasMessage);
  }
}

const DEFAULT_SETTINGS = {
  copyFormat: 'json',
  anonymize: false
};

let currentSettings = { ...DEFAULT_SETTINGS };

async function loadSettings() {
  try {
    const stored = await browser.storage.local.get('ticketExtractorSettings');
    const saved = stored?.ticketExtractorSettings;
    if (saved && typeof saved === 'object') {
      currentSettings = { ...DEFAULT_SETTINGS, ...saved };
    } else {
      currentSettings = { ...DEFAULT_SETTINGS };
    }
  } catch (error) {
    console.error('Failed to load settings:', error);
    currentSettings = { ...DEFAULT_SETTINGS };
  }
  return currentSettings;
}

async function saveSettings() {
  try {
    await browser.storage.local.set({ ticketExtractorSettings: currentSettings });
  } catch (error) {
    console.error('Failed to save settings:', error);
  }
}

async function runExtraction({ downloadJson }) {
  setStatus('Running…');
  try {
    const res = await browser.runtime.sendMessage({
      type: 'RUN_EXTRACTION',
      options: {
        ...currentSettings,
        downloadJson: Boolean(downloadJson)
      }
    });
    if (!res || !res.ok) {
      const errorMsg = res?.error || res?.message || 'unknown error';
      setStatus(`Failed: ${errorMsg}`, true);
      console.error('Extension error:', res);
      return false;
    }
    const msg = res?.message || `Copied ${currentSettings.copyFormat === 'json' ? 'JSON' : 'text'} to clipboard.` + (downloadJson ? ' JSON downloaded.' : '');
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
  const copyFormatSelect = document.getElementById('copyFormat');
  const anonymizeToggle = document.getElementById('anonymizeToggle');

  setStatus('');

  await loadSettings();

  if (copyFormatSelect) {
    copyFormatSelect.value = currentSettings.copyFormat;
    copyFormatSelect.addEventListener('change', async (event) => {
      currentSettings.copyFormat = event.target.value;
      await saveSettings();
    });
  }

  if (anonymizeToggle) {
    anonymizeToggle.checked = Boolean(currentSettings.anonymize);
    anonymizeToggle.addEventListener('change', async (event) => {
      currentSettings.anonymize = event.target.checked;
      await saveSettings();
    });
  }

  let isRunning = false;

  copyBtn.addEventListener('click', async () => {
    if (isRunning) return;
    isRunning = true;
    copyBtn.disabled = true;
    downloadJsonBtn.disabled = true;

    await runExtraction({ downloadJson: false });

    isRunning = false;
    copyBtn.disabled = false;
    downloadJsonBtn.disabled = false;
  });

  downloadJsonBtn.addEventListener('click', async () => {
    if (isRunning) return;
    isRunning = true;
    copyBtn.disabled = true;
    downloadJsonBtn.disabled = true;

    await runExtraction({ downloadJson: true });

    isRunning = false;
    copyBtn.disabled = false;
    downloadJsonBtn.disabled = false;
  });
});
