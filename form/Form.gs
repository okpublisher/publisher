/**
 * Φόρμα ενδιαφέροντος του okpublisher.gr (ξεχωριστό Apps Script, ΔΕΝ αγγίζει τη δημοσίευση).
 *
 * Το site στέλνει POST (JSON) σε αυτό το web app. Κάθε αίτημα:
 *   - γράφεται σε μια γραμμή του Sheet στο οποίο ανήκει το script (καρτέλα «Ενδιαφέροντα»),
 *   - στέλνεται ως email στον λογαριασμό που τρέχει το script (okpublisher.gr) — σε κανέναν άλλον.
 * Προστασία: κρυφό πεδίο (website) για bots, όρια μήκους, το πολύ 30 αιτήματα την ώρα,
 *   η ίδια ακριβώς αποστολή ξανά μέσα σε 10 λεπτά (διπλό πάτημα) αγνοείται σιωπηλά (από 26/11/2026).
 * Αυτόματη απάντηση στον ενδιαφερόμενο (από 26/11/2026): ανάλογα με το πακέτο που διάλεξε (ή όλα, αν δεν ξέρει),
 *   ελληνικά ή αγγλικά (πεδίο lang), με τη δωρεάν εβδομάδα (όροι v6 Α.4) και τα επόμενα βήματα. Μία ανά email κάθε 6 ώρες.
 * Σετάρισμα: στήλη «Δωρεάν εβδομάδα» = ναι / όχι (μία ανά ΑΦΜ). Στήλη «Κωδικός πελάτη» (από 26/11/2026): OK-0002, OK-0003, …
 *   με σειρά (ο ίδιος ΑΦΜ παίρνει τον ίδιο κωδικό)· μπαίνει και στο email.
 * Καρτέλα «Ρυθμίσεις» (στήλες Ρύθμιση | Τιμή, τη γράφει ο Πέτρος ή ο Claude με το ΟΚ του): «Αντίγραφο σεταρισμάτων» και
 *   «Αντίγραφο ενδιαφερόντων» = email (χωρισμένα με κόμμα) που παίρνουν αντίγραφο (cc) του αντίστοιχου email. Χωρίς καρτέλα: κανένα.
 * Η σελίδα setup.html στέλνει "type": "setup" → καρτέλα «Σεταρίσματα» + email «Σετάρισμα OK-…: …» (στοιχεία νέου πελάτη).
 *   Υποχρεωτική η αποδοχή των όρων (terms.html): πεδίο terms = έκδοση (π.χ. v1-2026-11-25) → στήλη «Όροι (έκδοση)».
 *   Στοιχεία τιμολόγησης (bill_name, bill_afm, bill_doy, bill_address) → στήλες μετά τους «Όρους». Τα ελέγχει η σελίδα·
 *   εδώ ΔΕΝ απορρίπτουμε (η σελίδα στέλνει no-cors και δεν θα έβλεπε το λάθος): ό,τι λείπει ή ΑΦΜ που δεν περνά τον
 *   έλεγχο γράφεται στη στήλη «Έλεγχος τιμολόγησης» και στο email, για να το ζητήσουμε από τον πελάτη.
 * Στήλες Πηγή (utm_… του συνδέσμου ή ο ιστότοπος από τον οποίο ήρθε) και Νέα (ναι = συγκατάθεση για email με νέα/προσφορές,
 * από το τετραγωνάκι της φόρμας· χωρίς «ναι» δεν στέλνουμε διαφημιστικά email).
 * Στήλη «Σύσταση» (από 26/11/2026, και στις δύο καρτέλες, στο τέλος): ο κωδικός πωλητή του συνδέσμου (okpublisher.gr/?p=…),
 *   που η σελίδα στέλνει κρυφά (πεδίο ref). Εδώ μόνο γράφεται· ποιος πωλητής είναι το βρίσκει το διαχειριστικό (Admin.gs).
 *   Μπαίνει και στον σύνδεσμο σεταρίσματος της αυτόματης απάντησης.
 * Στήλη «Ιστοσελίδα» (από 26/11/2026, Σεταρίσματα, στο τέλος): πεδίο site_url της φόρμας (ΟΧΙ «website»: αυτό είναι το
 *   κρυφό πεδίο για bots), με https:// μπροστά αν λείπει. Από εκεί το κύριο script βγάζει χρώματα/γραμματοσειρές (Site.gs).
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
  HEAD: ['Χρόνος', 'Όνομα', 'Επιχείρηση', 'Email', 'Τηλέφωνο', 'Πακέτο', 'Instagram/Facebook', 'Μήνυμα', 'Γλώσσα', 'Κατάσταση', 'Πηγή', 'Νέα', 'Σύσταση'],
  REF_RE: /^[a-z0-9]{4,10}$/,   // κωδικός πωλητή (?p=)
  MAX_PER_HOUR: 30,
  LEN: { name: 120, business: 160, email: 160, phone: 40, plan: 40, social: 160, message: 3000, lang: 4, source: 200, news: 4 },
  SETUP_SHEET: 'Σεταρίσματα',
  SETTINGS_SHEET: 'Ρυθμίσεις',
  CC_SETUP: 'Αντίγραφο σεταρισμάτων',
  CC_LEAD: 'Αντίγραφο ενδιαφερόντων',
  FIRST_NO: 2,   // OK-0000 = το ίδιο το okpublisher (OKP), OK-0001 = ο πρώτος πελάτης (ORE)· τα σεταρίσματα ξεκινούν από OK-0002
  // Πακέτα για την αυτόματη απάντηση (ίδια με το site και τους όρους· τιμές χωρίς ΦΠΑ).
  PLANS: [
    { el: 'Βασικό', en: 'Basic', price: 150, week: 2, month: 9 },
    { el: 'Μεσαίο', en: 'Standard', price: 250, week: 4, month: 17 },
    { el: 'Καθημερινό', en: 'Daily', price: 400, week: 7, month: 30 }],
  REPLY_EVERY_S: 21600,   // το πολύ μία αυτόματη απάντηση ανά email κάθε 6 ώρες
  DUP_S: 600,             // η ίδια ακριβώς αποστολή ξανά μέσα σε 10 λεπτά (διπλό πάτημα) αγνοείται
  SITE: 'https://okpublisher.gr',
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
  r.ref = ref_(d.ref);
  if (dup_('i', r)) return out_({ ok: true });                    // διπλό πάτημα: σιωπηλά τίποτα
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
    sh.appendRow([new Date()].concat([r.name, r.business, r.email, r.phone, r.plan, r.social, r.message, r.lang].map(safe), ['νέο', safe(r.source || '—'), news, r.ref]));
  } finally { lock.releaseLock(); }
  const me = Session.getEffectiveUser().getEmail();
  const replied = autoReply_(r, me);
  if (me) {
    mail_(FORM_.CC_LEAD, me, {
      to: me, replyTo: r.email, name: 'okpublisher.gr',
      subject: '[okpublisher.gr] Νέο ενδιαφέρον: ' + r.business + (r.plan ? ' (' + r.plan + ')' : ''),
      body: ['Όνομα: ' + r.name, 'Επιχείρηση: ' + r.business, 'Email: ' + r.email, 'Τηλέφωνο: ' + (r.phone || '—'),
        'Πακέτο: ' + (r.plan || 'δεν ξέρει ακόμα'), 'Instagram/Facebook: ' + (r.social || '—'), 'Γλώσσα: ' + (r.lang || 'el'),
        'Πηγή: ' + (r.source || '—') + (r.ref ? ' · σύσταση πωλητή (κωδικός ' + r.ref + ')' : ''), 'Νέα/προσφορές με email: ' + (r.news === 'ναι' ? 'ναι (συγκατάθεση)' : 'όχι'), '', r.message || '(χωρίς μήνυμα)',
        '', 'Αυτόματη απάντηση: ' + (replied ? 'στάλθηκε (' + (planOf_(r.plan) ? planOf_(r.plan).el : 'όλα τα πακέτα') + ')' : 'όχι (στάλθηκε ήδη τις τελευταίες 6 ώρες)'),
        'Απάντηση: απλώς «Απάντηση» σε αυτό το email (πάει στον ενδιαφερόμενο).'].join('\n'),
    });
  }
  return out_({ ok: true });
}

function planOf_(name) {
  const n = String(name || '').split(/[ ·]/)[0];
  return FORM_.PLANS.filter(function (p) { return p.el === n || p.en === n; })[0] || null;
}

// Αυτόματη απάντηση στον ενδιαφερόμενο, ανάλογα με το πακέτο. true αν στάλθηκε.
function autoReply_(r, me) {
  const cache = CacheService.getScriptCache();
  const key = 'r:' + r.email.toLowerCase();
  if (cache.get(key)) return false;
  const en = r.lang === 'en', p = planOf_(r.plan);
  const addon = /\[Πρόσθετο: γύρισμα\/μοντάζ reels\]/.test(r.message);
  const first = String(r.name).split(/\s+/)[0];   // μόνο στα αγγλικά (στα ελληνικά η κλητική δεν βγαίνει σωστά αυτόματα)
  const L = [], setupUrl = FORM_.SITE + '/setup.html' + (r.ref ? '?p=' + r.ref : '');
  if (en) {
    L.push('Hello ' + first + ',', '', 'Thank you for your interest in okpublisher!');
    if (p) {
      L.push('Here is what your plan includes.', '', p.en + ' · €' + p.price + ' + VAT a month',
        '• ' + p.week + ' posts and ' + p.week + ' stories a week (about ' + p.month + ' + ' + p.month + ' a month) on Instagram and Facebook');
    } else {
      L.push('Here are our plans.', '');
      FORM_.PLANS.forEach(function (q) { L.push('• ' + q.en + ' · €' + q.price + ' + VAT a month: ' + q.week + ' posts + ' + q.week + ' stories a week'); });
      L.push('', 'All plans include:');
    }
    L.push('• posts, reels and stories made from your own photos and videos', '• one approval a month by email, and a monthly results report',
      '• publishing when most of your followers are online',
      'Not included: ads, replies to messages and comments, or photo shoots.', '',
      'A free week on your page', '3 posts and 3 stories on your Instagram and Facebook, free: no card, no obligation. No setup fee.', '',
      'How we start',
      '1. Fill in the setup form: ' + setupUrl + ' (in Greek; reply to this email if you prefer English).',
      '2. Give us access to your page and create a Google Drive folder with some photos and videos (instructions on the same page).',
      '3. We prepare your free week and send it for your OK. Free weeks run in the middle of the month (setup by the 10th).',
      '4. If you like it, you pay for the first month by card and we start on the 1st. After that the card is charged automatically each month; stop whenever you like, with one email.');
    if (!p) L.push('', 'Not sure which plan fits? Reply with a few words about your business and we will suggest one.');
    if (addon) L.push('', 'For reel filming and editing (add-on) we will send you a separate quote. You provide the idea and the script.');
    L.push('', 'For anything else, just reply to this email.', '', 'okpublisher · One monthly OK. We do the rest.', FORM_.SITE);
  } else {
    L.push('Γεια σας,', '', 'Ευχαριστούμε για το ενδιαφέρον σας για το okpublisher!');
    if (p) {
      L.push('Ορίστε τι περιλαμβάνει το πακέτο που διαλέξατε.', '', p.el + ' · €' + p.price + ' + ΦΠΑ τον μήνα',
        '• ' + p.week + ' posts και ' + p.week + ' stories την εβδομάδα (περίπου ' + p.month + ' + ' + p.month + ' τον μήνα) στο Instagram και στο Facebook');
    } else {
      L.push('Ορίστε τα πακέτα μας.', '');
      FORM_.PLANS.forEach(function (q) { L.push('• ' + q.el + ' · €' + q.price + ' + ΦΠΑ τον μήνα: ' + q.week + ' posts + ' + q.week + ' stories την εβδομάδα'); });
      L.push('', 'Όλα περιλαμβάνουν:');
    }
    L.push('• posts, reels και stories από τις δικές σας φωτογραφίες και βίντεο', '• μία έγκριση τον μήνα με email και μηνιαία αναφορά αποτελεσμάτων',
      '• δημοσίευση τις ώρες που είναι online οι περισσότεροι ακόλουθοί σας',
      'Δεν περιλαμβάνονται διαφημίσεις, απαντήσεις σε μηνύματα και σχόλια, ή φωτογράφιση.', '',
      'Μια δωρεάν εβδομάδα στη σελίδα σας', '3 posts και 3 stories στο Instagram και στο Facebook σας, δωρεάν: χωρίς κάρτα και χωρίς υποχρέωση. Χωρίς κόστος σεταρίσματος.', '',
      'Πώς ξεκινάμε',
      '1. Συμπληρώστε τη φόρμα σεταρίσματος: ' + setupUrl,
      '2. Δώστε μας πρόσβαση στη σελίδα σας και φτιάξτε έναν φάκελο Google Drive με μερικές φωτογραφίες και βίντεο (οδηγίες στην ίδια σελίδα).',
      '3. Ετοιμάζουμε τη δωρεάν εβδομάδα σας και σας τη στέλνουμε για ένα ΟΚ. Οι δωρεάν εβδομάδες γίνονται στα μέσα του μήνα (σετάρισμα έως τις 10).',
      '4. Αν σας αρέσει, πληρώνετε με κάρτα τον 1ο μήνα και ξεκινάμε την 1η. Μετά η κάρτα χρεώνεται αυτόματα κάθε μήνα· σταματάτε όποτε θέλετε, με ένα email.');
    if (!p) L.push('', 'Δεν είστε σίγουροι ποιο πακέτο σας ταιριάζει; Απαντήστε με λίγα λόγια για την επιχείρησή σας και σας προτείνουμε.');
    if (addon) L.push('', 'Για το γύρισμα και μοντάζ reels (πρόσθετο) σας στέλνουμε χωριστή προσφορά. Την ιδέα και το σενάριο τα δίνετε εσείς.');
    L.push('', 'Για οτιδήποτε άλλο, απαντήστε σε αυτό το email.', '', 'okpublisher · Ένα ΟΚ τον μήνα. Τα υπόλοιπα τα κάνουμε εμείς.', FORM_.SITE);
  }
  const subject = en ? 'okpublisher: ' + (p ? 'the ' + p.en + ' plan' : 'our plans') + ' and next steps'
    : 'okpublisher: ' + (p ? 'το πακέτο «' + p.el + '»' : 'τα πακέτα') + ' και τα επόμενα βήματα';
  try {
    MailApp.sendEmail({ to: r.email, subject: subject, body: L.join('\n'), name: 'okpublisher', replyTo: me || undefined });
  } catch (e) { console.error('αυτόματη απάντηση: ' + e.message); return false; }
  cache.put(key, '1', FORM_.REPLY_EVERY_S);
  return true;
}

// Διπλό πάτημα: true αν η ίδια ακριβώς αποστολή ήρθε ήδη τα τελευταία DUP_S δευτερόλεπτα.
// Έλεγχος με κλείδωμα: δύο αιτήματα που φτάνουν μαζί δεν περνούν και τα δύο.
function dup_(kind, obj) {
  const s = JSON.stringify(obj);
  let h = 2166136261;   // FNV-1a 32 bit (αρκεί: συγκρίνουμε μόνο αποστολές των τελευταίων 10 λεπτών)
  for (let i = 0; i < s.length; i++) { h ^= s.charCodeAt(i); h = Math.imul(h, 16777619) >>> 0; }
  const key = 'd:' + kind + ':' + h.toString(36) + ':' + s.length;
  const lock = LockService.getScriptLock();
  lock.tryLock(10000);
  try {
    const cache = CacheService.getScriptCache();
    if (cache.get(key)) return true;
    cache.put(key, '1', FORM_.DUP_S);
    return false;
  } finally { lock.releaseLock(); }
}

// Ιστοσελίδα: κείμενο έως 200, χωρίς κενά, με https:// αν λείπει· αλλιώς κενό.
function siteUrl_(v) {
  let s = clean_(v, 200).replace(/\s+/g, '');
  if (!s) return '';
  if (!/^https?:\/\//i.test(s)) s = 'https://' + s.replace(/^\/+/, '');
  return /^https?:\/\/[^\/\s?#]+\.[^\/\s?#]{2,}/i.test(s) ? s : '';
}
function ref_(v) { const s = String(v == null ? '' : v).trim().toLowerCase(); return FORM_.REF_RE.test(s) ? s : ''; }
function clean_(v, n) { return String(v == null ? '' : v).replace(/[\u0000-\u0008\u000b\u000c\u000e-\u001f]/g, '').trim().slice(0, n); }
function safe_(v) { return /^[=+\-@]/.test(v) ? "'" + v : v; }

// Φόρμα σεταρίσματος νέου πελάτη (setup.html): καρτέλα «Σεταρίσματα» + email στον λογαριασμό του okpublisher.
function setup_(d) {
  const r = {};
  FORM_.SETUP.forEach(function (f) { r[f[0]] = clean_(d[f[0]], f[2]); });
  if (!r.business || !r.name || !r.about || !/^[^@\s]+@[^@\s]+\.[^@\s]+$/.test(r.email)) return out_({ ok: false, error: 'missing fields' });
  const terms = clean_(d.terms, 40);
  if (!FORM_.TERMS_RE.test(terms)) return out_({ ok: false, error: 'terms not accepted' });
  if (dup_('s', d)) return out_({ ok: true });                    // διπλό πάτημα (αλλιώς η 2η γραμμή θα έβγαζε «όχι» στη δωρεάν εβδομάδα)
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
    FORM_.BILL.map(function (f) { return f[1]; }), ['Έλεγχος τιμολόγησης'], FORM_.EXTRA.map(function (f) { return f[1]; }), ['Δωρεάν εβδομάδα', 'Κωδικός πελάτη', 'Σύσταση', 'Ιστοσελίδα']);
  const x = {};
  FORM_.EXTRA.forEach(function (f) { x[f[0]] = clean_(d[f[0]], f[2]); });
  // ΑΦΜ με απόστροφο: αλλιώς το Sheet τον κάνει αριθμό και χάνει τα μηδενικά μπροστά (π.χ. 09…).
  const billCells = FORM_.BILL.map(function (f) { const v = b[f[0]]; return f[0] === 'bill_afm' && v ? "'" + v : safe_(v); });
  let trial = 'ναι', code = '';
  const ref = ref_(d.ref), web = siteUrl_(d.site_url);
  const lock = LockService.getScriptLock();
  lock.tryLock(10000);
  try {
    const sh = sheet_(FORM_.SETUP_SHEET, head);
    trial = trialCheck_(sh, head.indexOf('ΑΦΜ') + 1, b.bill_afm);
    code = clientCode_(sh, head.indexOf('ΑΦΜ') + 1, head.indexOf('Κωδικός πελάτη') + 1, b.bill_afm);
    sh.appendRow([new Date()].concat(FORM_.SETUP.map(function (f) { return safe_(r[f[0]]); }), ['νέο', terms], billCells, [billWarn || 'ΟΚ'],
      FORM_.EXTRA.map(function (f) { return safe_(x[f[0]]); }), [trial, code, ref, safe_(web)]));
  } finally { lock.releaseLock(); }
  const me = Session.getEffectiveUser().getEmail();
  if (me) {
    mail_(FORM_.CC_SETUP, me, {
      to: me, replyTo: r.email, name: 'okpublisher.gr',
      subject: '[okpublisher.gr] Σετάρισμα ' + code + ': ' + r.business + ' (' + (r.plan.split(' ')[0] || '—') + ')',
      body: 'Κωδικός πελάτη: ' + code + '\n' +
        FORM_.SETUP.concat(FORM_.EXTRA).map(function (f) { return f[1] + ': ' + (r[f[0]] || x[f[0]] || '—'); }).join('\n') +
        '\nΌροι: αποδοχή στη φόρμα, έκδοση ' + terms +
        '\n\nΤιμολόγηση:\n' + FORM_.BILL.map(function (f) { return f[1] + ': ' + (b[f[0]] || '—'); }).join('\n') +
        (billWarn ? '\n⚠ ' + billWarn + ': ζήτησέ τα από τον πελάτη πριν από την πρώτη πληρωμή.' : '') +
        '\n\nΔωρεάν εβδομάδα: ' + (trial === 'ναι' ? 'ναι' : '⚠ ' + trial) +
        (ref ? '\nΣύσταση πωλητή: κωδικός ' + ref + ' (ο πωλητής φαίνεται στο διαχειριστικό)' : '') +
        '\nΙστοσελίδα: ' + (web || '—') + (web ? ' (χρώματα/γραμματοσειρές: σε ~1 ώρα στο διαχειριστικό)' : '') +
        '\n\nΕπόμενο: config του πελάτη στο publisher-work (ο Claude), πρόσβαση σελίδας/Instagram, φάκελος Drive, token.',
    });
  }
  return out_({ ok: true });
}

// Μία δωρεάν εβδομάδα ανά ΑΦΜ (όροι Α.4): 'ναι', ή «όχι: …» αν ο ίδιος ΑΦΜ υπάρχει ήδη στα «Σεταρίσματα».
// Δεν απορρίπτει (η σελίδα στέλνει no-cors): το βλέπουμε στη στήλη και στο email και το εφαρμόζουμε στο σετάρισμα.
function trialCheck_(sh, col, afm) {
  if (!afm || col < 1) return 'ναι';
  const last = sh.getLastRow();
  if (last < 2) return 'ναι';
  const vals = sh.getRange(2, col, last - 1, 1).getValues();
  for (let i = 0; i < vals.length; i++) {
    if (String(vals[i][0]).replace(/^'/, '') === afm) return 'όχι: ο ίδιος ΑΦΜ έχει ήδη σετάρισμα (γραμμή ' + (i + 2) + ')';
  }
  return 'ναι';
}

// Κωδικός πελάτη OK-NNNN: ο επόμενος από τον μεγαλύτερο της στήλης (τουλάχιστον FIRST_NO)· ο ίδιος ΑΦΜ → ο ίδιος κωδικός.
function clientCode_(sh, afmCol, codeCol, afm) {
  let max = FORM_.FIRST_NO - 1;
  const last = sh.getLastRow();
  if (last >= 2 && codeCol >= 1) {
    const codes = sh.getRange(2, codeCol, last - 1, 1).getValues();
    const afms = afmCol >= 1 ? sh.getRange(2, afmCol, last - 1, 1).getValues() : [];
    for (let i = 0; i < codes.length; i++) {
      const c = String(codes[i][0]).trim(), m = /^OK-(\d{4,})$/.exec(c);
      if (!m) continue;
      if (afm && afms[i] && String(afms[i][0]).replace(/^'/, '') === afm) return c;
      max = Math.max(max, Number(m[1]));
    }
  }
  return 'OK-' + ('000' + (max + 1)).slice(-Math.max(4, String(max + 1).length));
}

// Email στον λογαριασμό της φόρμας, με αντίγραφο σε όσους ορίζει η ρύθμιση (αν υπάρχουν).
function mail_(setting, me, o) {
  const cc = ccList_(setting, me);
  if (cc) o.cc = cc;
  MailApp.sendEmail(o);
}

// Αντίγραφο (cc) από την καρτέλα «Ρυθμίσεις»: έγκυρα email, όχι ο ίδιος ο λογαριασμός, το πολύ 5. '' αν δεν υπάρχει.
function ccList_(name, me) {
  try {
    const sh = SpreadsheetApp.getActive().getSheetByName(FORM_.SETTINGS_SHEET);
    if (!sh || sh.getLastRow() < 2) return '';
    const rows = sh.getRange(2, 1, sh.getLastRow() - 1, 2).getValues();
    for (let i = 0; i < rows.length; i++) {
      if (String(rows[i][0]).trim() !== name) continue;
      return String(rows[i][1]).split(/[,;\s]+/).map(function (s) { return s.trim().toLowerCase(); })
        .filter(function (s) { return /^[^@\s]+@[^@\s]+\.[^@\s]+$/.test(s) && s !== String(me || '').toLowerCase(); }).slice(0, 5).join(',');
    }
  } catch (e) { console.error('Ρυθμίσεις: ' + e.message); }
  return '';
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
