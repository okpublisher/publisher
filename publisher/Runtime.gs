/**
 * Χρόνος των αυτόματων εργασιών (από 28/11/2026). Το okpublisher.gr είναι δωρεάν Gmail: η Google δίνει 90 λεπτά τη μέρα
 * συνολικά σε όλες τις εκτελέσεις από triggers (6 ώρες σε Workspace). Εδώ μετράμε πόσα από αυτά χρησιμοποιούμε, ώστε να
 * ξέρουμε πόσους πελάτες αντέχει το σημερινό στήσιμο και πότε αξίζει το web app.
 *   RT_<εργασία> = { "ΕΕΕΕ-ΜΜ-ΗΗ": [ms, εκτελέσεις, μέγιστο ms] } (τελευταίες 14 ημέρες, ώρα Ελλάδας)
 *   RT_OPEN_<εργασία> = έναρξη της τρέχουσας εκτέλεσης· αν μείνει (η Google την έκοψε στα 6′), η επόμενη μετρά 6′.
 * Μόνο εκτελέσεις από trigger (το event object έχει triggerUid): όχι από τον editor ή το web app (δεν μετρούν στο όριο).
 * Διαχειριστικό → «Σήμερα» → «Αυτόματες εργασίες και έσοδα»: σήμερα / 90′, 7 ημέρες, ανά εργασία, πελάτες, έσοδα τον μήνα.
 * Μία φορά τη μέρα (κύκλος πληρωμών): admin/runtime.json στο publisher-work (14 ημέρες) για τον Claude· αν χθες ≥ 80% του
 * ορίου → email στο okpublisher. Η μέτρηση δεν σταματά ποτέ μια εργασία (κάθε σφάλμα της αγνοείται).
 */
const RT_ = {
  NAMES: ['run', 'approvalCycle', 'billingCycle', 'insightsCycle', 'dedupeMaterial', 'splitBigVideos'],
  LABELS: { run: 'Δημοσίευση (κάθε 10′)', approvalCycle: 'Εγκρίσεις (κάθε 15′)', billingCycle: 'Πληρωμές (κάθε ώρα)',
    insightsCycle: 'Στατιστικά (κάθε 6 ώρες)', dedupeMaterial: 'Διπλότυπα υλικού (04:00)', splitBigVideos: 'Κόψιμο μεγάλων βίντεο' },
  LIMIT_MIN: 90,
  KEEP_DAYS: 14,
  KILL_MS: 6 * 60 * 1000,
  WARN: 0.8,
  REPO: 'admin/runtime.json',
};

function rtTrigger_(e) { return !!(e && typeof e === 'object' && e.triggerUid); }
function rtDay_(t) { return athens_(new Date(t), 'yyyy-MM-dd'); }
function rtGet_(name) {
  try { const o = JSON.parse(prop_('RT_' + name, '{}')); return o && typeof o === 'object' ? o : {}; } catch (x) { return {}; }
}
function rtAdd_(name, t0, t1) {
  const d = rtGet_(name), k = rtDay_(t0), ms = Math.max(0, t1 - t0);
  const r = Array.isArray(d[k]) ? d[k] : [0, 0, 0];
  r[0] += ms; r[1] += 1; r[2] = Math.max(r[2], ms);
  d[k] = r;
  const out = {};
  Object.keys(d).sort().slice(-RT_.KEEP_DAYS).forEach(function (x) { out[x] = d[x]; });
  P_().setProperty('RT_' + name, JSON.stringify(out));
}
// Τρέχει την εργασία και μετρά τη διάρκειά της.
function rtWrap_(name, fn) {
  const t0 = Date.now();
  try {
    const open = Number(prop_('RT_OPEN_' + name, '0'));
    if (open && t0 - open > RT_.KILL_MS + 30000) rtAdd_(name, open, open + RT_.KILL_MS);   // η προηγούμενη κόπηκε στα 6′
    P_().setProperty('RT_OPEN_' + name, String(t0));
  } catch (x) { console.log('Χρόνος εργασιών: ' + x.message); }
  try {
    return fn();
  } finally {
    try { rtAdd_(name, t0, Date.now()); P_().deleteProperty('RT_OPEN_' + name); } catch (x) { console.log('Χρόνος εργασιών: ' + x.message); }
  }
}

// Έσοδα: ενεργές πληρωμένες συνδρομές (πελάτες και agencies), καθαρά χωρίς ΦΠΑ, ανά μήνα.
function rtRevenue_() {
  let cents = 0, subs = 0;
  billingClients_().forEach(function (K) {
    const st = billState_(K);
    if (admPaying_(st)) { cents += Number(st.amount || 0); subs++; }
  });
  return { net_eur: Math.round(cents / (1 + BILL_.VAT)) / 100, subs: subs };
}

// Σύνοψη για το διαχειριστικό και το publisher-work: οι τελευταίες n ημέρες (σήμερα τελευταία).
function rtSummary_(now, n) {
  now = now || new Date(); n = n || 7;
  const today = rtDay_(now.getTime()), by = {};
  RT_.NAMES.forEach(function (x) { by[x] = rtGet_(x); });
  const days = [];
  for (let i = n - 1; i >= 0; i--) days.push(addDays_(today, -i));
  const m = function (ms) { return Math.round(ms / 600) / 100; };   // λεπτά με 2 δεκαδικά
  const rows = days.map(function (d) {
    let ms = 0, runs = 0;
    const tasks = {};
    RT_.NAMES.forEach(function (x) {
      const r = by[x][d];
      if (!r) return;
      ms += r[0]; runs += r[1];
      tasks[x] = { min: m(r[0]), runs: r[1], max_s: Math.round(r[2] / 1000) };
    });
    return { day: d, min: m(ms), runs: runs, pct: Math.round(ms / 600 / RT_.LIMIT_MIN), tasks: tasks };
  });
  let rev = { net_eur: 0, subs: 0 };
  try { rev = rtRevenue_(); } catch (x) { console.log('Έσοδα: ' + x.message); }
  let cl = 0;
  try { cl = clients_().length; } catch (x) { cl = 0; }
  return { limit_min: RT_.LIMIT_MIN, today: today, days: rows, labels: RT_.LABELS, clients: cl, revenue: rev };
}

// Μία φορά τη μέρα (από τον κύκλο πληρωμών): αρχείο για τον Claude + email αν χθες πλησίασε το όριο.
function rtDaily_(now) {
  now = now || new Date();
  const today = rtDay_(now.getTime());
  if (prop_('RT_DAILY', '') === today) return;
  const s = rtSummary_(now, RT_.KEEP_DAYS);
  if (prop_('GITHUB_TOKEN', '')) {
    ghPutJson_(RT_.REPO, Object.assign({ updated: now.toISOString(),
      note: 'Χρόνος αυτόματων εργασιών (όριο Google ' + RT_.LIMIT_MIN + '′/μέρα σε δωρεάν Gmail) και έσοδα. Το γράφει μόνο το Runtime.gs, μία φορά τη μέρα.' }, s),
      'Χρόνος αυτόματων εργασιών ' + today);
  }
  P_().setProperty('RT_DAILY', today);
  const y = s.days[s.days.length - 2];
  if (y && y.min >= RT_.LIMIT_MIN * RT_.WARN) {
    systemNotify_('Αυτόματες εργασίες: ' + Math.round(y.min) + '′ από ' + RT_.LIMIT_MIN + '′ χθες',
      'Χθες (' + y.day + ') οι αυτόματες εργασίες χρειάστηκαν ' + Math.round(y.min) + ' λεπτά από τα ' + RT_.LIMIT_MIN + ' που δίνει η Google τη μέρα ' +
      '(πελάτες: ' + s.clients + '). Αν ξεπεραστεί, οι δημοσιεύσεις σταματούν ως την επόμενη μέρα. Λεπτομέρειες: διαχειριστικό → Σήμερα.');
  }
}
