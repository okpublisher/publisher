/**
 * Φόρμα ενδιαφέροντος του okpublisher.gr (ξεχωριστό Apps Script, ΔΕΝ αγγίζει τη δημοσίευση).
 *
 * Το site στέλνει POST (JSON) σε αυτό το web app. Κάθε αίτημα:
 *   - γράφεται σε μια γραμμή του Sheet στο οποίο ανήκει το script (καρτέλα «Ενδιαφέροντα»),
 *   - στέλνεται ως email στον λογαριασμό που τρέχει το script (okpublisher.gr) — σε κανέναν άλλον.
 * Προστασία: κρυφό πεδίο (website) για bots, όρια μήκους, το πολύ 30 αιτήματα την ώρα.
 * Η σελίδα setup.html στέλνει "type": "setup" → καρτέλα «Σεταρίσματα» + email «Σετάρισμα: …» (στοιχεία νέου πελάτη).
 *   Υποχρεωτική η αποδοχή των όρων (terms.html): πεδίο terms = έκδοση (π.χ. v1-2026-11-25) → στήλη «Όροι (έκδοση)».
 *   Στοιχεία τιμολόγησης (bill_name, bill_afm, bill_doy, bill_address) → στήλες μετά τους «Όρους». Τα ελέγχει η σελίδα·
 *   εδώ ΔΕΝ απορρίπτουμε (η σελίδα στέλνει no-cors και δεν θα έβλεπε το λάθος): ό,τι λείπει ή ΑΦΜ που δεν περνά τον
 *   έλεγχο γράφεται στη στήλη «Έλεγχος τιμολόγησης» και στο email, για να το ζητήσουμε από τον πελάτη.
 * Στήλες Πηγή (utm_… του συνδέσμου ή ο ιστότοπος από τον οποίο ήρθε) και Νέα (ναι = συγκατάθεση για email με νέα/προσφορές,
 * από το τετραγωνάκι της φόρμας· χωρίς «ναι» δεν στέλνουμε διαφημιστικά email).
 *
 * Ο κώδικας ζει στο repo okpublisher/publisher (form/) και ανεβαίνει μόνος του με το workflow «Deploy φόρμας»:
 *   δοκιμές (form/test) → clasp push → νέα έκδοση στην ΙΔΙΑ ανάπτυξη (ίδιος σύνδεσμος /exec) → έλεγχος ότι απαντά.
 *   ΠΟΤΕ αλλαγή στον editor (το επόμενο ανέβασμα θα σταματούσε). Το "webapp" του appsscript.json δεν φεύγει.
 *
 * Εγκατάσταση (έγινε 24/11/2026, στο okpublisher.gr@gmail.com):
 *   1. Νέο Google Sheet «okpublisher — ενδιαφέροντα» → Επεκτάσεις → Apps Script → επικόλληση αυτού του αρχείου.
 *   2. Ανάπτυξη → Νέα ανάπτυξη → Εφαρμογή ιστού · Εκτέλεση ως: Εγώ · Πρόσβαση: Οποιοσδήποτε → Ανάπτυξη → άδειες.
 *   3. Η διεύθυνση /exec μπαίνει στο FORM_URL του index.html του site.
 *   Δοκιμή: συνάρτηση testForm() → μία δοκιμαστική γραμμή + email.
 */
const FORM_ = {
  SHEET: 'Ενδιαφέροντα',
  HEAD: ['Χρόνος', 'Όνομα', 'Επιχείρηση', 'Email', 'Τηλέφωνο', 'Πακέτο', 'Instagram/Facebook', 'Μήνυμα', 'Γλώσσα', 'Κατάσταση', 'Πηγή', 'Νέα'],
  MAX_PER_HOUR: 30,
  LEN: { name: 120, business: 160, email: 160, phone: 40, plan: 40, social: 160, message: 3000, lang: 4, source: 200, news: 4 },
  SETUP_SHEET: 'Σεταρίσματα',
  TERMS_RE: /^v\d+-\d{4}-\d{2}-\d{2}$/,   // έκδοση όρων που αποδέχτηκε ο πελάτης (setup.html)
  SETUP: [  // [πεδίο, επικεφαλίδα, μέγιστο μήκος]
    ['business', 'Επιχείρηση', 160], ['name', 'Υπεύθυνος', 120], ['email', 'Email εγκρίσεων', 160], ['approvers', 'Άλλοι εγκρίνοντες', 400],
    ['plan', 'Πακέτο', 80], ['phones', 'Τηλέφωνα (posts)', 120], ['facebook', 'Facebook', 200], ['instagram', 'Instagram', 120],
    ['address', 'Διεύθυνση/περιοχή', 200], ['about', 'Τι κάνει', 3000], ['rules', 'Τι ΔΕΝ γράφουμε', 3000], ['reviews', 'Κριτικές Google', 300],
    ['times', 'Ώρες', 20], ['times_custom', 'Δικές του ώρες', 120], ['reels', 'Έτοιμα reels', 40], ['logo', 'Λογότυπο στο Drive', 4],
    ['message', 'Άλλα', 3000]],
  BILL: [  // στοιχεία τιμολόγησης· στήλες στο τέλος (μετά τους «Όρους»), για να μη μετακινηθούν οι παλιές
    ['bill_name', 'Επωνυμία τιμολόγησης', 200], ['bill_afm', 'ΑΦΜ', 30], ['bill_doy', 'ΔΟΥ', 80], ['bill_address', 'Διεύθυνση τιμολόγησης', 200]],
  EXTRA: [  // νεότερα πεδία· στήλες στο τέλος (μετά τον «Έλεγχο τιμολόγησης»), για να μη μετακινηθούν οι παλιές
    ['music', 'Μουσική στα reels', 60]],
};

function doPost(e) {
  let d = {};
  try { d = JSON.parse((e && e.postData && e.postData.contents) || '{}'); } catch (err) { return out_({ ok: false, error: 'bad json' }); }
  if (d.website) return out_({ ok: true });                       // bot: σιωπηλά τίποτα
  if (d.type === 'setup') return setup_(d);
  const r = {};
  Object.keys(FORM_.LEN).forEach(function (k) { r[k] = String(d[k] == null ? '' : d[k]).replace(/[\u0000-\u0008\u000b\u000c\u000e-\u001f]/g, '').trim().slice(0, FORM_.LEN[k]); });
  if (!r.name || !r.business || !/^[^@\s]+@[^@\s]+\.[^@\s]+$/.test(r.email)) return out_({ ok: false, error: 'missing fields' });
  const cache = CacheService.getScriptCache();
  const n = Number(cache.get('n') || 0);
  if (n >= FORM_.MAX_PER_HOUR) return out_({ ok: false, error: 'busy' });
  cache.put('n', String(n + 1), 3600);
  const lock = LockService.getScriptLock();
  lock.tryLock(10000);
  try {
    const sh = sheet_();
    // Τα κελιά γράφονται ως κείμενο (όχι τύποι): ό,τι αρχίζει με = + - @ παίρνει μπροστά απόστροφο.
    const safe = function (v) { return /^[=+\-@]/.test(v) ? "'" + v : v; };
    const news = r.news === 'ναι' ? 'ναι' : 'όχι';
    sh.appendRow([new Date()].concat([r.name, r.business, r.email, r.phone, r.plan, r.social, r.message, r.lang].map(safe), ['νέο', safe(r.source || '—'), news]));
  } finally { lock.releaseLock(); }
  const me = Session.getEffectiveUser().getEmail();
  if (me) {
    MailApp.sendEmail({
      to: me, replyTo: r.email, name: 'okpublisher.gr',
      subject: '[okpublisher.gr] Νέο ενδιαφέρον: ' + r.business + (r.plan ? ' (' + r.plan + ')' : ''),
      body: ['Όνομα: ' + r.name, 'Επιχείρηση: ' + r.business, 'Email: ' + r.email, 'Τηλέφωνο: ' + (r.phone || '—'),
        'Πακέτο: ' + (r.plan || 'δεν ξέρει ακόμα'), 'Instagram/Facebook: ' + (r.social || '—'), 'Γλώσσα: ' + (r.lang || 'el'),
        'Πηγή: ' + (r.source || '—'), 'Νέα/προσφορές με email: ' + (r.news === 'ναι' ? 'ναι (συγκατάθεση)' : 'όχι'), '', r.message || '(χωρίς μήνυμα)',
        '', 'Απάντηση: απλώς «Απάντηση» σε αυτό το email (πάει στον ενδιαφερόμενο).'].join('\n'),
    });
  }
  return out_({ ok: true });
}

function clean_(v, n) { return String(v == null ? '' : v).replace(/[\u0000-\u0008\u000b\u000c\u000e-\u001f]/g, '').trim().slice(0, n); }
function safe_(v) { return /^[=+\-@]/.test(v) ? "'" + v : v; }

// Φόρμα σεταρίσματος νέου πελάτη (setup.html): καρτέλα «Σεταρίσματα» + email στον λογαριασμό του okpublisher.
function setup_(d) {
  const r = {};
  FORM_.SETUP.forEach(function (f) { r[f[0]] = clean_(d[f[0]], f[2]); });
  if (!r.business || !r.name || !r.about || !/^[^@\s]+@[^@\s]+\.[^@\s]+$/.test(r.email)) return out_({ ok: false, error: 'missing fields' });
  const terms = clean_(d.terms, 40);
  if (!FORM_.TERMS_RE.test(terms)) return out_({ ok: false, error: 'terms not accepted' });
  const cache = CacheService.getScriptCache();
  const n = Number(cache.get('n') || 0);
  if (n >= FORM_.MAX_PER_HOUR) return out_({ ok: false, error: 'busy' });
  cache.put('n', String(n + 1), 3600);
  const b = {};
  FORM_.BILL.forEach(function (f) { b[f[0]] = clean_(d[f[0]], f[2]); });
  b.bill_afm = normAfm_(b.bill_afm);
  const billWarn = billCheck_(b);
  // Νέες στήλες πάντα στο τέλος («Όροι», μετά τα στοιχεία τιμολόγησης): οι παλιές στήλες δεν μετακινούνται.
  const head = ['Χρόνος'].concat(FORM_.SETUP.map(function (f) { return f[1]; }), ['Κατάσταση', 'Όροι (έκδοση)'],
    FORM_.BILL.map(function (f) { return f[1]; }), ['Έλεγχος τιμολόγησης'], FORM_.EXTRA.map(function (f) { return f[1]; }));
  const x = {};
  FORM_.EXTRA.forEach(function (f) { x[f[0]] = clean_(d[f[0]], f[2]); });
  // ΑΦΜ με απόστροφο: αλλιώς το Sheet τον κάνει αριθμό και χάνει τα μηδενικά μπροστά (π.χ. 09…).
  const billCells = FORM_.BILL.map(function (f) { const v = b[f[0]]; return f[0] === 'bill_afm' && v ? "'" + v : safe_(v); });
  const lock = LockService.getScriptLock();
  lock.tryLock(10000);
  try {
    const sh = sheet_(FORM_.SETUP_SHEET, head);
    sh.appendRow([new Date()].concat(FORM_.SETUP.map(function (f) { return safe_(r[f[0]]); }), ['νέο', terms], billCells, [billWarn || 'ΟΚ'],
      FORM_.EXTRA.map(function (f) { return safe_(x[f[0]]); })));
  } finally { lock.releaseLock(); }
  const me = Session.getEffectiveUser().getEmail();
  if (me) {
    MailApp.sendEmail({
      to: me, replyTo: r.email, name: 'okpublisher.gr',
      subject: '[okpublisher.gr] Σετάρισμα: ' + r.business + ' (' + (r.plan.split(' ')[0] || '—') + ')',
      body: FORM_.SETUP.concat(FORM_.EXTRA).map(function (f) { return f[1] + ': ' + (r[f[0]] || x[f[0]] || '—'); }).join('\n') +
        '\nΌροι: αποδοχή στη φόρμα, έκδοση ' + terms +
        '\n\nΤιμολόγηση:\n' + FORM_.BILL.map(function (f) { return f[1] + ': ' + (b[f[0]] || '—'); }).join('\n') +
        (billWarn ? '\n⚠ ' + billWarn + ': ζήτησέ τα από τον πελάτη πριν από την πρώτη πληρωμή.' : '') +
        '\n\nΕπόμενο: config του πελάτη στο publisher-work (ο Claude), πρόσβαση σελίδας/Instagram, φάκελος Drive, token.',
    });
  }
  return out_({ ok: true });
}

// ΑΦΜ: χωρίς κενά/τελείες/παύλες και χωρίς πρόθεμα EL/GR.
function normAfm_(v) { return String(v || '').replace(/[\s.\-]/g, '').replace(/^(EL|GR)/i, ''); }

// Ελληνικός ΑΦΜ: 9 ψηφία, το τελευταίο είναι ψηφίο ελέγχου.
function afmOk_(a) {
  if (!/^\d{9}$/.test(a) || a === '000000000') return false;
  let s = 0;
  for (let i = 0; i < 8; i++) s += Number(a.charAt(i)) * Math.pow(2, 8 - i);
  return (s % 11) % 10 === Number(a.charAt(8));
}

// '' αν όλα καλά· αλλιώς τι λείπει ή τι δεν περνά τον έλεγχο.
function billCheck_(b) {
  const miss = FORM_.BILL.filter(function (f) { return !b[f[0]]; }).map(function (f) { return f[1]; });
  if (miss.length) return 'Λείπουν: ' + miss.join(', ');
  if (!afmOk_(b.bill_afm)) return 'Ο ΑΦΜ δεν περνά τον έλεγχο';
  return '';
}

function doGet() { return out_({ ok: true, service: 'okpublisher form' }); }

function sheet_(name, head) {
  name = name || FORM_.SHEET; head = head || FORM_.HEAD;
  const ss = SpreadsheetApp.getActive();
  let sh = ss.getSheetByName(name);
  if (!sh) {
    sh = ss.insertSheet(name);
    sh.getRange(1, 1, 1, head.length).setValues([head]).setFontWeight('bold');
    sh.setFrozenRows(1);
  } else if (sh.getLastColumn() < head.length) {
    sh.getRange(1, 1, 1, head.length).setValues([head]).setFontWeight('bold');   // νέες στήλες στο τέλος
  }
  return sh;
}

function out_(o) { return ContentService.createTextOutput(JSON.stringify(o)).setMimeType(ContentService.MimeType.JSON); }

function testSetup() {
  const res = doPost({ postData: { contents: JSON.stringify({ type: 'setup', business: 'Δοκιμαστική επιχείρηση', name: 'Δοκιμή', email: 'test@example.com',
    plan: 'Βασικό · 2 posts + 2 stories την εβδομάδα · €150', about: 'Δοκιμή σεταρίσματος', times: 'αυτόματες', reels: 'στις θέσεις των reels',
    terms: 'v3-2026-11-25', bill_name: 'Δοκιμαστική ΙΚΕ', bill_afm: '123456783', bill_doy: 'Δοκιμαστική ΔΟΥ', bill_address: 'Οδός Δοκιμής 1, 00000 Πόλη' }) } });
  console.log(res.getContent());
}

function testForm() {
  const res = doPost({ postData: { contents: JSON.stringify({ name: 'Δοκιμή', business: 'Δοκιμαστική επιχείρηση', email: 'test@example.com', plan: 'Μεσαίο', message: 'Δοκιμή φόρμας', lang: 'el', source: 'δοκιμή', news: 'ναι' }) } });
  console.log(res.getContent());
}
