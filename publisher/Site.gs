/**
 * Ιστοσελίδα πελάτη → στοιχεία brand για το AI (okpublisher, ξεχωριστό αρχείο στο ίδιο project). Από 26/11/2026.
 *
 * Η φόρμα σεταρίσματος έχει πεδίο «Ιστοσελίδα». Το AI με WebFetch βλέπει μόνο το κείμενο μιας σελίδας (όχι CSS), οπότε
 * χρώματα και γραμματοσειρές τα βγάζει εδώ το script: κάθε ώρα (κύκλος πληρωμών) η siteScanCycle_() διαβάζει τα
 * σεταρίσματα (admLeads_) και, για όσα έχουν ιστοσελίδα και κωδικό OK-… και δεν έχουν σαρωθεί, κατεβάζει τη σελίδα και
 * έως SITE_.CSS_FILES αρχεία CSS. Βγάζει:
 *   - χρώματα με συχνότητα (hex/rgb, χωριστά τα «ουδέτερα» γκρι/λευκά/μαύρα), theme-color, μεταβλητές CSS (--primary: …),
 *   - γραμματοσειρές (font-family, @font-face, Google Fonts),
 *   - τίτλο, περιγραφή, εικόνες που μοιάζουν με λογότυπο, og:image, εικονίδια, πλατφόρμα (WordPress, Wix, …),
 *   - το κείμενο της σελίδας (για το ύφος),
 *   - το πρώτο λογότυπο της σελίδας (εικόνα έως 3 MB) → setups/<OK-…>/site_logo.<ext> (αν ο πελάτης δεν ανεβάσει δικό του).
 *   → publisher-work setups/<OK-…>/site.json (ιδιωτικό· ο Claude το διαβάζει όταν στήνει τον πελάτη, RUNBOOK §1.1)
 *   → Script Property SITE_SCAN { "<OK-…>": { url, at, ok, colors[5], fonts[3], err, tries } } (σύνοψη για το διαχειριστικό).
 * Μόνο ανάγνωση δημόσιων σελίδων (http/https· όχι IP, localhost ή .local), όρια μεγέθους, έως 2 σελίδες ανά κύκλο,
 * έως 3 προσπάθειες ανά διεύθυνση, μόνο σεταρίσματα των τελευταίων SITE_.MAX_AGE_DAYS ημερών. Καμία νέα άδεια Google.
 */
const SITE_ = {
  MAX_PER_RUN: 2,
  MAX_HTML: 800000,
  MAX_CSS: 400000,
  CSS_FILES: 4,
  TRIES: 3,
  KEEP: 30,             // εγγραφές στο SITE_SCAN (όριο 9 KB ανά Script Property)
  MAX_AGE_DAYS: 60,
  MAX_LOGO: 3 * 1024 * 1024,
  LOGO_TYPES: { 'image/svg+xml': 'svg', 'image/png': 'png', 'image/jpeg': 'jpg', 'image/webp': 'webp', 'image/gif': 'gif' },
  TEXT: 6000,
  UA: 'Mozilla/5.0 (compatible; okpublisher-brand-check; +https://okpublisher.gr)',
  // Γενικές λέξεις CSS και γραμματοσειρές συστήματος (όχι επιλογή brand). Η Roboto/Arial κ.λπ. μετράνε μόνο όταν είναι πρώτες.
  GENERIC: ['inherit', 'initial', 'unset', 'revert', 'serif', 'sans-serif', 'monospace', 'cursive', 'fantasy', 'system-ui', 'ui-sans-serif',
    'ui-serif', 'ui-monospace', 'ui-rounded', '-apple-system', 'blinkmacsystemfont', 'segoe ui', 'apple color emoji', 'segoe ui emoji',
    'segoe ui symbol', 'noto color emoji', 'emoji', 'math', 'fangsong', 'dashicons', 'fontawesome', 'font awesome 5 free',
    'font awesome 6 free', 'font awesome 5 brands', 'font awesome 6 brands', 'eicons', 'icomoon'],
};

// Κάθε ώρα: έως 2 νέες ιστοσελίδες. Επιστρέφει πόσες κοίταξε.
function siteScanCycle_() {
  const L = admLeads_(), scan = siteScanState_(), now = Date.now();
  let n = 0;
  (L.setups || []).forEach(function (s) {
    if (n >= SITE_.MAX_PER_RUN) return;
    const code = String(s.code || ''), url = siteNorm_(s.website);
    if (!/^OK-\d{4,}$/.test(code) || !url) return;
    const t = admTime_(s.at);
    if (t && now - t > SITE_.MAX_AGE_DAYS * 86400000) return;
    const prev = scan[code];
    if (prev && prev.url === url && (prev.ok || (prev.tries || 0) >= SITE_.TRIES)) return;
    n++;
    const rec = { url: url, at: new Date().toISOString(), tries: prev && prev.url === url ? (prev.tries || 0) + 1 : 1 };
    try {
      const r = siteScan_(url);
      try { r.logo_file = siteLogo_(code, r.logo_candidates); } catch (e) { r.errors.push('λογότυπο: ' + e.message); }
      ghPutJson_('setups/' + code + '/site.json', Object.assign({ code: code, business: s.business, scanned_at: rec.at }, r), 'Ιστοσελίδα ' + code);
      rec.ok = true;
      rec.colors = r.colors.filter(function (c) { return !c.neutral; }).slice(0, 5).map(function (c) { return c.hex; });
      rec.fonts = r.fonts.slice(0, 3).map(function (f) { return f.family; });
    } catch (e) {
      rec.ok = false; rec.err = String(e.message || e).slice(0, 120);
    }
    scan[code] = rec;
  });
  if (n) siteScanSave_(scan);
  return n;
}

function siteScanState_() { try { return JSON.parse(prop_('SITE_SCAN', '{}')) || {}; } catch (e) { return {}; } }
function siteScanSave_(scan) {
  const keys = Object.keys(scan).sort(function (a, b) { return String(scan[b].at).localeCompare(String(scan[a].at)); }).slice(0, SITE_.KEEP);
  const o = {};
  keys.forEach(function (k) { o[k] = scan[k]; });
  P_().setProperty('SITE_SCAN', JSON.stringify(o));
}

// Διεύθυνση: μόνο http(s), όνομα με τελεία, όχι IP / localhost / .local. Αλλιώς ''.
function siteNorm_(v) {
  let s = String(v || '').trim().replace(/\s+/g, '');
  if (!s) return '';
  if (!/^https?:\/\//i.test(s)) s = 'https://' + s.replace(/^\/+/, '');
  const m = /^https?:\/\/([^\/?#:@]+)(:\d+)?([\/?#].*)?$/i.exec(s);
  if (!m) return '';
  const host = m[1].toLowerCase();
  if (!/\.[a-z]{2,}$/.test(host) || /^\d+(\.\d+){3}$/.test(host) || /(^|\.)localhost$|\.local$|\.internal$/.test(host)) return '';
  return s;
}

function siteAbs_(base, href) {
  href = String(href || '').trim().replace(/&amp;/g, '&');
  if (!href || /^(data|javascript|mailto|tel):/i.test(href)) return '';
  if (/^https?:\/\//i.test(href)) return href;
  const m = /^(https?:)\/\/[^\/?#]+/i.exec(base);
  if (!m) return '';
  if (/^\/\//.test(href)) return m[1] + href;
  if (/^\//.test(href)) return m[0] + href;
  return base.replace(/[?#].*$/, '').replace(/[^\/]*$/, '') + href;
}

function siteFetch_(url, max) {
  const r = UrlFetchApp.fetch(url, { muteHttpExceptions: true, followRedirects: true, headers: { 'User-Agent': SITE_.UA } });
  const code = r.getResponseCode();
  if (code >= 400) throw new Error('η σελίδα απάντησε ' + code);
  return String(r.getContentText() || '').slice(0, max);
}

// Σάρωση μιας σελίδας (και των CSS της). Ρίχνει σφάλμα μόνο αν δεν διαβαστεί καθόλου η σελίδα.
function siteScan_(url) {
  const html = siteFetch_(url, SITE_.MAX_HTML);
  if (!/<html|<head|<body|<div/i.test(html)) throw new Error('δεν είναι σελίδα HTML');
  const attr = function (tag, name) { const m = new RegExp('\\b' + name + '\\s*=\\s*("([^"]*)"|\'([^\']*)\'|([^\\s>]+))', 'i').exec(tag); return m ? (m[2] || m[3] || m[4] || '') : ''; };
  const tags = function (name) { return html.match(new RegExp('<' + name + '\\b[^>]*>', 'gi')) || []; };
  const meta = function (key) {
    const t = tags('meta').filter(function (x) { return (attr(x, 'name') || attr(x, 'property')).toLowerCase() === key; })[0];
    return t ? siteDecode_(attr(t, 'content')).slice(0, 300) : '';
  };
  const out = { url: url, title: siteDecode_(((/<title[^>]*>([\s\S]*?)<\/title>/i.exec(html) || [])[1] || '').trim()).slice(0, 200),
    description: meta('description') || meta('og:description'), site_name: meta('og:site_name'), theme_color: siteColor_(meta('theme-color')),
    og_image: siteAbs_(url, meta('og:image')), generator: meta('generator'), css_files: [], errors: [] };

  // CSS: <style>, style="", και έως CSS_FILES αρχεία (όχι Google Fonts: από αυτά κρατάμε μόνο τα ονόματα).
  let css = (html.match(/<style\b[^>]*>[\s\S]*?<\/style>/gi) || []).join('\n');
  css += '\n' + (html.match(/\bstyle\s*=\s*"[^"]*"/gi) || []).join(';');
  const google = [];
  tags('link').forEach(function (t) {
    const rel = attr(t, 'rel').toLowerCase(), href = siteAbs_(url, attr(t, 'href'));
    if (!href) return;
    if (/fonts\.googleapis\.com/i.test(href)) {
      (href.match(/family=([^&:]+)/g) || []).forEach(function (f) { google.push(decodeURIComponent(f.slice(7)).replace(/\+/g, ' ').split(':')[0].trim()); });
      return;
    }
    if (rel.indexOf('stylesheet') >= 0 && out.css_files.length < SITE_.CSS_FILES) out.css_files.push(href);
  });
  out.css_files.forEach(function (h) {
    try { css += '\n' + siteFetch_(h, SITE_.MAX_CSS); } catch (e) { out.errors.push(h + ': ' + e.message); }
  });

  // Χρώματα: hex και rgb(a)· «ουδέτερα» = σχεδόν γκρι (λευκό, μαύρο, γκρι).
  const cnt = {};
  (css.match(/#[0-9a-f]{3,8}\b|rgba?\([^)]{5,60}\)/gi) || []).forEach(function (c) { const h = siteColor_(c); if (h) cnt[h] = (cnt[h] || 0) + 1; });
  out.colors = Object.keys(cnt).map(function (h) { return { hex: h, count: cnt[h], neutral: siteNeutral_(h) }; })
    .sort(function (a, b) { return b.count - a.count; }).slice(0, 24);
  const vars = {};
  let m;
  const reVar = /--([\w-]{2,40})\s*:\s*(#[0-9a-f]{3,8}\b|rgba?\([^)]{5,60}\))/gi;
  while ((m = reVar.exec(css)) && Object.keys(vars).length < 20) { const h = siteColor_(m[2]); if (h && !vars[m[1]]) vars[m[1]] = h; }
  out.css_vars = Object.keys(vars).map(function (k) { return { name: k, hex: vars[k] }; });

  // Γραμματοσειρές: η πρώτη οικογένεια κάθε font-family + @font-face, χωρίς τις γενικές του συστήματος.
  const fc = {};
  const add = function (f, w) { if (f && f.length <= 60) fc[f] = (fc[f] || 0) + w; };
  const clean = function (f) { return String(f || '').trim().replace(/\s*!important$/i, '').replace(/^['"]|['"]$/g, '').trim(); };
  const reFam = /font-family\s*:\s*([^;}{]+)/gi;
  while ((m = reFam.exec(css))) {
    const first = m[1].split(',').map(clean).filter(function (f) { return f && !/^var\(/i.test(f) && SITE_.GENERIC.indexOf(f.toLowerCase()) < 0; })[0];
    if (first) add(first, 1);
  }
  google.forEach(function (g) { add(g, 5); });
  out.google_fonts = google.filter(function (g, i, a) { return g && a.indexOf(g) === i; });
  out.fonts = Object.keys(fc).map(function (f) { return { family: f, count: fc[f], google: out.google_fonts.indexOf(f) >= 0 }; })
    .sort(function (a, b) { return b.count - a.count; }).slice(0, 10);

  // Λογότυπο / εικονίδια.
  out.logo_candidates = tags('img').filter(function (t) { return /logo|λογότυπ/i.test(t); })
    .map(function (t) { return siteAbs_(url, attr(t, 'src') || attr(t, 'data-src')); }).filter(String)
    .filter(function (u, i, a) { return a.indexOf(u) === i; }).slice(0, 6);
  out.icons = tags('link').filter(function (t) { return /icon/i.test(attr(t, 'rel')); })
    .map(function (t) { return siteAbs_(url, attr(t, 'href')); }).filter(String).slice(0, 4);

  // Κείμενο σελίδας (για το ύφος).
  out.text = siteDecode_(html.replace(/<(script|style|noscript|svg|template)\b[\s\S]*?<\/\1>/gi, ' ').replace(/<br\s*\/?>|<\/(p|div|h\d|li|section)>/gi, '\n')
    .replace(/<[^>]+>/g, ' ')).replace(/[ \t\u00a0]+/g, ' ').replace(/\s*\n\s*/g, '\n').replace(/\n{2,}/g, '\n').trim().slice(0, SITE_.TEXT);
  return out;
}

// Το πρώτο λογότυπο της σελίδας που κατεβαίνει (svg/png/jpg/webp/gif, έως 3 MB) → setups/<code>/site_logo.<ext>.
function siteLogo_(code, cands) {
  for (let i = 0; i < Math.min((cands || []).length, 3); i++) {
    const r = UrlFetchApp.fetch(cands[i], { muteHttpExceptions: true, followRedirects: true, headers: { 'User-Agent': SITE_.UA } });
    const h = r.getAllHeaders() || {}, type = String(h['Content-Type'] || h['content-type'] || '').split(';')[0].trim().toLowerCase();
    const ext = SITE_.LOGO_TYPES[type], bytes = r.getResponseCode() < 300 ? r.getContent() : [];
    if (!ext || !bytes.length || bytes.length > SITE_.MAX_LOGO) continue;
    const name = 'site_logo.' + ext;
    ghPutB64_('setups/' + code + '/' + name, Utilities.base64Encode(bytes), 'Λογότυπο από ιστοσελίδα ' + code);
    return name;
  }
  return '';
}

// Χρώμα → #RRGGBB (κεφαλαία). Διαφανή (alpha < 0,5) → ''.
function siteColor_(c) {
  c = String(c || '').trim().toLowerCase();
  let m = /^#([0-9a-f]{3,8})$/.exec(c);
  if (m) {
    let h = m[1];
    if (h.length === 3 || h.length === 4) {
      if (h.length === 4 && parseInt(h[3] + h[3], 16) < 128) return '';
      h = h[0] + h[0] + h[1] + h[1] + h[2] + h[2];
    } else if (h.length === 8) {
      if (parseInt(h.slice(6), 16) < 128) return '';
      h = h.slice(0, 6);
    } else if (h.length !== 6) return '';
    return '#' + h.toUpperCase();
  }
  m = /^rgba?\(\s*(\d{1,3})[\s,]+(\d{1,3})[\s,]+(\d{1,3})(?:\s*[,\/]\s*([\d.]+%?))?\s*\)$/.exec(c);
  if (!m) return '';
  if (m[4] !== undefined) { const a = /%$/.test(m[4]) ? parseFloat(m[4]) / 100 : parseFloat(m[4]); if (a < 0.5) return ''; }
  const hx = function (n) { n = Math.max(0, Math.min(255, Number(n))); return ('0' + n.toString(16)).slice(-2); };
  return ('#' + hx(m[1]) + hx(m[2]) + hx(m[3])).toUpperCase();
}
function siteNeutral_(h) {
  const r = parseInt(h.slice(1, 3), 16), g = parseInt(h.slice(3, 5), 16), b = parseInt(h.slice(5, 7), 16);
  return Math.max(r, g, b) - Math.min(r, g, b) < 18;
}
function siteDecode_(s) {
  return String(s || '').replace(/&nbsp;/g, ' ').replace(/&amp;/g, '&').replace(/&quot;/g, '"').replace(/&#39;|&apos;/g, "'")
    .replace(/&lt;/g, '<').replace(/&gt;/g, '>').replace(/&#(\d+);/g, function (x, n) { return String.fromCharCode(Number(n)); });
}
