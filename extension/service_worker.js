// Background service worker for Ticket Extractor

const STORAGE_KEY = 'alsoJson';

async function getAlsoJsonPreference() {
  try {
    const res = await browser.storage.local.get(STORAGE_KEY);
    return Boolean(res[STORAGE_KEY]);
  } catch (e) {
    return false;
  }
}

async function setAlsoJsonPreference(value) {
  try {
    await browser.storage.local.set({ [STORAGE_KEY]: Boolean(value) });
  } catch (e) { }
}

async function runOnActiveTab({ alsoJson }) {
  const tabs = await browser.tabs.query({ active: true, currentWindow: true });
  const tab = tabs[0];
  if (!tab || !tab.id) throw new Error('No active tab');

  // Execute content script and pass args
  try {
    const [{ result }] = await browser.scripting.executeScript({
      target: { tabId: tab.id },
      func: extractAndCopy,
      args: [{ alsoJson }]
    });

    if (result && result.ok && alsoJson && result.json) {
      const filename = result.filename || `ticket-${Date.now()}.json`;
      const blobUrl = URL.createObjectURL(new Blob([JSON.stringify(result.json, null, 2)], { type: 'application/json' }));
      await browser.downloads.download({ url: blobUrl, filename, saveAs: false });
    }
    return result;
  } catch (e) {
    return { ok: false, error: e?.message || String(e) };
  }
}

// Receives messages from popup
browser.runtime.onMessage.addListener(async (msg, sender) => {
  if (msg && msg.type === 'RUN_EXTRACTION') {
    if (typeof msg.alsoJson === 'boolean') await setAlsoJsonPreference(msg.alsoJson);
    const alsoJson = typeof msg.alsoJson === 'boolean' ? msg.alsoJson : await getAlsoJsonPreference();
    const res = await runOnActiveTab({ alsoJson });
    return res;
  }
});

// Helper: The function injected into the page
function extractAndCopy({ alsoJson }) {
  function textFromNode(node) {
    if (!node) return "";
    const clone = node.cloneNode(true);

    // Remove UI/irrelevant elements
    clone.querySelectorAll('.dropdown, .article-meta-links, .js-signatureMarker ~ *').forEach(n => n.remove());

    // Remove quoted header blocks
    const quotedHeaderSelectors = ["p", "div"];
    const headerStarts = [/^\s*Von:/i, /^\s*From:/i, /^\s*Gesendet:/i, /^\s*An:/i, /^\s*Betreff:/i];
    for (const sel of quotedHeaderSelectors) {
      clone.querySelectorAll(sel).forEach(el => {
        const t = (el.textContent || "").trim();
        if (headerStarts.some(rx => rx.test(t))) {
          let cur = el;
          while (cur) {
            const next = cur.nextSibling;
            cur.remove();
            if (!next) break;
            const isBlank = (next.nodeType === 3 && !next.textContent.trim()) ||
              (next.nodeType === 1 && ["P", "DIV", "BR"].includes(next.nodeName) && !(next.textContent || "").trim());
            if (isBlank) {
              next.remove();
              break;
            }
            cur = next;
          }
        }
      });
    }

    // Convert links to "text (URL)"
    clone.querySelectorAll('a[href]').forEach(a => {
      const url = a.getAttribute('href');
      const text = a.textContent.trim();
      const rep = document.createTextNode(text ? `${text} (${url})` : url);
      a.replaceWith(rep);
    });

    // Replace images with a stub
    clone.querySelectorAll('img').forEach(img => {
      const src = img.getAttribute('src') || '';
      const alt = img.getAttribute('alt') || '';
      const label = alt || src.split('/').pop() || src;
      img.replaceWith(document.createTextNode(`[image: ${label}]`));
    });

    // Normalize block spacing
    clone.querySelectorAll('br').forEach(br => br.replaceWith(document.createTextNode('\n')));
    const blockTags = ['P', 'DIV', 'LI', 'H1', 'H2', 'H3', 'H4', 'H5', 'H6'];
    clone.querySelectorAll(blockTags.join(',')).forEach(el => {
      if (!el.childNodes.length || (el.textContent || '').trim().length === 0) return;
      el.appendChild(document.createTextNode('\n'));
    });

    let txt = clone.textContent || "";

    // Truncate at farewell markers near end
    const farewellMarkers = [
      /^\s*Grüße[^\S\r\n]*[A-ZÄÖÜa-zäöüß].*$/m,
      /^\s*Viele Grüße.*$/m,
      /^\s*Mit freundlichen Grüßen.*$/m,
      /^\s*Best regards.*$/m,
      /^\s*Kind regards.*$/m
    ];
    for (const rx of farewellMarkers) {
      const m = txt.match(rx);
      if (m && m.index !== undefined) {
        txt = txt.slice(0, m.index).trimEnd();
        break;
      }
    }

    // Collapse whitespace
    txt = txt.replace(/\u00a0/g, ' ');
    txt = txt.replace(/[ \t]+\n/g, '\n');
    txt = txt.replace(/\n{3,}/g, '\n\n');
    return txt.trim();
  }

  // Expand folded content and remove fixed heights
  document.querySelectorAll('.js-toggleFold').forEach(btn => { try { btn.click(); } catch (e) { } });
  document.querySelectorAll('.textBubble-content[style*="height"]').forEach(el => { el.style.removeProperty('height'); });

  const ticketRoot = document.querySelector('.ticketZoom');
  if (!ticketRoot) return { ok: false, error: 'No .ticketZoom found' };

  const title = (ticketRoot.querySelector('.js-objectTitle') || {}).textContent?.trim() || '';
  const number = ticketRoot.querySelector('.js-objectNumber')?.getAttribute('data-number')?.replace(/^Ticket#/, '') ||
    (ticketRoot.querySelector('.js-objectNumber') || {}).textContent?.trim() || '';

  function getArticleDate(article) {
    const linkTime = article.parentElement?.querySelector('a small .humanTimeFromNow[datetime]') ||
      article.querySelector('.humanTimeFromNow[datetime]');
    const dt = linkTime?.getAttribute('datetime');
    try { return dt ? new Date(dt).toISOString() : ''; } catch { return ''; }
  }

  function getAuthor(article) {
    const metaRows = article.querySelectorAll('.article-content-meta .article-meta-row');
    for (const row of metaRows) {
      if (/From/i.test(row.textContent || '')) {
        const val = row.querySelector('.article-meta-value')?.textContent || '';
        const emailMatch = val.match(/<([^>]+)>/);
        const name = val.replace(/\s*<[^>]+>\s*/g, '').trim();
        const email = emailMatch ? emailMatch[1].trim() : '';
        return { name, email };
      }
    }
    const avatar = article.querySelector('.js-avatar [title]');
    const name = avatar?.getAttribute('title')?.trim() || (article.classList.contains('agent') ? 'Agent' : 'Customer');
    return { name, email: '' };
  }

  const messages = [];
  document.querySelectorAll('.ticket-article-item').forEach(article => {
    const role = article.classList.contains('agent') ? 'agent' : 'customer';
    const contentEl = article.querySelector('.textBubble-content .richtext-content') ||
      article.querySelector('.textBubble-content');
    if (!contentEl) return;
    const text = textFromNode(contentEl);
    if (!text) return;

    const { name, email } = getAuthor(article);
    const dateIso = getArticleDate(article);

    messages.push({
      authorName: name,
      authorEmail: email,
      role,
      date: dateIso,
      contentText: text
    });
  });

  const transcript = messages.map(m => {
    const d = m.date ? new Date(m.date) : null;
    const local = d ? `${d.getFullYear()}-${String(d.getMonth() + 1).padStart(2, '0')}-${String(d.getDate()).padStart(2, '0')} ${String(d.getHours()).padStart(2, '0')}:${String(d.getMinutes()).padStart(2, '0')}` : '';
    return `mail: ${m.authorName}\ndate: ${local}\ncontent:\n${m.contentText}`;
  }).join('\n\n');

  return (async () => {
    try {
      await navigator.clipboard.writeText(transcript);
    } catch (e) {
      // ignore clipboard error but still proceed
    }
    const now = new Date();
    const ts = `${now.getFullYear()}${String(now.getMonth() + 1).padStart(2, '0')}${String(now.getDate()).padStart(2, '0')}-${String(now.getHours()).padStart(2, '0')}${String(now.getMinutes()).padStart(2, '0')}`;
    const filename = `ticket-${number || 'unknown'}-${ts}.json`;
    const json = {
      ticketNumber: number || '',
      ticketTitle: title || '',
      url: location.href,
      exportedAt: new Date().toISOString(),
      messages
    };
    return { ok: true, transcript, json: alsoJson ? json : undefined, filename };
  })();
}


