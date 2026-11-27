/**
 * Agencies και freelancers (από 27/11/2026, πιλότος· σχέδιο: docs/okpublisher-agencies.md στο publisher-work).
 *
 * Agency = χρήστης του διαχειριστικού με ρόλο «agency». Όπως ο πωλητής έχει δικό της σύνδεσμο (?p=…) και βλέπει μόνο τους
 * πελάτες της· αντί για προμήθεια έχει έκπτωση % στα πακέτα (αλλάζει από το διαχειριστικό, ισχύει από την επόμενη χρέωση).
 * Πελάτης μας είναι η agency· με τον τελικό πελάτη δεν έχουμε καμία επαφή:
 *   - Πελάτης agency (Πελάτες → Ενέργειες → Agency): AGENCY_<K> = κλειδί της agency, NOTIFY_TO_<K> = email της agency,
 *     στο config.json: agency, approver_to / approvers = email της agency, billing { type: "agency", agency, day, start }.
 *     Ό,τι υπήρχε πριν κρατιέται στο config.json (pre_agency) και επιστρέφει αν ο πελάτης βγει από την agency.
 *   - Κάθε email του πελάτη (έγκριση, ενημερωτικό, αναφορά, υλικό) πάει μόνο στην agency, χωρίς υπογραφή «OK Publisher»
 *     στα κείμενα που μπορεί να προωθήσει (αναφορά· τα email έγκρισης τα γράφει ο Claude, RUNBOOK §1.3).
 *   - Καμία δωρεάν εβδομάδα, καμία δική του συνδρομή (Δωρεάν / Χρέωση / Διακοπή στον πελάτη: όχι).
 * Μία χρέωση τον μήνα για όλους της τους πελάτες: BILLING_<AG + κωδικός συνδέσμου με κεφαλαία>, με τον μηχανισμό του Billing.gs
 *   (σύνδεσμος Viva, μέρα πληρωμής, αυτόματη χρέωση, υπενθύμιση, παύση, διακοπή). Επιπλέον:
 *   st.agency = { email, clients: { K: { plan, from } }, extra: [{ K, cents, note }], lines: [..] }.
 *   - «Χρέωση» (διαχειριστικό → Χρήστες): σύνδεσμος για το άθροισμα των πελατών της· η πληρωμή ορίζει τη μέρα της agency
 *     και οι πελάτες της ξεκινούν αμέσως (config billing.day / start → παραγωγή, RUNBOOK §2).
 *   - Κάθε νέα περίοδος: ποσό = Σ (πακέτο × (1 − έκπτωση)) + ΦΠΑ, + τα αναλογικά (extra) των πελατών που μπήκαν μέσα
 *     στην προηγούμενη περίοδο (από τη μέρα που μπήκαν ως το τέλος της). Χωρίς πελάτες: καμία χρέωση εκείνη την περίοδο.
 *   - Απλήρωτη agency → παύση των δημοσιεύσεων όλων των πελατών της (billPaused_), ώσπου να πληρώσει.
 */
const AGENCY_ = { PREFIX: 'AG', DISC_DEFAULT: 20, DISC_MAX: 60, NOTICE_DAYS: 30, TERMS: 'https://okpublisher.gr/agency-terms.html' };

function agencyKey_(ref) { return ref ? AGENCY_.PREFIX + String(ref).toUpperCase() : ''; }
// Κλειδί agency του πελάτη K ('' = όχι πελάτης agency).
function agencyOf_(K) { return String(cprop_(K, 'AGENCY', '') || ''); }
// Οι agencies του διαχειριστικού: [{ email, name, ref, key, disc }].
// disc = η έκπτωση σήμερα· discs = ιστορικό [{ from: "ΕΕΕΕ-ΜΜ-ΗΗ", d }] (μείωση έκπτωσης = ακριβότερο: ισχύει NOTICE_DAYS μετά).
function agencyList_(users) {
  users = users || admUsers_();
  const today = athens_(new Date(), 'yyyy-MM-dd');
  return Object.keys(users).filter(function (e) { return users[e].role === 'agency' && users[e].ref; }).map(function (e) {
    const u = users[e];
    return { email: e, name: u.name || e, ref: u.ref, key: agencyKey_(u.ref), disc: agencyDisc_(u, today), discs: agencyDiscs_(u) };
  });
}
function agencyDiscs_(u) {
  const L = (u && Array.isArray(u.discs) ? u.discs : []).filter(function (x) { return x && /^\d{4}-\d{2}-\d{2}$/.test(x.from) && x.d >= 0 && x.d <= AGENCY_.DISC_MAX; })
    .sort(function (a, b) { return a.from < b.from ? -1 : 1; });
  if (!L.length && u && u.disc !== undefined && Number(u.disc) >= 0 && Number(u.disc) <= AGENCY_.DISC_MAX) L.push({ from: '0000-01-01', d: Number(u.disc) });
  return L.slice(-12);
}
// Η έκπτωση που ισχύει στη μέρα ymd (προεπιλογή: σήμερα).
function agencyDisc_(u, ymd) {
  ymd = ymd || athens_(new Date(), 'yyyy-MM-dd');
  let v = AGENCY_.DISC_DEFAULT;
  agencyDiscs_(u).forEach(function (x) { if (x.from <= ymd) v = Number(x.d); });
  return v;
}
// Νέα έκπτωση n: μεγαλύτερη (φθηνότερο) από σήμερα, μικρότερη (ακριβότερο) μετά από NOTICE_DAYS (όροι agency §4). { from, discs }
function agencyDiscSet_(u, n) {
  const today = athens_(new Date(), 'yyyy-MM-dd'), L = agencyDiscs_(u);
  if (!L.length) return { from: '0000-01-01', discs: [{ from: '0000-01-01', d: n }] };
  const cur = agencyDisc_(u, today), last = L[L.length - 1];
  if (n === cur && last.from <= today) return { from: '', discs: L };
  const from = n >= cur ? today : addDays_(today, AGENCY_.NOTICE_DAYS);
  return { from: from, discs: L.filter(function (x) { return x.from < from && x.from <= today; }).concat([{ from: from, d: n }]) };
}
function agencyByKey_(key, users) { return agencyList_(users).filter(function (a) { return a.key === key; })[0] || null; }
// Για τον κύκλο πληρωμών: οι agencies που έχουν κατάσταση χρέωσης.
function agencyKeys_() { try { return agencyList_().map(function (a) { return a.key; }).filter(function (k) { return !!billState_(k); }); } catch (e) { return []; } }

// Τιμή ενός πακέτου για agency, με ΦΠΑ, σε λεπτά (π.χ. Βασικό €150 −20% = €120 + ΦΠΑ = 14880).
function agencyCents_(plan, disc) {
  const p = planOf_(plan) || planOf_('Βασικό');
  return Math.round(Math.round(p.net * (100 - disc)) * (1 + BILL_.VAT));
}
function agencyState_(a) {
  const st = billState_(a.key) || { plan: '', amount: 0, start: null, stop_after: null, tx: null, months: {} };
  st.agency = st.agency || { email: a.email, clients: {}, extra: [] };
  st.agency.email = a.email;
  st.agency.clients = st.agency.clients || {};
  st.agency.extra = st.agency.extra || [];
  return st;
}
function agencyPaying_(st) { return !!(st && st.tx && st.start && !st.offer && !(st.stop_after && st.stop_after < periodOf_(st, new Date()))); }
function agencyLabel_(n) { return 'Agency · ' + n + (n === 1 ? ' πελάτης' : ' πελάτες'); }

// Ποσό της επόμενης περιόδου (χωρίς να αλλάξει τίποτα): { cents, lines, n }.
function agencyQuote_(st, disc) {
  const lines = [];
  let cents = 0;
  const ks = Object.keys(st.agency.clients).sort();
  ks.forEach(function (K) {
    const c = st.agency.clients[K], v = agencyCents_(c.plan, disc);
    cents += v;
    lines.push(clientName_(K) + ' (' + K + '): ' + c.plan + ' −' + disc + '% · €' + euros_(v));
  });
  (st.agency.extra || []).forEach(function (x) { cents += x.cents; lines.push(x.note + ' · €' + euros_(x.cents)); });
  return { cents: cents, lines: lines, n: ks.length };
}

// Νέα περίοδος m (από τον billingClient_, πριν από τη χρέωση): ποσό από τους τωρινούς πελάτες + τα αναλογικά.
// false = κανένας πελάτης· η περίοδος σημειώνεται χωρίς χρέωση.
function agencyPeriod_(K, st, m) {
  const a = agencyByKey_(K);
  const q = agencyQuote_(st, a ? agencyDisc_({ discs: a.discs }, perStart_(st, m)) : AGENCY_.DISC_DEFAULT);
  if (!q.cents) {
    st.months[m] = { st: 'none', note: 'χωρίς πελάτες' };
    billSave_(K, st);
    billLog_(K, m, 0, 'agency: καμία χρέωση', 'χωρίς πελάτες', '');
    return false;
  }
  st.amount = q.cents;
  st.plan = agencyLabel_(q.n);
  st.agency.lines = q.lines;
  st.agency.extra = [];
  return true;
}

// Αναλογικά για πελάτη που μπαίνει τώρα σε agency που ήδη πληρώνει: από σήμερα ως το τέλος της περιόδου.
function agencyProrate_(st, K, disc, now) {
  if (!agencyPaying_(st)) return 0;
  const m = periodOf_(st, now), end = perEnd_(st, m), start = perStart_(st, m), today = athens_(now, 'yyyy-MM-dd');
  const total = Math.round((utc_(end) - utc_(start)) / 86400000) + 1, left = Math.round((utc_(end) - utc_(today)) / 86400000) + 1;
  if (left <= 0) return 0;
  const cents = Math.round(agencyCents_(st.agency.clients[K].plan, disc) * left / total);
  st.agency.extra.push({ K: K, cents: cents, note: clientName_(K) + ' (' + K + '): ' + left + ' από ' + total + ' μέρες (' + dm_(today) + '–' + dm_(end) + ')' });
  return cents;
}

// ------------------------------------------------------------------ «Χρέωση» της agency (σύνδεσμος, ξεκινά με την πληρωμή)
function agencyOfferStart_(a) {
  if (!String(cprop_(a.key, 'NOTIFY_TO', '')).trim()) P_().setProperty('NOTIFY_TO_' + a.key, a.email);
  const st = agencyState_(a);
  if (agencyPaying_(st)) throw new Error('Η agency πληρώνει ήδη: οι νέοι πελάτες μπαίνουν μόνοι τους στην επόμενη χρέωση.');
  const q = agencyQuote_(Object.assign({}, st, { agency: Object.assign({}, st.agency, { extra: [] }) }), a.disc);
  if (!q.n) throw new Error('Η agency δεν έχει ακόμα πελάτες (Πελάτες → Ενέργειες → Agency).');
  const months = {};
  Object.keys(st.months || {}).forEach(function (m) { if (st.months[m].st === 'paid') months[m] = st.months[m]; });
  st.months = months; st.start = null; st.stop_after = null; st.amount = q.cents; st.plan = agencyLabel_(q.n);
  st.agency.extra = []; st.agency.lines = q.lines;
  st.offer = { kind: 'charge', trial_start: athens_(new Date(), 'yyyy-MM-dd'), chosen: 'Agency', plans: ['Agency'],
    orders: (st.offer && st.offer.orders) || {}, sent: {}, at: new Date().toISOString(), clients: Object.keys(st.agency.clients) };
  const links = offerLinks_(a.key, st);
  st.offer.sent.d1 = st.offer.sent.d5 = new Date().toISOString();
  billSave_(a.key, st);
  P_().deleteProperty('BILLING_PAUSED_' + a.key);
  offerEmail_(a.key, st, 'c1', links);
  billLog_(a.key, '', st.amount, 'agency: σύνδεσμος πληρωμής (ξεκινά με την πληρωμή)', q.n + ' πελάτες', '');
  return { link: links.Agency, cents: st.amount, n: q.n };
}

// Email «Χρέωση» της agency (c1 / c4 / c8): ένα κουμπί με το ποσό και την ανάλυση ανά πελάτη.
function agencyOfferEmail_(K, st, kind, links) {
  const until = dm_(addDays_(st.offer.trial_start, OFFER_.LAST_DAY - 1));
  const T = {
    c1: ['Πληρωμή συνεργασίας: ξεκινάμε μόλις πληρώσετε', 'Για να ξεκινήσουν οι πελάτες σας, πληρώστε με κάρτα με τον σύνδεσμο παρακάτω. ' +
      'Μόλις γίνει η πληρωμή, ετοιμάζουμε τα προγράμματα των επόμενων 30 ημερών και σας τα στέλνουμε για ΟΚ μέσα σε 1–2 μέρες. ' +
      'Ο σύνδεσμος ισχύει ως τις ' + until + '.'],
    c4: ['Υπενθύμιση πληρωμής', 'Μια μικρή υπενθύμιση: οι πελάτες σας ξεκινούν μόλις πληρώσετε με τον σύνδεσμο παρακάτω (ισχύει ως τις ' + until + ').'],
    c8: ['Τελευταία υπενθύμιση πληρωμής', 'Ο σύνδεσμος πληρωμής ισχύει ως τις ' + until + '. Μόλις πληρώσετε, ξεκινάμε αμέσως.'],
  }[kind] || ['Πληρωμή συνεργασίας', ''];
  const lines = (st.agency && st.agency.lines) || [];
  const rest = 'Ανάλυση:\n' + lines.map(function (l) { return '• ' + l; }).join('\n') + '\nΣύνολο: €' + euros_(st.amount) + ' τον μήνα με ΦΠΑ.\n\n' +
    'Η χρέωση γίνεται μετά αυτόματα κάθε μήνα, την ίδια μέρα με την πρώτη πληρωμή, για όσους πελάτες έχετε τότε. ' +
    'Νέος πελάτης ξεκινά αμέσως και χρεώνεται αναλογικά στην επόμενη χρέωση. Τα στοιχεία της κάρτας τα κρατά η Viva, όχι εμείς.\n\n' +
    'Όροι συνεργασίας: ' + AGENCY_.TERMS + '\nΜε την πληρωμή αποδέχεστε τους όρους.';
  const link = links.Agency || '';
  const html = '<div style="font:15px/1.6 Arial,sans-serif;color:#14162E"><p>' + esc_(T[1]) + '</p>' +
    (link ? '<a href="' + esc_(link) + '" style="display:block;max-width:420px;padding:12px 18px;margin:0 0 14px;border-radius:16px;text-decoration:none;' +
      'color:#fff;background:#5B21D6"><b>Πληρωμή · €' + euros_(st.amount) + '</b> τον μήνα με ΦΠΑ<br><span style="font-size:14px">' + esc_(st.plan) + '</span></a>' : '') +
    '<p style="color:#4A4C66">' + esc_(rest).replace(/(https:\/\/[^\s<]+)/g, '<a href="$1">$1</a>').replace(/\n/g, '<br>') + '</p></div>';
  notify_(K, T[0], T[1] + '\n\nΠληρωμή: ' + link + '\n\n' + rest, html);
}

// Η agency πλήρωσε τον σύνδεσμο: η μέρα της = η μέρα της πληρωμής, η 1η περίοδος πληρωμένη, οι πελάτες της ξεκινούν.
function agencyPaid_(K, st, order, paid, now) {
  let m = ym_(now), d = Number(athens_(now, 'd'));
  if (d > 28) { m = nextYm_(m); d = 1; }
  st.start = m; st.tx = paid.tx;
  if (d > 1) st.day = d; else delete st.day;
  st.trial = { kind: 'agency', start: st.offer.trial_start, paid_at: new Date().toISOString() };
  // Πελάτες που μπήκαν μετά τον σύνδεσμο: η 1η περίοδός τους μπαίνει ολόκληρη στην επόμενη χρέωση.
  const was = st.offer.clients || Object.keys(st.agency.clients), a0 = agencyByKey_(K), disc0 = a0 ? a0.disc : AGENCY_.DISC_DEFAULT;
  Object.keys(st.agency.clients).filter(function (x) { return was.indexOf(x) < 0; }).forEach(function (x) {
    st.agency.extra.push({ K: x, cents: agencyCents_(st.agency.clients[x].plan, disc0), note: clientName_(x) + ' (' + x + '): 1η περίοδος (μπήκε μετά τον σύνδεσμο πληρωμής)' });
  });
  delete st.offer;
  st.months[m] = { st: 'pending', order: order };
  const payLine = markPaid_(K, st, m, paid.tx);
  billLog_(K, m, st.amount, 'agency: πρώτη πληρωμή (σύνδεσμος)', 'πληρώθηκε · μέρα χρέωσης ' + billDay_(st), paid.tx, st.months[m].pay);
  const bad = agencyClientsRepo_(K, st);
  billNotify_(K, 'Ξεκινάμε! Λάβαμε την πληρωμή', 'Ευχαριστούμε! Λάβαμε την πληρωμή (€' + euros_(st.amount) + ' με ΦΠΑ) και ξεκινάμε. ' +
    'Ετοιμάζουμε τώρα τα προγράμματα της πρώτης περιόδου (' + perRange_(st, m) + ') και σας τα στέλνουμε για ΟΚ μέσα σε 1–2 μέρες. ' +
    nextChargeText_(st, m) + '\n\n' + payLine);
  systemNotify_('Agency πλήρωσε: ' + clientName_(K), clientName_(K) + ' (' + K + '): ' + st.plan + ', περίοδος ' + perRange_(st, m) + ', χρέωση ' +
    chargeDayText_(st) + '. Η παραγωγή των πελατών της ξεκινά στον επόμενο κύκλο (RUNBOOK §2).' + bad);
}

// config.json κάθε πελάτη της agency: billing { type: agency, agency, day, start } (για την παραγωγή). '' αν όλα καλά.
function agencyClientsRepo_(KA, st) {
  const a = agencyByKey_(KA), bad = [];
  Object.keys(st.agency.clients).forEach(function (K) {
    try {
      const path = 'clients/' + K + '/config.json', cfg = ghJson_(path);
      if (!cfg) { bad.push(K + ': δεν βρέθηκε config.json'); return; }
      cfg.billing = agencyBilling_(a, st);
      ghPutJson_(path, cfg, 'Agency ' + KA + ': ' + K + ', μέρα ' + billDay_(st));
    } catch (e) { bad.push(K + ': ' + e.message); }
  });
  try { CacheService.getScriptCache().remove(ADM_.CLIENTS_KEY); } catch (e) { /* μένει 5′ */ }
  return bad.length ? '\n\n(config.json: ' + bad.join(' · ') + ' — ενημέρωσέ τα με το χέρι.)' : '';
}
function agencyBilling_(a, st) {
  const b = { type: 'agency', agency: a ? a.ref : '' };
  if (st && st.start && !st.offer) { b.day = billDay_(st); b.start = perStart_(st, st.start); }
  return b;
}

// ------------------------------------------------------------------ διαχειριστικό
// Πελάτης → agency (email) ή εκτός agency (''). Επιστρέφει το μήνυμα για τη σελίδα.
function admClientAgency_(token, client, email) {
  const me = admSession_(token);
  admNeedAdmin_(me);
  const c = admClientCfg_(client);
  return agencyAssign_(c.K, c.cfg, email, me);
}

// Η ανάθεση (από το διαχειριστικό ή από τον agencySync_). me = { email } για τα μηνύματα.
function agencyAssign_(K, cfg, email, me) {
  const users = admUsers_();
  const e = admEmail_(email), a = e ? agencyList_(users).filter(function (x) { return x.email === e; })[0] : null;
  if (e && !a) throw new Error('Άγνωστη agency.');
  const oldKey = agencyOf_(K), old = oldKey ? agencyByKey_(oldKey, users) : null;
  if ((a ? a.key : '') === oldKey) return a ? 'Είναι ήδη πελάτης της ' + a.name + '.' : 'Δεν ανήκει σε agency.';
  if (a && admPaying_(billState_(K))) throw new Error('Ο πελάτης έχει δική του ενεργή συνδρομή: πρώτα «Διακοπή συνδρομής».');
  const assign = admJson_('ADMIN_ASSIGN');
  let msg = '';
  if (oldKey) {
    const ost = billState_(oldKey);
    if (ost && ost.agency && ost.agency.clients) {
      delete ost.agency.clients[K];
      ost.agency.extra = (ost.agency.extra || []).filter(function (x) { return x.K !== K; });
      billSave_(oldKey, ost);
    }
    if (old && assign['client:' + K] === old.email) delete assign['client:' + K];
    msg = 'Βγήκε από την ' + (old ? old.name : oldKey) + ' (από την επόμενη χρέωσή της δεν χρεώνεται). ';
  }
  if (a) {
    if (!cfg.pre_agency) cfg.pre_agency = { notify_to: String(cprop_(K, 'NOTIFY_TO', '')), approver_to: cfg.approver_to || null, approvers: cfg.approvers || null, billing: cfg.billing || null };
    const st = agencyState_(a);
    st.agency.clients[K] = { plan: planOf_(cfg.package) ? String(cfg.package) : 'Βασικό', from: athens_(new Date(), 'yyyy-MM-dd') };
    const extra = agencyProrate_(st, K, a.disc, new Date());
    if (!st.plan) st.plan = agencyLabel_(Object.keys(st.agency.clients).length);
    billSave_(a.key, st);
    if (!String(cprop_(a.key, 'NOTIFY_TO', '')).trim()) P_().setProperty('NOTIFY_TO_' + a.key, a.email);
    if (clientName_(a.key) === a.key) P_().setProperty('NAME_' + a.key, a.name);
    cfg.agency = a.ref; cfg.approver_to = a.email; cfg.approvers = [a.email]; cfg.billing = agencyBilling_(a, st);
    P_().setProperty('AGENCY_' + K, a.key);
    P_().setProperty('NOTIFY_TO_' + K, a.email);
    assign['client:' + K] = a.email;
    const plan = st.agency.clients[K].plan, v = agencyCents_(plan, a.disc);
    msg += 'Πελάτης της ' + a.name + ': ' + plan + ' −' + a.disc + '% = €' + euros_(v) + ' τον μήνα με ΦΠΑ. Όλα τα email του πάνε πια στην agency. ' +
      (agencyPaying_(st) ? 'Ξεκινά αμέσως· αναλογικά €' + euros_(extra) + ' στην επόμενη χρέωσή της.'
        : st.offer && !st.offer.closed ? 'Η agency έχει σύνδεσμο πληρωμής σε αναμονή με το παλιό ποσό: στείλε νέα «Χρέωση» (Χρήστες).'
          : 'Ξεκινά μόλις πληρώσει η agency: «Χρέωση» στους Χρήστες.');
  } else {
    const p = cfg.pre_agency || {};
    if (p.notify_to) P_().setProperty('NOTIFY_TO_' + K, p.notify_to); else P_().deleteProperty('NOTIFY_TO_' + K);
    if (p.approver_to) cfg.approver_to = p.approver_to; else delete cfg.approver_to;
    if (p.approvers) cfg.approvers = p.approvers; else delete cfg.approvers;
    delete cfg.pre_agency; delete cfg.agency;
    if (p.billing) cfg.billing = p.billing; else if (cfg.billing && cfg.billing.type === 'agency') delete cfg.billing;
    P_().deleteProperty('AGENCY_' + K);
    msg += 'Τα email του πάνε ξανά όπου πήγαιναν πριν από την agency' + (p.notify_to ? '' : ' (δεν υπήρχε email: βάλε NOTIFY_TO_' + K + ')') +
      '. ' + (p.billing ? 'Επέστρεψε η χρέωση που είχε πριν (' + (p.billing.type === 'free' ? 'δωρεάν' : p.billing.type) + ').' : 'Χρειάζεται δική του συνδρομή ή «Δωρεάν».');
  }
  P_().setProperty('ADMIN_ASSIGN', JSON.stringify(assign));
  admSaveCfg_(K, cfg, a ? 'agency ' + a.ref : 'εκτός agency', me);
  systemNotify_('Agency: ' + admWho_(K, cfg), msg + ' (' + (me.email === 'system' ? 'αυτόματα από το config.json' : 'διαχειριστικό: ' + me.email) + ')');
  return msg.trim();
}

// Κάθε ώρα (κύκλος πληρωμών): ο Claude γράφει "agency": "<κωδικός>" στο config.json νέου πελάτη που ήρθε από τον σύνδεσμο
// μιας agency (RUNBOOK §1.4)· εδώ ολοκληρώνεται η ανάθεση (email, χρέωση agency). Και admin/agencies.json για τον Claude.
function agencySync_() {
  const users = admUsers_(), list = agencyList_(users);
  const pub = list.map(function (a) { return { ref: a.ref, key: a.key, name: a.name, email: a.email, disc: a.disc }; });
  const sig = JSON.stringify(pub);
  if (prop_('AGENCIES_REPO', '') !== sig && prop_('GITHUB_TOKEN', '')) {
    ghPutJson_('admin/agencies.json', { agencies: pub, note: 'Οι agencies του διαχειριστικού (κωδικός συνδέσμου = «Σύσταση» στο σετάρισμα). Τo γράφει μόνο το Agency.gs.' },
      'Agencies (' + pub.length + ')');
    P_().setProperty('AGENCIES_REPO', sig);
  }
  if (!list.length) return 0;
  let n = 0;
  admClients_().forEach(function (c) {
    const ref = c.cfg_agency, a = ref ? list.filter(function (x) { return x.ref === ref; })[0] : null;
    if (!ref || agencyOf_(c.key) === (a ? a.key : '')) return;
    if (!a) { systemNotify_('Agency: άγνωστος κωδικός στο config ' + c.key, 'Το clients/' + c.key + '/config.json έχει "agency": "' + ref + '", αλλά δεν υπάρχει τέτοια agency.'); return; }
    try {
      const cfg = ghJson_('clients/' + c.key + '/config.json');
      if (!cfg || cfg.agency !== ref) return;
      delete cfg.agency;                                  // για να μη φανεί «ήδη πελάτης»: το agencyAssign_ το ξαναγράφει
      agencyAssign_(c.key, cfg, a.email, { email: 'system' });
      n++;
    } catch (e) { systemNotify_('Agency: ανάθεση ' + c.key + ' απέτυχε', e.message); }
  });
  return n;
}

// «Χρέωση» agency από τους Χρήστες.
function admAgencyCharge_(token, email) {
  const me = admSession_(token);
  admNeedAdmin_(me);
  const e = admEmail_(email), a = agencyList_().filter(function (x) { return x.email === e; })[0];
  if (!a) throw new Error('Άγνωστη agency.');
  const r = agencyOfferStart_(a);
  systemNotify_('Agency: σύνδεσμος πληρωμής σε ' + a.name, a.name + ' (' + a.key + '): €' + euros_(r.cents) + ' για ' + r.n + ' πελάτες (διαχειριστικό: ' + me.email + ').');
  return 'Στάλθηκε στην ' + a.name + ' σύνδεσμος πληρωμής €' + euros_(r.cents) + ' τον μήνα (' + r.n + (r.n === 1 ? ' πελάτης' : ' πελάτες') +
    '). Οι πελάτες της ξεκινούν μόλις πληρώσει· η μέρα πληρωμής γίνεται η μέρα χρέωσης κάθε μήνα.';
}

// «Διακοπή» agency: σταματά μετά την τρέχουσα περίοδο (έως τη 15η μέρα) ή την επόμενη (όροι agency, όπως Α.8).
function admAgencyStop_(token, email) {
  const me = admSession_(token);
  admNeedAdmin_(me);
  const e = admEmail_(email), a = agencyList_().filter(function (x) { return x.email === e; })[0];
  if (!a) throw new Error('Άγνωστη agency.');
  const st = billState_(a.key);
  if (st && st.offer && !st.offer.closed) { billingCancelUnpaid_(a.key, me.email); return 'Ο σύνδεσμος πληρωμής της ' + a.name + ' ακυρώθηκε.'; }
  if (!agencyPaying_(st)) throw new Error('Δεν υπάρχει ενεργή χρέωση.');
  if (st.stop_after) return 'Σταματά ήδη μετά ' + perFor_(st, st.stop_after) + '.';
  const after = stopAfterFor_(st, new Date());
  billingStop_(a.key, st, after, false, 'διαχειριστικό');
  systemNotify_('Agency: διακοπή ' + a.name, a.name + ' (' + a.key + '): καμία χρέωση μετά ' + perFor_(st, after) + ' (διαχειριστικό: ' + me.email + ').');
  return 'Η ' + a.name + ' σταματά μετά ' + perFor_(st, after) + '. Πήρε email επιβεβαίωσης.';
}

// Πακέτο πελάτη agency: από την επόμενη χρέωση της agency (και config.package για την επόμενη παραγωγή).
function agencyClientPlan_(K, cfg, p, me) {
  const a = agencyByKey_(agencyOf_(K));
  if (!a) throw new Error('Η agency του πελάτη δεν βρέθηκε.');
  const st = agencyState_(a);
  const cur = st.agency.clients[K];
  if (cur && cur.plan === p.name) return 'Έχει ήδη ' + p.name + '.';
  st.agency.clients[K] = { plan: p.name, from: (cur && cur.from) || athens_(new Date(), 'yyyy-MM-dd') };
  billSave_(a.key, st);
  cfg.package = p.name;
  admSaveCfg_(K, cfg, 'πακέτο ' + p.name + ' (agency)', me);
  return p.name + ' για τον ' + clientName_(K) + ': από την επόμενη χρέωση της ' + a.name + ' (€' + euros_(agencyCents_(p.name, a.disc)) + ' τον μήνα με ΦΠΑ) και την επόμενη παραγωγή.';
}

// Για τη σελίδα: η agency με την κατάστασή της.
function admAgencyInfo_(a) {
  const st = billState_(a.key) || null, s = st ? agencyState_(a) : null;
  const b = st ? admBilling_(a.key) : null;
  const nd = b && b.next_date ? b.next_date : athens_(new Date(), 'yyyy-MM-dd'), nextDisc = agencyDisc_({ discs: a.discs }, nd);
  const q = s ? agencyQuote_(s, nextDisc) : { cents: 0, lines: [], n: 0 };
  const later = a.discs.filter(function (x) { return x.from > athens_(new Date(), 'yyyy-MM-dd'); })[0] || null;
  return { email: a.email, name: a.name, key: a.key, disc: a.disc, disc_next: later ? { d: later.d, from: later.from } : null, link: admLink_(a.ref), setup_link: admLink_(a.ref, 'setup.html'),
    clients: s ? Object.keys(s.agency.clients).sort() : [], next_eur: q.cents / 100, lines: q.lines, paying: agencyPaying_(st),
    billing: b };
}
