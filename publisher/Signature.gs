/**
 * Υπογραφή email (από 27/11/2026): κάθε αυτόματο email προς τα έξω παίρνει στο τέλος την ΤΡΕΧΟΥΣΑ υπογραφή του
 * Gmail του λογαριασμού που τρέχει το script (Ρυθμίσεις Gmail → Γενικά → Υπογραφή). Το Gmail ΔΕΝ βάζει μόνο του υπογραφή στα
 * email που στέλνει κώδικας· γι' αυτό τη διαβάζουμε (Gmail API, settings/sendAs, άδεια gmail.modify που ήδη υπάρχει).
 *   - Cache 30′ (και η τελευταία γνωστή στο SIGNATURE_LAST, αν το Gmail δεν απαντά). Άδεια υπογραφή → κανένα κλείσιμο.
 *   - ΟΧΙ σε email πελατών agency (δεν φαίνεται ποτέ το okpublisher) και ΟΧΙ στα email συστήματος προς το ίδιο το okpublisher.
 *   - Η φόρμα του site (χωριστό Apps Script, χωρίς άδεια Gmail) τη διαβάζει από την καρτέλα «Υπογραφή» αυτού του Sheet, που
 *     ενημερώνεται κάθε ώρα (sigSync_, κύκλος πληρωμών). Η φόρμα βρίσκει το Sheet από τη «Ρυθμίσεις» → «Sheet συστήματος».
 */
const SIG_ = { CACHE_KEY: 'sig:1', CACHE_S: 1800, FAIL_S: 600, TAB: 'Υπογραφή' };

// { html, text } ή null (χωρίς υπογραφή / Gmail μη διαθέσιμο και καμία παλιά).
function sig_() {
  const c = CacheService.getScriptCache();
  try {
    const hit = c.get(SIG_.CACHE_KEY);
    if (hit) { const o = JSON.parse(hit); return o && o.html ? o : null; }
  } catch (e) { /* ξανά από το Gmail */ }
  let html = null;
  try {
    const me = String(Session.getEffectiveUser().getEmail() || '').toLowerCase();
    const list = (gmail_('get', '/settings/sendAs').sendAs) || [];
    const sa = list.filter(function (x) { return String(x.sendAsEmail || '').toLowerCase() === me; })[0] ||
      list.filter(function (x) { return x.isPrimary; })[0] || list[0];
    html = sa ? String(sa.signature || '').trim() : '';
  } catch (e) { html = null; }
  let o;
  if (html === null) {                                    // το Gmail δεν απάντησε: η τελευταία γνωστή
    try { o = JSON.parse(prop_('SIGNATURE_LAST', 'null')); } catch (e) { o = null; }
    try { c.put(SIG_.CACHE_KEY, JSON.stringify(o || {}), SIG_.FAIL_S); } catch (e) { /* χωρίς cache */ }
    return o && o.html ? o : null;
  }
  o = html ? { html: html, text: sigText_(html) } : {};
  try { c.put(SIG_.CACHE_KEY, JSON.stringify(o), SIG_.CACHE_S); } catch (e) { /* πολύ μεγάλη: χωρίς cache */ }
  try { if (JSON.stringify(o) !== prop_('SIGNATURE_LAST', '')) P_().setProperty('SIGNATURE_LAST', JSON.stringify(o)); } catch (e) { /* όριο 9 KB */ }
  return o.html ? o : null;
}

// Η υπογραφή σε απλό κείμενο: γραμμές, χωρίς HTML· οι σύνδεσμοι κρατούν το κείμενό τους.
function sigText_(html) { return htmlToText_(String(html).replace(/<img[^>]*>/gi, '')).replace(/[ \t]+\n/g, '\n').replace(/\n{2,}/g, '\n').trim(); }

// Απλό κείμενο → HTML email (με συνδέσμους), στο ίδιο ύφος με τα άλλα email.
function sigTextHtml_(t) {
  return '<div style="font:15px/1.6 Arial,sans-serif;color:#14162E">' +
    esc_(t).replace(/(https:\/\/[^\s<]+)/g, '<a href="$1">$1</a>').replace(/\n/g, '<br>') + '</div>';
}

// Προσθέτει την υπογραφή σε { body/text, htmlBody/html }. noSig = true (π.χ. πελάτης agency) → όπως είναι.
// keys: ['body', 'htmlBody'] για MailApp, ['text', 'html'] για sendMail_.
function withSig_(o, noSig, keys) {
  if (noSig) return o;
  const s = sig_();
  if (!s) return o;
  const kt = (keys || ['body', 'htmlBody'])[0], kh = (keys || ['body', 'htmlBody'])[1];
  const text = String(o[kt] || (o[kh] ? htmlToText_(o[kh]) : ''));
  if (!o[kh]) o[kh] = sigTextHtml_(text);
  o[kh] = String(o[kh]) + '<br><div style="margin-top:14px">' + s.html + '</div>';
  o[kt] = text + '\n\n-- \n' + s.text;
  return o;
}

// Email προς τα έξω (όχι πελάτη agency) με την υπογραφή του Gmail.
function mailOut_(o) { MailApp.sendEmail(withSig_(o)); }

// Κάθε ώρα: η τρέχουσα υπογραφή στην καρτέλα «Υπογραφή» αυτού του Sheet (για τη φόρμα του site). Γράφει μόνο όταν αλλάξει.
function sigSync_() {
  const s = sig_() || { html: '', text: '' };
  const ss = SpreadsheetApp.getActive();
  let sh = ss.getSheetByName(SIG_.TAB);
  if (!sh) sh = ss.insertSheet(SIG_.TAB);
  const cur = sh.getLastRow() >= 2 ? sh.getRange(1, 2, 2, 1).getValues() : [[''], ['']];
  if (String(cur[0][0]) === s.html && String(cur[1][0]) === s.text) return false;
  sh.getRange(1, 1, 3, 2).setValues([['HTML', s.html], ['Κείμενο', s.text],
    ['Ενημέρωση', 'Γράφεται μόνο του κάθε ώρα από την υπογραφή του Gmail (Signature.gs). Μην το αλλάζεις εδώ: ' + new Date().toISOString()]]);
  return true;
}
