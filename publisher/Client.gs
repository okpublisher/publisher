/**
 * Σελίδα πελάτη «Ο λογαριασμός μου» (από 27/11/2026): https://okpublisher.gr/client/ (κώδικας στο repo του site, client/),
 * που μιλά με αυτό το web app μέσω JSON (doPost { a: "client", act: … }). Για απευθείας πελάτες και πελάτες πωλητών·
 * ΟΧΙ για πελάτες agency (AGENCY_<K>): αυτοί δεν βλέπουν ποτέ το okpublisher.
 *
 * Σύνδεση: όπως το διαχειριστικό (email → 6ψήφιος κωδικός ΚΑΙ σύνδεσμος, 15′, μία φορά → συνεδρία 30 ημερών), μόνο με το
 *   email εγκρίσεων του πελάτη (NOTIFY_TO_<K>). Ένα email μπορεί να έχει πολλούς πελάτες (π.χ. καταστήματα): η σελίδα
 *   έχει επιλογή. Συνεδρίες: CLI_S_<16 χαρακτήρες από το hash του email> = [{ h: hash κλειδιού, e, x }] (το πολύ 5 ανά email)·
 *   το κλειδί ξεκινά με αυτούς τους 16 χαρακτήρες, ώστε να βρίσκεται η σωστή ιδιότητα.
 *
 * Τι βλέπει: πακέτο/χρέωση (admBilling_), επόμενες και δημοσιευμένες αναρτήσεις, πληρωμές, φάκελο Drive, σύνδεσμο σύστασης,
 *   τα στοιχεία του και το ιστορικό αλλαγών.
 * Τι αλλάζει μόνος του (εφαρμόζεται ΑΜΕΣΩΣ, 27/11/2026· email επιβεβαίωσης στον πελάτη + αντίγραφο στο okpublisher):
 *   - όνομα → NAME_<K> + config.name
 *   - email εγκρίσεων + άλλοι εγκρίνοντες → NOTIFY_TO_<K>, APPROVERS_<K> + config.notify_to / approver_to / approvers
 *     (αλλαγή email: ειδοποίηση ΚΑΙ στο παλιό email· από εκεί και πέρα μπαίνει με το νέο)
 *   - ώρες (auto ή δικές του) → config.times / post_time / story_time · έτοιμα reels → config.ready_reels_mode
 *   - τηλέφωνα, περιοχή, διεύθυνση καταστήματος, ιστοσελίδα, κριτικές, τι κάνει, τι δεν γράφουμε, μουσική → config.profile
 *     (η παραγωγή το διαβάζει και υπερισχύει του rules.md· RUNBOOK §1.5). Ισχύουν από το επόμενο πρόγραμμα.
 *   - πακέτο → planChangeSet_ (ίδιοι κανόνες με το κουμπί του email), μόνο με ενεργή πληρωμένη συνδρομή
 *   - διακοπή συνδρομής → billingStop_ (όροι Α.8)
 * Αιτήματα (θέλουν τον διαχειριστή): νέα σελίδα Facebook/Instagram (πρόσβαση + νέο token), στοιχεία τιμολόγησης, άλλο.
 * Ιστορικό: CLIENT_LOG_<K> = [{ id, at, kind: change|plan|stop|request, title, lines[], status: new|done }] (το πολύ 40)·
 *   το δείχνει και το διαχειριστικό («Από τον πελάτη», «Έγινε» για τα αιτήματα).
 * Email καλωσορίσματος (από 27/11/2026, cliWelcome_ στον ωριαίο κύκλο πληρωμών): σε κάθε νέο σετάρισμα (από τη φόρμα, είτε
 *   το συμπλήρωσε ο πελάτης είτε εμείς) → μία φορά στο email εγκρίσεων: λάβαμε, τι ακολουθεί, και η σελίδα «Ο λογαριασμός μου».
 *   ΟΧΙ για σετάρισμα agency (σύσταση = κωδικός agency ή email agency). Ποια στάλθηκαν: CLIENT_WELCOMED = { κωδικός|email: χρόνος }.
 *   Σύνδεση πριν ενεργοποιηθεί ο πελάτης (σετάρισμα χωρίς NOTIFY_TO ακόμα): email «ολοκληρώνουμε το σετάρισμα» αντί για κωδικό.
 * Καμία δημόσια συνάρτηση (όλες με «_») και καμία νέα άδεια Google.
 */
const CLI_ = {
  SITE: 'https://okpublisher.gr/client/',
  SESSION_DAYS: 30,
  LOGIN_TTL_S: 900,
  PIN_TRIES: 5,
  SESS_PER_EMAIL: 5,
  LOG_MAX: 40,
  REQ_PER_DAY: 10,
  LOGIN_MSG: 'Αν το email είναι email πελάτη μας, σας στείλαμε κωδικό. Ισχύει 15 λεπτά.',
  TIME_RE: /^([01]\d|2[0-3]):[0-5]\d$/,
  REELS: { fill_reel_slots_then_posts_then_next_month: 'Στη θέση των δικών μας reels, ό,τι περισσεύει τον επόμενο μήνα',
    all_in_month: 'Όλα μέσα στον ίδιο μήνα, με περισσότερες δημοσιεύσεις' },
  MUSIC: ['αφήστε το σε εμάς', 'Ήρεμη', 'Ζωντανή', 'Κομψή', 'Χαρούμενη', 'Χωρίς μουσική'],
  // [πεδίο, ετικέτα, μέγιστο μήκος] των ελεύθερων στοιχείων (config.profile)
  PROFILE: [['phones', 'Τηλέφωνα στα posts', 120], ['area', 'Περιοχή', 200], ['shop_address', 'Διεύθυνση καταστήματος', 200],
    ['website', 'Ιστοσελίδα', 200], ['reviews', 'Κριτικές Google', 300], ['about', 'Τι κάνει η επιχείρηση', 3000],
    ['avoid', 'Τι ΔΕΝ γράφουμε', 3000], ['music', 'Μουσική στα reels', 40]],
  MAX_APPROVERS: 5,
  WELCOME_FROM: '27/11/2026 19:00:00',   // σεταρίσματα πριν από εδώ δεν παίρνουν email καλωσορίσματος (ώρα Ελλάδας, όπως στο Sheet)
  WELCOME_MAX: 300,
};

// ------------------------------------------------------------------ ποιοι πελάτες ανήκουν σε ένα email
function cliEmails_(v) { return String(v || '').split(/[,;\s]+/).map(admEmail_).filter(Boolean); }
function cliClientsOf_(email) {
  const e = admEmail_(email);
  if (!e) return [];
  return approvalClients_().filter(function (K) { return !agencyOf_(K) && cliEmails_(cprop_(K, 'NOTIFY_TO', '')).indexOf(e) >= 0; });
}

// ------------------------------------------------------------------ συνεδρίες
function cliSessKey_(prefix) { return 'CLI_S_' + prefix; }
function cliSessions_(prefix) {
  let a = [];
  try { a = JSON.parse(prop_(cliSessKey_(prefix), '[]')) || []; } catch (e) { a = []; }
  const now = Date.now();
  return (Array.isArray(a) ? a : []).filter(function (s) { return s && s.x > now; });
}
function cliNewSession_(e) {
  const prefix = admHash_(e).slice(0, 16), token = prefix + admRandom_().slice(0, 48);
  const lock = LockService.getScriptLock();
  lock.tryLock(10000);
  try {
    const list = cliSessions_(prefix).concat([{ h: admHash_(token), e: e, x: Date.now() + CLI_.SESSION_DAYS * 86400000 }])
      .sort(function (a, b) { return b.x - a.x; }).slice(0, CLI_.SESS_PER_EMAIL);
    P_().setProperty(cliSessKey_(prefix), JSON.stringify(list));
  } finally { lock.releaseLock(); }
  return token;
}
// { email, clients: [K…] } ή σφάλμα «login» (η σελίδα δείχνει ξανά τη σύνδεση).
function cliSession_(token) {
  const t = admTok_(token);
  if (!t) throw new Error('login');
  const h = admHash_(t), rec = cliSessions_(t.slice(0, 16)).filter(function (s) { return s.h === h; })[0];
  if (!rec) throw new Error('login');
  const clients = cliClientsOf_(rec.e);
  if (!clients.length) throw new Error('login');
  return { email: rec.e, clients: clients };
}
function cliLogout_(token) {
  const t = admTok_(token);
  if (!t) return;
  const h = admHash_(t), prefix = t.slice(0, 16);
  P_().setProperty(cliSessKey_(prefix), JSON.stringify(cliSessions_(prefix).filter(function (s) { return s.h !== h; })));
}

// ------------------------------------------------------------------ σύνδεση (όπως το διαχειριστικό, χωριστά κλειδιά cache)
function cliLogin_(email) {
  const e = admEmail_(email);
  if (!e) return CLI_.LOGIN_MSG;
  const c = CacheService.getScriptCache();
  const ke = 'cli:rl:' + admHash_(e).slice(0, 16), n = Number(c.get(ke) || 0), g = Number(c.get('cli:rl') || 0);
  if (n >= 3 || g >= 60) return CLI_.LOGIN_MSG;              // όριο: 3 ανά email / 15′, 60 συνολικά / ώρα
  c.put(ke, String(n + 1), 900);
  c.put('cli:rl', String(g + 1), 3600);
  if (!cliClientsOf_(e).length) {                           // η ίδια απάντηση: δεν φαίνεται ποια email είναι πελάτες
    const s = cliPending_(e);
    if (s) {
      MailApp.sendEmail({ to: e, name: CFG.SENDER_NAME, subject: 'Ο λογαριασμός σας στο okpublisher ενεργοποιείται σύντομα',
        body: 'Λάβαμε το σετάρισμα για «' + s.business + '» και το ολοκληρώνουμε. Μόλις γίνει, μπαίνετε στο ' + CLI_.SITE +
          ' με αυτό το email (' + e + ') και βλέπετε τα πάντα. Θα σας γράψουμε.\n\nΓια οτιδήποτε, απαντήστε σε αυτό το email.' });
    }
    return CLI_.LOGIN_MSG;
  }
  const code = admRandom_(), pin = admPin_();
  c.put('cli:code:' + admHash_(code), e, CLI_.LOGIN_TTL_S);
  c.put('cli:pin:' + admHash_(e), JSON.stringify({ h: admHash_(e + '|' + pin), n: 0 }), CLI_.LOGIN_TTL_S);
  const link = CLI_.SITE + '#t=' + code;
  MailApp.sendEmail({
    to: e, name: CFG.SENDER_NAME, subject: 'Κωδικός ' + pin + ' για τον λογαριασμό σας στο okpublisher',
    body: 'Ο κωδικός σας: ' + pin + '\n\nΓράψτε τον στη σελίδα «Ο λογαριασμός μου», ή ανοίξτε τον σύνδεσμο:\n' + link +
      '\n\nΙσχύει 15 λεπτά και μία φορά. Αν δεν το ζητήσατε εσείς, αγνοήστε αυτό το email.',
    htmlBody: '<div style="font:15px/1.6 Arial,sans-serif;color:#14162E">Ο κωδικός σας για τον λογαριασμό σας στο okpublisher:' +
      '<p style="font:bold 32px/1.2 Arial,sans-serif;letter-spacing:6px;color:#5B21D6;margin:18px 0">' + pin + '</p>' +
      '<p>Γράψτε τον στη σελίδα, ή <a href="' + esc_(link) + '">ανοίξτε τον σύνδεσμο</a>.</p>' +
      '<p style="color:#4A4C66">Ισχύει 15 λεπτά και μία φορά. Αν δεν το ζητήσατε εσείς, αγνοήστε αυτό το email.</p></div>',
  });
  return CLI_.LOGIN_MSG;
}
function cliPinLogin_(email, pin) {
  const e = admEmail_(email), bad = 'Λάθος ή ληγμένος κωδικός. Ζητήστε νέο.';
  pin = String(pin || '').replace(/\s/g, '');
  if (!e || !/^\d{6}$/.test(pin)) throw new Error(bad);
  const c = CacheService.getScriptCache(), k = 'cli:pin:' + admHash_(e);
  let rec = null;
  try { rec = JSON.parse(c.get(k) || 'null'); } catch (x) { rec = null; }
  if (!rec || rec.n >= CLI_.PIN_TRIES) throw new Error(bad);
  if (rec.h !== admHash_(e + '|' + pin)) { rec.n++; c.put(k, JSON.stringify(rec), CLI_.LOGIN_TTL_S); throw new Error(bad); }
  c.remove(k);
  if (!cliClientsOf_(e).length) throw new Error(bad);
  return cliNewSession_(e);
}
function cliExchange_(code) {
  const t = admTok_(code), bad = 'Ο σύνδεσμος δεν ισχύει πια. Ζητήστε νέο με το email σας.';
  if (!t) throw new Error(bad);
  const c = CacheService.getScriptCache(), k = 'cli:code:' + admHash_(t), e = c.get(k);
  if (!e) throw new Error(bad);
  c.remove(k);
  c.remove('cli:pin:' + admHash_(e));
  if (!cliClientsOf_(e).length) throw new Error(bad);
  return cliNewSession_(e);
}

// ------------------------------------------------------------------ στοιχεία πελάτη
function cliPick_(me, K) {
  K = String(K || '').toUpperCase();
  if (!K) return me.clients[0];
  if (me.clients.indexOf(K) < 0) throw new Error('login');
  return K;
}
function cliCfg_(K) { return ghJson_('clients/' + K + '/config.json') || {}; }
// Η πιο πρόσφατη γραμμή σεταρίσματος με τον κωδικό του πελάτη (αρχικές τιμές όσων δεν έχει αλλάξει ακόμα).
function cliSetup_(code) {
  if (!code) return {};
  try { return admLeads_().setups.filter(function (s) { return s.code === code; })[0] || {}; } catch (e) { return {}; }
}
function cliMusic_(v) {
  v = String(v || '').trim();
  const hit = CLI_.MUSIC.filter(function (m) { return m.toLowerCase() === v.toLowerCase(); })[0];
  return hit || CLI_.MUSIC[0];
}
// Οι τρέχουσες τιμές όσων αλλάζει ο πελάτης.
function cliProfile_(K, cfg, s) {
  const pr = cfg.profile || {}, main = cliEmails_(cprop_(K, 'NOTIFY_TO', ''))[0] || '';
  const v = function (k, d) { return pr[k] !== undefined && pr[k] !== null ? String(pr[k]) : String(d == null ? '' : d); };
  // Άλλοι εγκρίνοντες: του config (αν έχει γραφτεί), αλλιώς της φόρμας σεταρίσματος.
  const others = (Array.isArray(cfg.approvers) ? cfg.approvers : cliEmails_(s.approvers))
    .map(admEmail_).filter(function (x, i, a) { return x && x !== main && a.indexOf(x) === i; }).slice(0, CLI_.MAX_APPROVERS);
  const nm = clientName_(K);
  return {
    name: nm !== K ? nm : String(cfg.name || s.business || K), email: main, approvers: others,
    phones: v('phones', s.phones), area: v('area', s.address), shop_address: v('shop_address', s.shop_address),
    website: v('website', s.website), reviews: v('reviews', s.reviews), about: v('about', s.about), avoid: v('avoid', s.rules),
    music: cliMusic_(v('music', s.music)),
    times: cfg.times === 'auto' || (!cfg.times && !cfg.post_time) ? 'auto' : 'custom',
    post_time: CLI_.TIME_RE.test(String(cfg.post_time || '')) ? String(cfg.post_time) : '',
    story_time: CLI_.TIME_RE.test(String(cfg.story_time || '')) ? String(cfg.story_time) : '',
    reels: CLI_.REELS[cfg.ready_reels_mode] ? cfg.ready_reels_mode : 'fill_reel_slots_then_posts_then_next_month',
  };
}

function cliData_(token, K) {
  const me = cliSession_(token);
  K = String(K || '').toUpperCase();
  if (me.clients.indexOf(K) < 0) K = me.clients[0];   // π.χ. αποθηκευμένος πελάτης άλλου email στη συσκευή
  const out = { email: me.email, now: new Date().toISOString(), errors: [],
    clients: me.clients.map(function (x) { return { key: x, name: clientName_(x) }; }),
    plans: BILL_.PLANS.map(function (p) { return { name: p.name, net: p.net, week: p.week, eur: euros_(planCents_(p)) }; }),
    music: CLI_.MUSIC, reels: CLI_.REELS };
  let cfg = {};
  try { cfg = cliCfg_(K); } catch (e) { out.errors.push('Στοιχεία: ' + e.message); }
  const s = cliSetup_(cfg.code);
  const c = { key: K, code: String(cfg.code || ''), profile: cliProfile_(K, cfg, s),
    accounts: { instagram: String((cfg.accounts && cfg.accounts.instagram) || s.instagram || ''),
      facebook: String((cfg.accounts && cfg.accounts.facebook_page) || s.facebook || '') },
    bill: { name: String(s.bill_name || ''), afm: String(s.afm || ''), doy: String(s.bill_doy || ''), address: String(s.bill_address || '') },
    free: cfg.billing && cfg.billing.type === 'free' ? { until: String(cfg.billing.until || '') } : null,
    package: String(cfg.package || ''), paused: cprop_(K, 'PAUSED', 'false') === 'true' || billPaused_(K) };
  try { c.billing = admBilling_(K); } catch (e) { c.billing = null; out.errors.push('Συνδρομή: ' + e.message); }
  const ps = planStateOf_(K);
  c.plan_change = { state: ps.state, from_label: ps.from ? perShort_(ps.st, ps.from) : '', from_for: ps.from ? perFor_(ps.st, ps.from) : '' };
  const cs = cancelStateOf_(K);
  c.stop = { state: cs.state, after_label: cs.after ? perShort_(cs.st, cs.after) : '', after_for: cs.after ? perFor_(cs.st, cs.after) : '' };
  const fid = folderId_(K);
  c.folder = /^[A-Za-z0-9_-]{10,}$/.test(fid) ? 'https://drive.google.com/drive/folders/' + fid : '';
  try { c.referral = { link: referralLink_(K), credit_eur: referralCredit_(K) / 100, count: Number(cprop_(K, 'REFERRAL_COUNT', '0')) || 0, unit_eur: REFERRAL_.CENTS / 100 }; }
  catch (e) { c.referral = null; }
  c.log = cliLog_(K).slice(0, 20);
  const seen = function (x) { return String(x) === K; };
  try {
    const q = admSheet_('Ουρά'), now = Date.now();
    const rows = q.slice(1).filter(function (r) { return String(r[0]) === K; }).map(function (r) {
      return { client: K, at: admIso_(r[1]), type: String(r[2] || ''), caption: String(r[3] || '').slice(0, 160),
        ig: String(r[5] || ''), ig_link: String(r[6] || ''), fb: String(r[7] || ''), fb_link: String(r[8] || ''), id: String(r[9] || '') };
    });
    c.upcoming = rows.filter(function (p) { const t = new Date(p.at).getTime(); return t >= now - 3600000 && !/Δημοσιεύτηκε/.test(p.ig + p.fb); })
      .sort(function (a, b) { return a.at < b.at ? -1 : 1; }).slice(0, 40)
      .map(function (p) { return { at: p.at, type: p.type, caption: p.caption }; });
    const P = admPublished_(admSheet_('Ιστορικό'), rows, seen);
    c.published = P.published.slice(0, 60).map(function (p) {
      return { at: p.at, type: p.type, caption: p.caption || '', ig: p.ig && p.ig.link ? p.ig.link : '', fb: p.fb && p.fb.link ? p.fb.link : '' };
    });
  } catch (e) { c.upcoming = []; c.published = []; out.errors.push('Δημοσιεύσεις: ' + e.message); }
  try {
    const st = billState_(K) || {};
    c.payments = admSheet_(BILL_.SHEET).slice(1).filter(function (r) { return String(r[1]) === K && String(r[5]) === 'πληρώθηκε'; })
      .reverse().slice(0, 36).map(function (r) {
        const m = String(r[2] || '');
        return { at: admIso_(r[0]), period: /^\d{4}-\d{2}$/.test(m) ? perShort_(st, m) : m, amount: r[3] === '' ? '' : Number(r[3]),
          pay: String(r[7] || ''), plan: String(r[10] || '') };
      });
  } catch (e) { c.payments = []; out.errors.push('Πληρωμές: ' + e.message); }
  out.client = c;
  return out;
}

// ------------------------------------------------------------------ ιστορικό
function cliLog_(K) {
  try { const a = JSON.parse(prop_('CLIENT_LOG_' + K, '[]')); return Array.isArray(a) ? a : []; } catch (e) { return []; }
}
function cliLogAdd_(K, kind, title, lines, by) {
  const lock = LockService.getScriptLock();
  lock.tryLock(10000);
  try {
    const a = cliLog_(K), id = Utilities.getUuid().replace(/-/g, '').slice(0, 10);
    a.unshift({ id: id, at: new Date().toISOString(), kind: kind, title: String(title).slice(0, 120),
      lines: (lines || []).map(function (l) { return String(l).slice(0, 300); }).slice(0, 15), by: String(by || ''), status: kind === 'request' ? 'new' : 'done' });
    let out = a.slice(0, CLI_.LOG_MAX), json = JSON.stringify(out);
    while (json.length > 8500 && out.length > 5) { out = out.slice(0, out.length - 1); json = JSON.stringify(out); }   // όριο ιδιότητας 9 KB
    P_().setProperty('CLIENT_LOG_' + K, json);
    return id;
  } finally { lock.releaseLock(); }
}

// ------------------------------------------------------------------ αλλαγές στοιχείων (άμεσα)
// ΑΦΜ (ίδιοι κανόνες με τη φόρμα): χωρίς κενά/τελείες/παύλες/EL· 9 ψηφία με ψηφίο ελέγχου.
function cliAfm_(v) { return String(v || '').replace(/[\s.\-]/g, '').replace(/^(EL|GR)/i, ''); }
function cliAfmOk_(a) {
  if (!/^\d{9}$/.test(a) || a === '000000000') return false;
  let s = 0;
  for (let i = 0; i < 8; i++) s += Number(a.charAt(i)) * Math.pow(2, 8 - i);
  return (s % 11) % 10 === Number(a.charAt(8));
}
function cliClean_(v, n) { return String(v == null ? '' : v).replace(/[\u0000-\u0008\u000b\u000c\u000e-\u001f]/g, '').trim().slice(0, n); }
function cliSite_(v) {
  let s = cliClean_(v, 200).replace(/\s+/g, '');
  if (!s) return '';
  if (!/^https?:\/\//i.test(s)) s = 'https://' + s.replace(/^\/+/, '');
  if (!/^https?:\/\/[^\/\s?#]+\.[^\/\s?#]{2,}/i.test(s)) throw new Error('Η ιστοσελίδα δεν φαίνεται σωστή (π.χ. www.epixeirisi.gr).');
  return s;
}

function cliSave_(token, K, f) {
  const me = cliSession_(token);
  K = cliPick_(me, K);
  f = f || {};
  const lock = LockService.getUserLock();
  if (!lock.tryLock(20000)) throw new Error('Μια στιγμή: γίνεται ήδη αλλαγή. Δοκιμάστε ξανά.');
  try {
    const cfg = cliCfg_(K), cur = cliProfile_(K, cfg, cliSetup_(cfg.code)), nu = JSON.parse(JSON.stringify(cur));
    if ('name' in f) {
      nu.name = cliClean_(f.name, 120);
      if (nu.name.length < 2) throw new Error('Γράψτε το όνομα της επιχείρησης.');
    }
    if ('email' in f) {
      nu.email = admEmail_(f.email);
      if (!nu.email) throw new Error('Το email εγκρίσεων δεν φαίνεται σωστό.');
    }
    if ('approvers' in f) {
      const raw = Array.isArray(f.approvers) ? f.approvers.join(',') : String(f.approvers || '');
      const bad = raw.split(/[,;\s]+/).filter(function (x) { return x && !admEmail_(x); });
      if (bad.length) throw new Error('Δεν φαίνεται σωστό email: ' + cliClean_(bad[0], 80));
      nu.approvers = cliEmails_(raw).filter(function (x, i, a) { return x !== nu.email && a.indexOf(x) === i; });
      if (nu.approvers.length > CLI_.MAX_APPROVERS) throw new Error('Το πολύ ' + CLI_.MAX_APPROVERS + ' άλλα email.');
    } else nu.approvers = nu.approvers.filter(function (x) { return x !== nu.email; });
    CLI_.PROFILE.forEach(function (p) { if (p[0] in f) nu[p[0]] = cliClean_(f[p[0]], p[2]); });
    if ('website' in f) nu.website = cliSite_(f.website);
    if ('reviews' in f && nu.reviews && !/^https:\/\/\S+$/.test(nu.reviews)) throw new Error('Ο σύνδεσμος για τις κριτικές πρέπει να ξεκινά με https://');
    if ('about' in f && nu.about.length < 3) throw new Error('Γράψτε λίγα λόγια για το τι κάνει η επιχείρηση.');
    if ('music' in f) nu.music = cliMusic_(f.music);
    if ('times' in f) {
      nu.times = f.times === 'custom' ? 'custom' : 'auto';
      if (nu.times === 'custom') {
        nu.post_time = cliClean_(f.post_time, 5); nu.story_time = cliClean_(f.story_time, 5);
        if (!CLI_.TIME_RE.test(nu.post_time) || !CLI_.TIME_RE.test(nu.story_time)) throw new Error('Γράψτε τις ώρες ως ΩΩ:ΛΛ (π.χ. 19:00).');
      }
    }
    if ('reels' in f) {
      if (!CLI_.REELS[f.reels]) throw new Error('Άγνωστη επιλογή για τα έτοιμα reels.');
      nu.reels = f.reels;
    }
    // Τι άλλαξε (με ετικέτες για τα email και το ιστορικό).
    const L = { name: 'Όνομα', email: 'Email εγκρίσεων', approvers: 'Άλλα email εγκρίσεων', times: 'Ώρες', reels: 'Έτοιμα reels' };
    CLI_.PROFILE.forEach(function (p) { L[p[0]] = p[1]; });
    const show = function (k, o) {
      if (k === 'approvers') return o.approvers.join(', ') || '—';
      if (k === 'times') return o.times === 'auto' ? 'αυτόματες' : 'posts ' + o.post_time + ', stories ' + o.story_time;
      if (k === 'reels') return CLI_.REELS[o.reels];
      const t = String(o[k] || '');
      return t ? (t.length > 140 ? t.slice(0, 140) + '…' : t) : '—';
    };
    const changed = Object.keys(L).filter(function (k) {
      if (k === 'times') return nu.times !== cur.times || (nu.times === 'custom' && (nu.post_time !== cur.post_time || nu.story_time !== cur.story_time));
      return JSON.stringify(nu[k]) !== JSON.stringify(cur[k]);
    });
    if (!changed.length) return { message: 'Δεν άλλαξε τίποτα.' };
    const lines = changed.map(function (k) { return L[k] + ': ' + show(k, nu); });

    // Εφαρμογή: πρώτα το config στο publisher-work (αν αποτύχει, δεν αλλάζει τίποτα), μετά οι ρυθμίσεις του script.
    const prof = Object.assign({}, cfg.profile || {});
    CLI_.PROFILE.forEach(function (p) { if (changed.indexOf(p[0]) >= 0) prof[p[0]] = nu[p[0]]; });
    prof.updated_at = new Date().toISOString();
    prof.note = 'Από τη σελίδα πελάτη (Client.gs): υπερισχύει του rules.md (RUNBOOK §1.5).';
    cfg.profile = prof;
    if (changed.indexOf('name') >= 0) cfg.name = nu.name;
    const mailChanged = changed.indexOf('email') >= 0, apprChanged = mailChanged || changed.indexOf('approvers') >= 0;
    if (apprChanged) { cfg.notify_to = nu.email; cfg.approver_to = nu.email; cfg.approvers = [nu.email].concat(nu.approvers); }
    if (changed.indexOf('times') >= 0) {
      cfg.times = nu.times === 'auto' ? 'auto' : 'manual';
      if (nu.times === 'custom') { cfg.post_time = nu.post_time; cfg.story_time = nu.story_time; }
    }
    if (changed.indexOf('reels') >= 0) cfg.ready_reels_mode = nu.reels;
    ghPutJson_('clients/' + K + '/config.json', cfg, 'Σελίδα πελάτη: ' + K + ' ' + changed.join(', '));
    try { CacheService.getScriptCache().remove(ADM_.CLIENTS_KEY); } catch (e) { /* μένει 5′ */ }
    if (changed.indexOf('name') >= 0) P_().setProperty('NAME_' + K, nu.name);
    if (apprChanged) {
      P_().setProperty('NOTIFY_TO_' + K, nu.email);
      P_().setProperty('APPROVERS_' + K, [nu.email].concat(nu.approvers).join(','));
    }
    cliLogAdd_(K, 'change', 'Αλλαγή στοιχείων', lines, me.email);
    const when = changed.some(function (k) { return ['name', 'email', 'approvers'].indexOf(k) < 0; })
      ? '\n\nΌσα αφορούν τις δημοσιεύσεις ισχύουν από το επόμενο πρόγραμμα που θα σας στείλουμε για έγκριση.' : '';
    notify_(K, 'Αλλάξαμε τα στοιχεία σας', 'Ενημερώσαμε τα στοιχεία σας όπως τα αλλάξατε στη σελίδα «Ο λογαριασμός μου»:\n\n' +
      lines.map(function (l) { return '• ' + l; }).join('\n') + when + '\n\nΑν δεν το κάνατε εσείς, απαντήστε αμέσως σε αυτό το email.\n\n' + CLI_.SITE);
    if (mailChanged && cur.email) {
      try {
        MailApp.sendEmail({ to: cur.email, name: CFG.SENDER_NAME, subject: '[' + clientName_(K) + '] Άλλαξε το email του λογαριασμού σας',
          body: 'Το email εγκρίσεων και σύνδεσης του λογαριασμού σας στο okpublisher άλλαξε σε ' + nu.email + '.\n\n' +
            'Αν δεν το κάνατε εσείς, απαντήστε αμέσως σε αυτό το email.' });
      } catch (e) { console.error('email στο παλιό: ' + e.message); }
    }
    systemNotify_('Σελίδα πελάτη: ' + admWho_(K, cfg), 'Ο πελάτης άλλαξε μόνος του (' + me.email + '):\n\n' +
      changed.map(function (k) { return '• ' + L[k] + ': ' + show(k, cur) + ' → ' + show(k, nu); }).join('\n') +
      '\n\nΕφαρμόστηκαν ήδη (config.json' + (apprChanged || changed.indexOf('name') >= 0 ? ' και ρυθμίσεις του script' : '') + '). ' +
      'Η παραγωγή διαβάζει το config.profile (RUNBOOK §1.5).');
    const relogin = mailChanged && me.email === cur.email && cliClientsOf_(me.email).length === 0;
    return { message: 'Αποθηκεύτηκε.' + (relogin ? ' Από εδώ και πέρα μπαίνετε με το ' + nu.email + '.' : ''), relogin: relogin };
  } finally { lock.releaseLock(); }
}

// ------------------------------------------------------------------ πακέτο και διακοπή (ίδιοι κανόνες με τα κουμπιά του email)
function cliPlan_(token, K, plan) {
  const me = cliSession_(token);
  K = cliPick_(me, K);
  const lock = LockService.getUserLock();
  if (!lock.tryLock(20000)) throw new Error('Μια στιγμή: γίνεται ήδη αλλαγή. Δοκιμάστε ξανά.');
  try {
    const i = planStateOf_(K), p = planOf_(plan);
    if (!p) throw new Error('Άγνωστο πακέτο.');
    if (i.state === 'unpaid') throw new Error('Υπάρχει πληρωμή σε εκκρεμότητα: μόλις γίνει, μπορείτε να αλλάξετε πακέτο.');
    if (i.state === 'ends') throw new Error('Η συνδρομή σας σταματά, οπότε δεν αλλάζει πακέτο. Γράψτε μας αν θέλετε να συνεχίσουμε.');
    if (i.state !== 'active') throw new Error('Δεν υπάρχει ενεργή συνδρομή για αλλαγή πακέτου. Γράψτε μας στο okpublisher.gr@gmail.com.');
    const prev = i.st.change ? i.st.change.plan : i.st.plan;
    const r = planChangeSet_(K, i.st, p, i.from, 'από τον πελάτη, σελίδα πελάτη (' + me.email + ')');
    if (r === 'same') return { message: 'Αυτό είναι ήδη το πακέτο σας: δεν αλλάζει τίποτα.' };
    if (r === 'cancelled') {
      cliLogAdd_(K, 'plan', 'Ακύρωση αλλαγής πακέτου', ['Μένει ' + i.st.plan + ' (είχε ζητηθεί ' + prev + ')'], me.email);
      return { message: 'Έγινε: μένετε στο ' + i.st.plan + '. Σας στείλαμε email επιβεβαίωσης.' };
    }
    const lbl = perFor_(i.st, i.from);
    cliLogAdd_(K, 'plan', 'Αλλαγή πακέτου', [i.st.plan + ' → ' + p.name + ' από ' + lbl], me.email);
    return { message: 'Έγινε: από ' + lbl + ' το πακέτο σας γίνεται ' + p.name + ' (€' + euros_(i.st.change.amount) +
      ' τον μήνα με ΦΠΑ). Σας στείλαμε email επιβεβαίωσης.' };
  } finally { lock.releaseLock(); }
}

function cliStop_(token, K) {
  const me = cliSession_(token);
  K = cliPick_(me, K);
  const lock = LockService.getUserLock();
  if (!lock.tryLock(20000)) throw new Error('Μια στιγμή: γίνεται ήδη αλλαγή. Δοκιμάστε ξανά.');
  try {
    const i = cancelStateOf_(K);
    if (i.state === 'stopped') return { message: 'Η συνδρομή σας σταματά ήδη μετά ' + perFor_(i.st, i.after) + '.' };
    if (i.state !== 'active') throw new Error('Δεν βρέθηκε ενεργή συνδρομή. Γράψτε μας στο okpublisher.gr@gmail.com.');
    billingStop_(K, i.st, i.after, false, 'σελίδα πελάτη');
    systemNotify_('Διακοπή συνδρομής: ' + K, 'Ο πελάτης ' + K + ' (' + i.st.plan + ') διέκοψε τη συνδρομή από τη σελίδα πελάτη (' + me.email + '). ' +
      'Τελευταία περίοδος: ' + perShort_(i.st, i.after) + '. Μετά: αφαίρεση πρόσβασης και διαγραφή δεδομένων σε 30 ημέρες (όροι Β.11).');
    cliLogAdd_(K, 'stop', 'Διακοπή συνδρομής', ['Τελευταία περίοδος: ' + perShort_(i.st, i.after)], me.email);
    return { message: 'Έγινε: η συνδρομή σας σταματά μετά ' + perFor_(i.st, i.after) + '. Ως τότε οι δημοσιεύσεις συνεχίζονται ' +
      'και δεν θα γίνει καμία άλλη χρέωση. Σας στείλαμε email επιβεβαίωσης.' };
  } finally { lock.releaseLock(); }
}

// ------------------------------------------------------------------ αιτήματα (θέλουν τον διαχειριστή)
function cliRequest_(token, K, kind, d) {
  const me = cliSession_(token);
  K = cliPick_(me, K);
  d = d || {};
  const c = CacheService.getScriptCache(), rk = 'cli:req:' + K, n = Number(c.get(rk) || 0);
  if (n >= CLI_.REQ_PER_DAY) throw new Error('Πολλά αιτήματα σήμερα. Γράψτε μας στο okpublisher.gr@gmail.com.');
  let title, lines, next;
  if (kind === 'page') {
    const fb = cliClean_(d.facebook, 200), ig = cliClean_(d.instagram, 120), note = cliClean_(d.note, 1000);
    if (!fb && !ig) throw new Error('Γράψτε τη νέα σελίδα Facebook ή το νέο Instagram.');
    title = 'Νέα σελίδα Facebook / Instagram';
    lines = ['Facebook: ' + (fb || '—'), 'Instagram: ' + (ig || '—')].concat(note ? ['Σημείωση: ' + note] : []);
    next = 'Επόμενο: ο πελάτης δίνει πρόσβαση στη νέα σελίδα (Partners, portfolio OK Publisher)· μετά νέο TOKEN_' + K +
      ', IG_USER_' + K + ', FB_PAGE_' + K + ' (διαχειριστής) και config.accounts. Ως τότε οι δημοσιεύσεις πάνε στην παλιά.';
  } else if (kind === 'billing') {
    const b = { name: cliClean_(d.name, 200), afm: cliAfm_(cliClean_(d.afm, 30)), doy: cliClean_(d.doy, 80), address: cliClean_(d.address, 200) };
    if (!b.name || !b.afm || !b.doy || !b.address) throw new Error('Συμπληρώστε επωνυμία, ΑΦΜ, ΔΟΥ και διεύθυνση.');
    if (!cliAfmOk_(b.afm)) throw new Error('Ο ΑΦΜ δεν φαίνεται σωστός (9 ψηφία).');
    title = 'Νέα στοιχεία τιμολόγησης';
    lines = ['Επωνυμία: ' + b.name, 'ΑΦΜ: ' + b.afm, 'ΔΟΥ: ' + b.doy, 'Διεύθυνση: ' + b.address];
    next = 'Επόμενο: ενημέρωση στο Epsilon Smart, από το επόμενο παραστατικό.';
  } else if (kind === 'other') {
    const msg = cliClean_(d.message, 2000);
    if (msg.length < 3) throw new Error('Γράψτε τι θέλετε να αλλάξουμε.');
    title = 'Άλλο αίτημα';
    lines = [msg];
    next = 'Απάντηση: απλώς «Απάντηση» στο email του πελάτη.';
  } else throw new Error('Άγνωστο αίτημα.');
  c.put(rk, String(n + 1), 86400);
  cliLogAdd_(K, 'request', title, lines, me.email);
  const who = (function () { try { return admWho_(K, cliCfg_(K)); } catch (e) { return clientName_(K) + ' (' + K + ')'; } })();
  systemNotify_('Αίτημα πελάτη: ' + who + ' · ' + title, 'Από τη σελίδα πελάτη (' + me.email + '):\n\n' + lines.join('\n') + '\n\n' + next +
    '\n\nΣτο διαχειριστικό: Πελάτες → ' + K + ' → «Από τον πελάτη» → «Έγινε» όταν τελειώσει.');
  notify_(K, 'Λάβαμε το αίτημά σας: ' + title, 'Λάβαμε το αίτημά σας:\n\n' + lines.join('\n') + '\n\n' +
    (kind === 'page' ? 'Για να δημοσιεύουμε στη νέα σελίδα, δώστε μας πρόσβαση σε αυτήν όπως στο σετάρισμα (βήμα 2): ' +
      'https://okpublisher.gr/setup.html#form — Ως τότε οι δημοσιεύσεις συνεχίζουν στην τωρινή σελίδα.\n\n' : '') +
    'Θα σας γράψουμε μόλις γίνει. Για οτιδήποτε, απαντήστε σε αυτό το email.');
  return { message: 'Στάλθηκε. Θα σας γράψουμε μόλις γίνει.' };
}

// Διαχειριστικό: «Έγινε» σε αίτημα πελάτη (μόνο admin).
function admClientLogDone_(token, K, id) {
  const me = admSession_(token);
  admNeedAdmin_(me);
  K = String(K || '').toUpperCase();
  if (!/^[A-Z0-9]{2,12}$/.test(K)) throw new Error('Άγνωστος πελάτης.');
  const lock = LockService.getScriptLock();
  lock.tryLock(10000);
  try {
    const a = cliLog_(K), x = a.filter(function (r) { return r.id === String(id || ''); })[0];
    if (!x) throw new Error('Δεν βρέθηκε το αίτημα.');
    x.status = 'done'; x.done_at = new Date().toISOString(); x.done_by = me.email;
    P_().setProperty('CLIENT_LOG_' + K, JSON.stringify(a));
  } finally { lock.releaseLock(); }
  return 'Σημειώθηκε ως «έγινε».';
}

// ------------------------------------------------------------------ email καλωσορίσματος μετά το σετάρισμα
// Τα email agency και οι κωδικοί σύστασής τους (τα σεταρίσματά τους δεν παίρνουν τίποτα για το okpublisher).
function cliAgencyKeys_() {
  const u = admUsers_(), mails = {}, refs = {};
  Object.keys(u).forEach(function (e) { if (u[e].role === 'agency') { mails[e] = 1; if (u[e].ref) refs[u[e].ref] = 1; } });
  return { mails: mails, refs: refs, users: u };
}
// Σετάρισμα (όχι agency, όχι παλιότερο από 60 μέρες) με αυτό το email, που ο κωδικός του δεν είναι ακόμα πελάτης· null αν κανένα.
function cliPending_(e) {
  try {
    const a = cliAgencyKeys_();
    if (a.mails[e]) return null;
    const codes = {}, from = admTime_(Utilities.formatDate(new Date(Date.now() - 60 * 86400000), 'Europe/Athens', 'd/M/yyyy HH:mm:ss'));
    admClients_().forEach(function (c) { if (c.code) codes[c.code] = 1; });
    return admLeads_().setups.filter(function (s) {
      return s.email === e && !a.refs[s.ref] && !(s.code && codes[s.code]) && admTime_(s.at) >= from;
    })[0] || null;
  } catch (x) { return null; }
}

function cliWelcome_() {
  const L = admLeads_(), a = cliAgencyKeys_(), floor = admTime_(CLI_.WELCOME_FROM);
  let sent = {};
  try { sent = JSON.parse(prop_('CLIENT_WELCOMED', '{}')) || {}; } catch (e) { sent = {}; }
  let n = 0, changed = false;
  L.setups.slice().reverse().forEach(function (s) {          // από το παλιότερο στο νεότερο
    const t = admTime_(s.at), e = admEmail_(s.email), key = s.code || e;
    if (!e || !key || t < floor || sent[key]) return;
    if (a.refs[s.ref] || a.mails[e] || a.users[e]) { sent[key] = t; changed = true; return; }   // agency ή δικός μας χρήστης: όχι
    try {
      cliWelcomeMail_(s, e);
      sent[key] = t; changed = true; n++;
    } catch (x) { console.log('email καλωσορίσματος ' + key + ': ' + x.message); }   // ξαναδοκιμάζει την επόμενη ώρα
  });
  if (changed) {
    const keep = Object.keys(sent).sort(function (x, y) { return sent[y] - sent[x]; }).slice(0, CLI_.WELCOME_MAX), out = {};
    keep.forEach(function (k) { out[k] = sent[k]; });
    P_().setProperty('CLIENT_WELCOMED', JSON.stringify(out));
  }
  return n;
}

function cliWelcomeMail_(s, e) {
  const biz = String(s.business || '').trim() || 'την επιχείρησή σας', trial = s.trial !== '' && !/^όχι/.test(String(s.trial || ''));
  const steps = [
    'Αν δεν το έχετε κάνει ήδη, δώστε μας πρόσβαση στη σελίδα σας και φτιάξτε τον φάκελο Google Drive με το πρώτο υλικό (βήματα 2–4): https://okpublisher.gr/setup.html',
    'Ολοκληρώνουμε το σετάρισμα και σας στέλνουμε ' + (trial ? 'τη δωρεάν εβδομάδα (3 posts και 3 stories)' : 'το πρώτο πρόγραμμα') + ' για ένα «ΟΚ».'];
  if (s.help) steps.splice(1, 0, 'Ζητήσατε να κάνουμε μαζί την πρόσβαση με απομακρυσμένη σύνδεση: θα σας γράψουμε για μέρα και ώρα.');
  const acct = ['Εκεί βλέπετε τα πάντα: τις επόμενες και τις δημοσιευμένες αναρτήσεις σας, το πακέτο, τις πληρωμές και τον σύνδεσμο σύστασης. ' +
    'Και αλλάζετε μόνοι σας, όποτε θέλετε: όνομα, email εγκρίσεων, τηλέφωνα, διεύθυνση, ώρες δημοσίευσης, μουσική, ακόμα και πακέτο.',
    'Μπαίνετε με αυτό το email (' + e + '), χωρίς κωδικό πρόσβασης: σας στέλνουμε κωδικό μίας χρήσης όποτε μπαίνετε. ' +
    'Ο λογαριασμός ενεργοποιείται μόλις ολοκληρωθεί το σετάρισμα.'];
  const text = ['Γεια σας,', '', 'Ευχαριστούμε! Λάβαμε τη φόρμα σεταρίσματος για «' + biz + '»' + (s.code ? ' (κωδικός πελάτη ' + s.code + ')' : '') + '.', '',
    'Τι ακολουθεί', steps.map(function (x, i) { return (i + 1) + '. ' + x; }).join('\n'), '',
    'Ο λογαριασμός σας: ' + CLI_.SITE, acct.join('\n\n'), '', 'Για οτιδήποτε, απαντήστε σε αυτό το email.', '',
    'okpublisher · Ένα ΟΚ τον μήνα. Τα υπόλοιπα τα κάνουμε εμείς.'].join('\n');
  const link = function (t) { return esc_(t).replace(/(https:\/\/[^\s<]+)/g, '<a href="$1">$1</a>'); };
  const html = '<div style="font:15px/1.6 Arial,sans-serif;color:#14162E;max-width:560px">' +
    '<p>Γεια σας,</p><p>Ευχαριστούμε! Λάβαμε τη φόρμα σεταρίσματος για <b>' + esc_(biz) + '</b>' + (s.code ? ' (κωδικός πελάτη ' + esc_(s.code) + ')' : '') + '.</p>' +
    '<p style="font-weight:bold;margin-bottom:4px">Τι ακολουθεί</p><ol style="margin-top:0;padding-left:20px">' + steps.map(function (x) { return '<li>' + link(x) + '</li>'; }).join('') + '</ol>' +
    '<div style="background:#F2ECFF;border-radius:16px;padding:16px 18px;margin:18px 0"><p style="margin:0 0 8px;font-weight:bold;color:#5B21D6">Ο λογαριασμός σας στο okpublisher</p>' +
    acct.map(function (x) { return '<p style="margin:0 0 10px">' + esc_(x) + '</p>'; }).join('') +
    '<a href="' + CLI_.SITE + '" style="display:inline-block;padding:10px 20px;border-radius:999px;background:#5B21D6;color:#fff;text-decoration:none;font-weight:bold">Ο λογαριασμός μου</a></div>' +
    '<p>Για οτιδήποτε, απαντήστε σε αυτό το email.</p><p style="color:#4A4C66">okpublisher · Ένα ΟΚ τον μήνα. Τα υπόλοιπα τα κάνουμε εμείς.</p></div>';
  MailApp.sendEmail({ to: e, name: CFG.SENDER_NAME, subject: 'Λάβαμε το σετάρισμά σας · ο λογαριασμός σας στο okpublisher', body: text, htmlBody: html });
}

// ------------------------------------------------------------------ API για τη σελίδα του site (doPost)
function clientApi_(p) {
  const out = function (o) { return ContentService.createTextOutput(JSON.stringify(o)).setMimeType(ContentService.MimeType.JSON); };
  try {
    const t = p.token;
    switch (String(p.act || '')) {
      case 'login': return out({ ok: true, message: cliLogin_(p.email) });
      case 'pin': return out({ ok: true, token: cliPinLogin_(p.email, p.pin) });
      case 'link': return out({ ok: true, token: cliExchange_(p.code) });
      case 'logout': cliLogout_(t); return out({ ok: true });
      case 'data': return out({ ok: true, data: cliData_(t, p.client) });
      case 'save': return out(Object.assign({ ok: true }, cliSave_(t, p.client, p.fields)));
      case 'plan': return out(Object.assign({ ok: true }, cliPlan_(t, p.client, p.plan)));
      case 'stop': return out(Object.assign({ ok: true }, cliStop_(t, p.client)));
      case 'request': return out(Object.assign({ ok: true }, cliRequest_(t, p.client, p.kind, p.data)));
      default: return out({ ok: false, error: 'Άγνωστη ενέργεια.' });
    }
  } catch (e) {
    const m = String((e && e.message) || e);
    return out(m === 'login' ? { ok: false, login: true, error: 'Χρειάζεται ξανά σύνδεση.' } : { ok: false, error: m });
  }
}
