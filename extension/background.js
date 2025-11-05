// MV2 background script (persistent) for Ticket Extractor

async function runOnActiveTab({ alsoJson }) {
  console.log('[BG] Starting extraction, alsoJson:', alsoJson);
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
            if (alsoJson && msg.result.json) {
              const filename = msg.result.filename || `ticket-${Date.now()}.json`;
              const blobUrl = URL.createObjectURL(new Blob([JSON.stringify(msg.result.json, null, 2)], { type: 'application/json' }));
              browser.downloads.download({ url: blobUrl, filename, saveAs: false }).then(() => {
                console.log('[BG] JSON downloaded:', filename);
              });
            }
            resolve({
              ...msg.result,
              message: msg.result.copied ? 'Copied to clipboard' + (alsoJson ? ' and JSON downloaded' : '') : 'Failed to copy to clipboard'
            });
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
              
              console.log('[INJECTED] Calling extractAndCopy with alsoJson=${alsoJson}...');
              const result = await extractAndCopy({ alsoJson: ${alsoJson} });
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

browser.runtime.onMessage.addListener(async (msg, sender, sendResponse) => {
  if (msg && msg.type === 'RUN_EXTRACTION') {
    const alsoJson = typeof msg.alsoJson === 'boolean' ? msg.alsoJson : false;
    const res = await runOnActiveTab({ alsoJson });
    return res;
  }
});

// Function executed in the page context
async function extractAndCopy({ alsoJson }) {
  console.log('[EXTRACT] Starting extraction, alsoJson:', alsoJson);

  function textFromNode(node) {
    if (!node) return "";
    const clone = node.cloneNode(true);

    // Remove UI/irrelevant elements
    clone.querySelectorAll('.dropdown, .article-meta-links').forEach(n => n.remove());

    // Remove everything after signature marker
    const signatureMarker = clone.querySelector('.js-signatureMarker');
    if (signatureMarker) {
      let node = signatureMarker.nextSibling;
      while (node) {
        const next = node.nextSibling;
        node.remove();
        node = next;
      }
      signatureMarker.remove();
    }

    // Remove quoted header blocks (Von:/From:/Gesendet:/An:/Betreff:)
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

    clone.querySelectorAll('a[href]').forEach(a => {
      const url = a.getAttribute('href');
      const text = a.textContent.trim();
      const rep = document.createTextNode(text ? `${text} (${url})` : url);
      a.replaceWith(rep);
    });

    clone.querySelectorAll('img').forEach(img => {
      const src = img.getAttribute('src') || '';
      const alt = img.getAttribute('alt') || '';
      const label = alt || src.split('/').pop() || src;
      img.replaceWith(document.createTextNode(`[image: ${label}]`));
    });

    clone.querySelectorAll('br').forEach(br => br.replaceWith(document.createTextNode('\n')));
    // Only add newlines after block elements that are direct children of richtext-content
    // Avoid adding newlines after nested divs (like code blocks)
    const blockTags = ['P', 'LI', 'H1', 'H2', 'H3', 'H4', 'H5', 'H6'];
    clone.querySelectorAll(blockTags.join(',')).forEach(el => {
      if (!el.childNodes.length || (el.textContent || '').trim().length === 0) return;
      el.appendChild(document.createTextNode('\n'));
    });
    // For DIVs, only add newline if it's a top-level block (not nested in another div)
    clone.querySelectorAll('DIV').forEach(el => {
      if (!el.childNodes.length || (el.textContent || '').trim().length === 0) return;
      // Only add newline if parent is not a DIV or is the root richtext-content
      const parent = el.parentElement;
      if (!parent || parent.tagName !== 'DIV' || parent.classList.contains('richtext-content')) {
        el.appendChild(document.createTextNode('\n'));
      }
    });

    let txt = clone.textContent || "";

    // Truncate at farewell markers - stop before signatures
    const farewellPatterns = [
      /(?:^|\n)\s*Grüße[^\S\r\n]*[A-ZÄÖÜa-zäöüß][^\n]*(?:\n|$)/i,
      /(?:^|\n)\s*Viele Grüße[^\n]*(?:\n|$)/i,
      /(?:^|\n)\s*Mit freundlichen Grüßen[^\n]*(?:\n|$)/i,
      /(?:^|\n)\s*Best regards[^\n]*(?:\n|$)/i,
      /(?:^|\n)\s*Kind regards[^\n]*(?:\n|$)/i,
      /(?:^|\n)\s*Med venlig hilsen[^\n]*(?:\n|$)/i,
      /(?:^|\n)\s*Sincerely[^\n]*(?:\n|$)/i,
      /(?:^|\n)\s*Regards[^\n]*(?:\n|$)/i
    ];

    let earliestMatch = txt.length;
    for (const pattern of farewellPatterns) {
      const match = txt.match(pattern);
      if (match && match.index !== undefined && match.index < earliestMatch) {
        earliestMatch = match.index;
      }
    }

    if (earliestMatch < txt.length) {
      // Find the end of the farewell line - keep "Viele Grüße" but remove everything after
      // The match starts at newline or start, so find where the farewell line ends
      const matchText = txt.slice(earliestMatch);
      // Find the end of the line containing the farewell
      const lineEnd = matchText.indexOf('\n');
      if (lineEnd >= 0) {
        // Cut after the farewell line (keep the farewell, remove signature after)
        const cutPoint = earliestMatch + lineEnd + 1;
        txt = txt.slice(0, cutPoint).trimEnd();
      } else {
        // No newline after farewell, cut at the match point
        txt = txt.slice(0, earliestMatch).trimEnd();
      }
    }

    // Remove common legal/signature patterns that might remain
    const legalPatterns = [
      /Sitz der Gesellschaft[^\n]*(?:\n|$)/i,
      /Registereintrag[^\n]*(?:\n|$)/i,
      /Geschäftsführer[^\n]*(?:\n|$)/i,
      /USt\. Ident\. Nr\.[^\n]*(?:\n|$)/i,
      /Die in dieser E-Mail[^\n]*(?:\n|$)/i,
      /The information contained in this e-mail[^\n]*(?:\n|$)/i,
      /VAT ID[^\n]*(?:\n|$)/i,
      /Place of incorporation[^\n]*(?:\n|$)/i
    ];

    for (const pattern of legalPatterns) {
      txt = txt.replace(pattern, '');
    }

    txt = txt.replace(/\u00a0/g, ' ');
    txt = txt.replace(/[ \t]+\n/g, '\n');
    txt = txt.replace(/\n{3,}/g, '\n\n');
    return txt.trim();
  }

  // Expand ALL folded content - find and click all "See more" buttons
  console.log('[EXTRACT] Looking for expand buttons...');
  const expandButtons = document.querySelectorAll('.js-toggleFold');
  console.log('[EXTRACT] Found', expandButtons.length, 'expand buttons');
  let clickedCount = 0;
  expandButtons.forEach(btn => {
    try {
      const btnText = btn.textContent.trim().toLowerCase();
      if (btnText.includes('see more')) {
        btn.click();
        clickedCount++;
      }
    } catch (e) {
      console.error('[EXTRACT] Error clicking button:', e);
    }
  });
  console.log('[EXTRACT] Clicked', clickedCount, 'buttons');
  // Wait for all expansions to complete
  if (clickedCount > 0) {
    await new Promise(resolve => setTimeout(resolve, 300));
  }
  // Remove height restrictions on all articles
  document.querySelectorAll('.textBubble-content[style*="height"]').forEach(el => { el.style.removeProperty('height'); });

  console.log('[EXTRACT] Looking for .ticketZoom...');
  const ticketRoot = document.querySelector('.ticketZoom');
  if (!ticketRoot) {
    console.error('[EXTRACT] No .ticketZoom found on page');
    console.error('[EXTRACT] Current URL:', location.href);
    return { ok: false, error: 'No .ticketZoom found - make sure you are on a ticket page' };
  }
  console.log('[EXTRACT] Found ticketZoom element');

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
    // Prefer meta "From"
    const metaFrom = article.querySelector('.article-content-meta .article-meta-row');
    if (metaFrom && /From/i.test(metaFrom.textContent || '')) {
      const val = metaFrom.querySelector('.article-meta-value')?.textContent || '';
      const emailMatch = val.match(/<([^>]+)>/);
      const name = val.replace(/\s*<[^>]+>\s*/g, '').trim();
      const email = emailMatch ? emailMatch[1].trim() : '';
      return { name, email };
    }
    // Fallback avatar title
    const avatar = article.querySelector('.js-avatar [title]');
    const name = avatar?.getAttribute('title')?.trim() || (article.classList.contains('agent') ? 'Agent' : 'Customer');
    return { name, email: '' };
  }

  // Extract ALL articles from the page
  console.log('[EXTRACT] Looking for articles...');
  const allArticles = document.querySelectorAll('.ticket-article-item');
  console.log('[EXTRACT] Found', allArticles.length, 'articles');
  const messages = [];
  allArticles.forEach((article, idx) => {
    // Skip internal/system messages - only extract customer and agent messages
    const isCustomer = article.classList.contains('customer');
    const isAgent = article.classList.contains('agent');
    if (!isCustomer && !isAgent) {
      console.log('[EXTRACT] Article', idx + 1, 'skipped: no customer/agent class');
      return;
    }

    // Check if this is an internal note (missing article metadata or avatar)
    const hasArticleMeta = article.querySelector('.article-content-meta');
    const hasAvatar = article.querySelector('.js-avatar');
    if (!hasArticleMeta && !hasAvatar) {
      console.log('[EXTRACT] Article', idx + 1, 'skipped: no metadata or avatar (internal note)');
      return;
    }

    const role = isAgent ? 'agent' : 'customer';
    const contentEl = article.querySelector('.textBubble-content .richtext-content') ||
      article.querySelector('.textBubble-content');
    if (!contentEl) {
      console.log('[EXTRACT] Article', idx + 1, 'skipped: no content element');
      return;
    }
    const text = textFromNode(contentEl);
    if (!text) {
      console.log('[EXTRACT] Article', idx + 1, 'skipped: no text content');
      return;
    }

    const { name, email } = getAuthor(article);
    console.log('[EXTRACT] Article', idx + 1, 'author check - name:', name, 'email:', email);

    // Skip internal notes: if no email, it's internal
    if (!email || email.trim() === '') {
      console.log('[EXTRACT] Article', idx + 1, 'skipped: no email (internal note)');
      return;
    }

    // Skip if no proper author name (internal notes might have empty/fallback names)
    if (!name || name === 'Agent' || name === 'Customer') {
      const metaFrom = article.querySelector('.article-content-meta .article-meta-row');
      if (!metaFrom || !/From/i.test(metaFrom.textContent || '')) {
        console.log('[EXTRACT] Article', idx + 1, 'skipped: no proper author info (internal note)');
        return;
      }
    }

    const dateIso = getArticleDate(article);
    console.log('[EXTRACT] Article', idx + 1, 'extracted:', name, email, role);

    messages.push({
      authorName: name,
      authorEmail: email,
      role,
      date: dateIso,
      contentText: text
    });
  });

  console.log('[EXTRACT] Extracted', messages.length, 'messages');

  const transcript = messages.map(m => {
    const d = m.date ? new Date(m.date) : null;
    const local = d ? `${d.getFullYear()}-${String(d.getMonth() + 1).padStart(2, '0')}-${String(d.getDate()).padStart(2, '0')} ${String(d.getHours()).padStart(2, '0')}:${String(d.getMinutes()).padStart(2, '0')}` : '';
    return `mail: ${m.authorName}\ndate: ${local}\ncontent:\n${m.contentText}`;
  }).join('\n\n');

  // Copy to clipboard using execCommand (works in content script context)
  function copyToClipboard(text) {
    const textarea = document.createElement('textarea');
    textarea.value = text;
    textarea.style.position = 'fixed';
    textarea.style.left = '-999999px';
    textarea.style.top = '-999999px';
    document.body.appendChild(textarea);
    textarea.focus();
    textarea.select();
    try {
      const success = document.execCommand('copy');
      document.body.removeChild(textarea);
      return success;
    } catch (err) {
      document.body.removeChild(textarea);
      return false;
    }
  }

  console.log('[EXTRACT] Copying to clipboard...');
  const copied = copyToClipboard(transcript);
  console.log('[EXTRACT] Clipboard copy result:', copied);

  const now = new Date();
  const ts = `${now.getFullYear()}${String(now.getMonth() + 1).padStart(2, '0')}${String(now.getDate()).padStart(2, '0')}-${String(now.getHours()).padStart(2, '0')}${String(now.getMinutes()).padStart(2, '0')}`;
  const filename = `ticket-${number || 'unknown'}-${ts}.json`;
  const jsonMessages = messages.map(m => ({
    ...m,
    contentText: m.contentText.replace(/\n/g, ' ')
  }));
  const json = {
    ticketNumber: number || '',
    ticketTitle: title || '',
    url: location.href,
    exportedAt: new Date().toISOString(),
    messages: jsonMessages
  };

  const result = {
    ok: true,
    transcript,
    json: alsoJson ? json : undefined,
    filename,
    copied: copied
  };

  console.log('[EXTRACT] Returning result:', { ok: result.ok, messageCount: messages.length, copied: result.copied });
  return result;
}
