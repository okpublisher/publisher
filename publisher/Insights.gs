/**
 * Μηνιαία αναφορά και αυτόματες ώρες (okpublisher, ξεχωριστό αρχείο στο ίδιο project).
 *
 * Αυτόματες ώρες: από το online_followers του Instagram (τελευταίες 30 ημέρες· μόνο λογαριασμοί με 100+ ακόλουθους).
 *   Γράφονται στο ιδιωτικό repo ως clients/<K>/best_times.json, στις 15 κάθε μήνα (η παραγωγή είναι στις 20).
 *   Το studio τις χρησιμοποιεί ΜΟΝΟ αν το config.json του πελάτη έχει "times": "auto"· αλλιώς μένουν οι ώρες
 *   post_time / story_time του config (π.χ. όσες όρισε ο ίδιος ο πελάτης). Κάτω από 100 ακόλουθους ή με λίγα
 *   δεδομένα γράφεται "mode": "default" και μένουν οι προεπιλεγμένες ώρες.
 * Μηνιαία αναφορά: την 1η κάθε μήνα, από τις 09:00, για τον μήνα που πέρασε. ΞΕΧΩΡΙΣΤΟ email (όχι μέσα στην έγκριση),
 *   μόνο στο NOTIFY_TO_<K>. Τα στοιχεία μένουν και στο repo: clients/<K>/reports/<yyyy-MM>.json.
 *   Μόνο για μήνες που κάλυψε ολόκληρους το okpublisher (από START_AFTER) και είχαν τουλάχιστον μία δημοσίευση.
 *   Αν η αποστολή κοπεί στη μέση, δεν ξαναγίνεται (όχι δεύτερο email)· αναφέρεται στο inbox του okpublisher.
 * Stories: τα στατιστικά τους υπάρχουν μόνο 24 ώρες, γι' αυτό καταγράφονται κάθε 6 ώρες στο φύλλο «Stories».
 *
 * Ρυθμίσεις: REPORT_<K> = false → καμία αναφορά για αυτόν τον πελάτη.
 * Άδειες εφαρμογής Meta: instagram_manage_insights και pages_read_engagement (μετά την προσθήκη τους, νέο token).
 * Συναρτήσεις: checkInsights() (έλεγχος, δεν αλλάζει τίποτα) · previewReport() / previewCurrentMonth() (αναφορά του
 *   προηγούμενου / του τρέχοντος μήνα ΜΟΝΟ στο repo, ΧΩΡΙΣ email) · updateBestTimes() · setupInsights() (κάθε 6 ώρες) ·
 *   insightsCycle().
 */
const INS_ = {
  EVERY_H: 6,
  REPORT_HOUR: 9,
  BEST_DAY: 15,
  MIN_FOLLOWERS: 100,
  MIN_DAYS: 7,
  POST_HOURS: [8, 22],
  STORY_HOURS: [8, 20],
  GAP_H: 3,
  DEFAULT_STORY_H: 10,
  STORY_WINDOW_H: 26,
  TOP_N: 3,
  MAX_RANGE_S: 30 * 86400,
  POST_METRICS: 'reach,views,likes,comments,shares,saved,total_interactions',
  POST_METRICS_MIN: 'reach,likes,comments,saved',
  STORY_METRICS: 'reach,views,replies,total_interactions',
  STORY_SHEET: 'Stories',
  MONTHS_GEN: ['Ιανουαρίου', 'Φεβρουαρίου', 'Μαρτίου', 'Απριλίου', 'Μαΐου', 'Ιουνίου', 'Ιουλίου', 'Αυγούστου',
    'Σεπτεμβρίου', 'Οκτωβρίου', 'Νοεμβρίου', 'Δεκεμβρίου'],
  TYPE_EL: { REEL: 'Reel', CAROUSEL: 'Carousel', IMAGE: 'Εικόνα', STORY: 'Story' },
};
const STORY_H_ = ['Δημοσίευση', 'Πελάτης', 'ID', 'Media', 'Εμβέλεια', 'Προβολές', 'Αλληλεπιδράσεις', 'Απαντήσεις', 'Μέτρηση', 'Σημείωση'];

// ------------------------------------------------------------------ κύκλος
function setupInsights() { manualOnly_('setupInsights');
  ScriptApp.getProjectTriggers().forEach(function (t) {
    if (t.getHandlerFunction() === 'insightsCycle') ScriptApp.deleteTrigger(t);
  });
  ScriptApp.newTrigger('insightsCycle').timeBased().everyHours(INS_.EVERY_H).create();
  console.log('Έτοιμο: στατιστικά stories κάθε ' + INS_.EVERY_H + ' ώρες, αυτόματες ώρες στις ' + INS_.BEST_DAY +
    ' του μήνα, αναφορά την 1η (από τις 0' + INS_.REPORT_HOUR + ':00). Τρέχει και τώρα μία φορά…');
  insightsCycle();
}

function insightsCycle(e) {
  if (rtTrigger_(e)) return rtWrap_('insightsCycle', function () { return insightsCycle(); });   // χρόνος εργασίας (Runtime.gs)
  const now = new Date(), problems = [];
  clients_().forEach(function (K) {
    if (!cprop_(K, 'TOKEN', '')) return;
    try { captureStories_(K, now); } catch (e) { problems.push(K + ' (stories): ' + e.message); }
    try {
      if (Number(athens_(now, 'dd')) >= INS_.BEST_DAY && prop_('BEST_TIMES_AT_' + K, '') !== athens_(now, 'yyyy-MM')) {
        saveBestTimes_(K, now);
      }
    } catch (e) { problems.push(K + ' (ώρες): ' + e.message); }
    try { maybeReport_(K, now); } catch (e) { problems.push(K + ' (αναφορά): ' + e.message); }
  });
  if (problems.length) {
    const text = problems.join('\n');
    if (prop_('LAST_INS_PROBLEMS', '') !== text) {
      P_().setProperty('LAST_INS_PROBLEMS', text.slice(0, 8000));
      systemNotify_('Στατιστικά / αναφορά', text);
    }
  }
}

// ------------------------------------------------------------------ μήνες (ώρα Ελλάδας)
// 1η του μήνα στις 00:00 ώρα Ελλάδας. Θερινή ώρα (+03:00) ισχύει την 1η Απριλίου έως την 1η Οκτωβρίου.
function monthStart_(y, m) {
  return new Date(y + '-' + ('0' + m).slice(-2) + '-01T00:00:00' + (m >= 4 && m <= 10 ? '+03:00' : '+02:00'));
}

function monthRange_(y, m) {
  const ny = m === 12 ? y + 1 : y, nm = m === 12 ? 1 : m + 1;
  return { key: y + '-' + ('0' + m).slice(-2), y: y, m: m, start: monthStart_(y, m), end: monthStart_(ny, nm) };
}

function prevMonth_(now) {
  let y = Number(athens_(now, 'yyyy')), m = Number(athens_(now, 'MM')) - 1;
  if (m === 0) { m = 12; y--; }
  return monthRange_(y, m);
}

// ------------------------------------------------------------------ δεδομένα
function nz_(x) { return x === null || x === undefined ? '' : x; }
function num_(n) { return String(Math.round(Number(n) || 0)).replace(/\B(?=(\d{3})+(?!\d))/g, '.'); }
function pl_(n, one, many) { return num_(n) + ' ' + (Number(n) === 1 ? one : many); }
function hhmm_(h) { return ('0' + h).slice(-2) + ':00'; }
function isoTime_(s) { return new Date(String(s || '').replace(/([+-]\d\d)(\d\d)$/, '$1:$2')); }

// Ό,τι δημοσιεύτηκε για τον πελάτη K στο [from, to), από το φύλλο «Ιστορικό» (ένα αντικείμενο ανά ID).
function published_(K, from, to) {
  const sh = SpreadsheetApp.getActive().getSheetByName('Ιστορικό');
  if (!sh) return [];
  const S = P_(), rows = sh.getDataRange().getValues(), out = {};
  for (let i = 1; i < rows.length; i++) {
    const r = rows[i];
    if (String(r[1]) !== K) continue;
    const st = String(r[4]), ig = st === 'Instagram: ΔΗΜΟΣΙΕΥΤΗΚΕ', fb = st === 'Facebook: ΔΗΜΟΣΙΕΥΤΗΚΕ';
    if (!ig && !fb) continue;
    const t = new Date(r[0]);
    if (isNaN(t.getTime()) || t < from || t >= to) continue;
    const id = String(r[2]);
    const o = out[id] || (out[id] = { id: id, type: String(r[3]), at: t, ig: null, fb: null });
    if (t < o.at) o.at = t;
    if (ig) {
      let media = '';
      try { media = JSON.parse(S.getProperty('done_' + id) || '{}').media || ''; } catch (e) { media = ''; }
      o.ig = { link: String(r[5] || ''), media: String(media) };
    }
    if (fb) o.fb = { link: String(r[5] || '') };
  }
  return Object.keys(out).map(function (k) { return out[k]; }).sort(function (a, b) { return a.at - b.at; });
}

function insValues_(resp) {
  const o = {};
  (resp.data || []).forEach(function (d) {
    if (d.total_value) o[d.name] = d.total_value.value;
    else if (d.values && d.values.length) o[d.name] = d.values[0].value;
  });
  return o;
}

function mediaInsights_(K, media, metrics) {
  return insValues_(api_('get', media + '/insights', { metric: metrics }, token_(K)));
}

// Στατιστικά ενός post/reel: πρώτα όλα τα metrics· αν το Instagram αρνηθεί κάποιο, τα βασικά.
function postInsights_(K, media) {
  try { return mediaInsights_(K, media, INS_.POST_METRICS); }
  catch (e) { return mediaInsights_(K, media, INS_.POST_METRICS_MIN); }
}

function followers_(K) {
  const tok = token_(K), out = {};
  try { out.ig = api_('get', igUserId_(K), { fields: 'followers_count' }, tok).followers_count; } catch (e) { out.ig_error = e.message; }
  const pid = fbPageId_(K);
  if (pid) {
    try {
      const p = api_('get', pid, { fields: 'followers_count,fan_count' }, tok);
      out.fb = p.followers_count !== undefined ? p.followers_count : p.fan_count;
    } catch (e) { out.fb_error = e.message; }
  }
  return out;
}

// Σύνολα λογαριασμού για τον μήνα (το Instagram δίνει έως 30 ημέρες ανά ερώτημα: για μήνα 31 ημερών οι τελευταίες 30).
function accountMonth_(K, mr) {
  const ig = igUserId_(K), tok = token_(K);
  const until = Math.floor(mr.end.getTime() / 1000);
  const since = Math.max(Math.floor(mr.start.getTime() / 1000), until - INS_.MAX_RANGE_S);
  const base = { period: 'day', metric_type: 'total_value', since: since, until: until };
  const out = { days: Math.round((until - since) / 86400), errors: [] };
  try {
    const v = insValues_(api_('get', ig + '/insights', Object.assign({ metric: 'reach,views,accounts_engaged,total_interactions' }, base), tok));
    ['reach', 'views', 'accounts_engaged', 'total_interactions'].forEach(function (k) { if (v[k] !== undefined) out[k] = v[k]; });
  } catch (e) { out.errors.push('σύνολα: ' + e.message); }
  try {
    const r = api_('get', ig + '/insights', Object.assign({ metric: 'profile_links_taps', breakdown: 'contact_button_type' }, base), tok);
    const d = (r.data || [])[0];
    if (d && d.total_value) {
      out.contacts = { total: Number(d.total_value.value) || 0, by: {} };
      ((d.total_value.breakdowns || [])[0] || { results: [] }).results.forEach(function (x) {
        out.contacts.by[String((x.dimension_values || [''])[0])] = Number(x.value) || 0;
      });
      if (!out.contacts.total) Object.keys(out.contacts.by).forEach(function (k) { out.contacts.total += out.contacts.by[k]; });
    }
  } catch (e) { out.errors.push('επαφές: ' + e.message); }
  return out;
}

// ------------------------------------------------------------------ stories (στατιστικά μόνο για 24 ώρες)
function captureStories_(K, now) {
  const list = published_(K, new Date(now.getTime() - INS_.STORY_WINDOW_H * 36e5), now)
    .filter(function (p) { return p.type === 'STORY' && p.ig && p.ig.media; });
  if (!list.length) return 0;
  const sh = sheet_(INS_.STORY_SHEET, STORY_H_);
  const data = sh.getDataRange().getValues();
  let n = 0;
  list.forEach(function (p) {
    let v;
    try { v = mediaInsights_(K, p.ig.media, INS_.STORY_METRICS); }
    catch (e) { v = { error: /\[code 10,/.test(e.message) ? 'λιγότερες από 5 προβολές' : e.message.slice(0, 200) }; }
    const row = [p.at, K, p.id, p.ig.media, nz_(v.reach), nz_(v.views), nz_(v.total_interactions), nz_(v.replies), now, v.error || ''];
    let idx = -1;
    for (let i = 1; i < data.length; i++) if (String(data[i][1]) === K && String(data[i][2]) === p.id) idx = i;
    if (idx >= 0) {
      if (v.error && data[idx][4] !== '' && data[idx][4] !== null) return;   // κράτα την προηγούμενη καλή μέτρηση
      sh.getRange(idx + 1, 1, 1, row.length).setValues([row]);
      data[idx] = row;
    } else {
      sh.appendRow(row);
      data.push(row);
    }
    n++;
  });
  return n;
}

function storyStats_(K, stories) {
  const sh = SpreadsheetApp.getActive().getSheetByName(INS_.STORY_SHEET);
  const by = {};
  if (sh) sh.getDataRange().getValues().slice(1).forEach(function (r) { if (String(r[1]) === K) by[String(r[2])] = r; });
  const reach = [];
  stories.forEach(function (s) { const r = by[s.id]; if (r && r[4] !== '' && r[4] !== null && !isNaN(Number(r[4]))) reach.push(Number(r[4])); });
  return { count: stories.length, measured: reach.length,
    avg_reach: reach.length ? Math.round(reach.reduce(function (a, b) { return a + b; }, 0) / reach.length) : null };
}

// ------------------------------------------------------------------ αυτόματες ώρες
function bestTimes_(K, now) {
  const tok = token_(K), ig = igUserId_(K);
  const res = { client: K, updated: now.toISOString(), source: 'Instagram online_followers (τελευταίες 30 ημέρες)', mode: 'default' };
  try { res.followers = api_('get', ig, { fields: 'followers_count' }, tok).followers_count; } catch (e) { res.followers = null; }
  if (res.followers !== null && res.followers !== undefined && res.followers < INS_.MIN_FOLLOWERS) {
    res.reason = 'λιγότεροι από ' + INS_.MIN_FOLLOWERS + ' ακόλουθοι';
    return res;
  }
  const until = Math.floor(now.getTime() / 1000);
  let r;
  try {
    r = api_('get', ig + '/insights', { metric: 'online_followers', period: 'lifetime', since: until - INS_.MAX_RANGE_S, until: until }, tok);
  } catch (e) { res.reason = 'online_followers: ' + e.message.slice(0, 200); return res; }
  const sum = [], cnt = [];
  for (let h = 0; h < 24; h++) { sum.push(0); cnt.push(0); }
  let days = 0;
  (((r.data || [])[0] || {}).values || []).forEach(function (v) {
    const o = v.value;
    if (!o || typeof o !== 'object' || !Object.keys(o).length) return;
    const end = isoTime_(v.end_time).getTime();
    if (isNaN(end)) return;
    days++;
    // Οι ώρες 0–23 μετρούν από την αρχή του 24ώρου που τελειώνει στο end_time → μετατροπή σε ώρα Ελλάδας.
    Object.keys(o).forEach(function (k) {
      const h = Number(k);
      if (!(h >= 0 && h < 24)) return;
      const ath = Number(athens_(new Date(end - 864e5 + h * 36e5), 'HH'));
      sum[ath] += Number(o[k]) || 0;
      cnt[ath]++;
    });
  });
  res.days = days;
  if (days < INS_.MIN_DAYS) { res.reason = 'λίγα δεδομένα (' + days + ' ημέρες)'; return res; }
  const avg = sum.map(function (s, i) { return cnt[i] ? Math.round(s / cnt[i]) : 0; });
  function pick(range, avoid) {
    let best = -1;
    for (let h = range[0]; h <= range[1]; h++) {
      if (avoid !== undefined && Math.abs(h - avoid) < INS_.GAP_H) continue;
      if (best < 0 || avg[h] > avg[best]) best = h;
    }
    return best;
  }
  const ph = pick(INS_.POST_HOURS), sh = pick(INS_.STORY_HOURS, ph);
  let peak = 0;
  for (let h = 1; h < 24; h++) if (avg[h] > avg[peak]) peak = h;
  res.mode = 'auto';
  res.post_time = hhmm_(ph);
  res.story_time = hhmm_(sh >= 0 ? sh : INS_.DEFAULT_STORY_H);
  res.peak_time = hhmm_(peak);
  res.hourly_avg = avg;
  return res;
}

function saveBestTimes_(K, now) {
  const res = bestTimes_(K, now);
  ghPutJson_('clients/' + K + '/best_times.json', res, 'okpublisher: ' + K + ' αυτόματες ώρες (' + res.mode + ')');
  const brief = { mode: res.mode, post_time: res.post_time || '', story_time: res.story_time || '', peak_time: res.peak_time || '',
    followers: res.followers, reason: res.reason || '', at: res.updated };
  P_().setProperty('BEST_TIMES_' + K, JSON.stringify(brief));
  P_().setProperty('BEST_TIMES_AT_' + K, athens_(now, 'yyyy-MM'));
  return res;
}

function updateBestTimes() { manualOnly_('updateBestTimes');
  const now = new Date();
  clients_().forEach(function (K) {
    if (!cprop_(K, 'TOKEN', '')) { console.log('[' + K + '] χωρίς token'); return; }
    try {
      const r = saveBestTimes_(K, now);
      console.log('[' + K + '] ' + (r.mode === 'auto' ? 'posts ' + r.post_time + ', stories ' + r.story_time + ' (κορυφή ' + r.peak_time +
        ', ' + r.days + ' ημέρες)' : 'προεπιλεγμένες ώρες: ' + r.reason));
    } catch (e) { console.log('[' + K + '] ΣΦΑΛΜΑ: ' + e.message); }
  });
}

// ------------------------------------------------------------------ μηνιαία αναφορά
function buildReport_(K, mr, now) {
  const pubs = published_(K, mr.start, mr.end);
  if (!pubs.length) return null;
  const posts = pubs.filter(function (p) { return p.type !== 'STORY'; });
  const stories = pubs.filter(function (p) { return p.type === 'STORY'; });
  const errors = [];
  posts.forEach(function (p) {
    if (!p.ig || !p.ig.media) return;
    try { p.m = postInsights_(K, p.ig.media); } catch (e) { errors.push(p.id + ': ' + e.message); }
  });
  const counts = { posts: posts.length, stories: stories.length, by_type: {},
    ig_posts: posts.filter(function (p) { return p.ig; }).length, ig_stories: stories.filter(function (p) { return p.ig; }).length,
    fb_posts: posts.filter(function (p) { return p.fb; }).length, fb_stories: stories.filter(function (p) { return p.fb; }).length };
  posts.forEach(function (p) { counts.by_type[p.type] = (counts.by_type[p.type] || 0) + 1; });
  let interactions = 0;
  posts.forEach(function (p) { if (p.m) interactions += ['likes', 'comments', 'shares', 'saved'].reduce(function (a, k) { return a + (Number(p.m[k]) || 0); }, 0); });
  const top = posts.filter(function (p) { return p.m && p.m.reach !== undefined; })
    .sort(function (a, b) { return (Number(b.m.reach) || 0) - (Number(a.m.reach) || 0) || (Number(b.m.total_interactions) || 0) - (Number(a.m.total_interactions) || 0); })
    .slice(0, INS_.TOP_N)
    .map(function (p) { return { id: p.id, type: p.type, date: athens_(p.at, 'd/M'), link: p.ig.link, reach: p.m.reach, interactions: nz_(p.m.total_interactions) }; });
  const acc = accountMonth_(K, mr);
  errors.push.apply(errors, acc.errors);
  const fol = followers_(K);
  let prev = null, best = null, cfg = null;
  try { prev = JSON.parse(prop_('FOLLOWERS_' + K, 'null')); } catch (e) { prev = null; }
  if (prev && !(prev.month < mr.key)) prev = null;
  try { best = JSON.parse(prop_('BEST_TIMES_' + K, 'null')); } catch (e) { best = null; }
  try { cfg = ghJson_('clients/' + K + '/config.json'); } catch (e) { cfg = null; }
  return {
    client: K, name: clientName_(K), month: mr.key, generated: now.toISOString(),
    first: athens_(pubs[0].at, 'd/M'), last: athens_(pubs[pubs.length - 1].at, 'd/M'),
    counts: counts, interactions: interactions, top: top, stories: storyStats_(K, stories), account: acc,
    followers: { now: { ig: fol.ig, fb: fol.fb }, prev: prev },
    times: { best: best, mode: cfg ? (cfg.times === 'auto' ? 'auto' : 'manual') : '', post_time: cfg ? nz_(cfg.post_time) : '', story_time: cfg ? nz_(cfg.story_time) : '' },
    posts: posts.map(function (p) { return { id: p.id, type: p.type, at: p.at.toISOString(), link: p.ig ? p.ig.link : '', m: p.m || null }; }),
    errors: errors,
  };
}

function delta_(a, b) {
  if (a === undefined || a === null) return '';
  if (b === undefined || b === null) return num_(a);
  const d = Number(a) - Number(b);
  return num_(b) + ' → ' + num_(a) + ' (' + (d >= 0 ? '+' : '−') + num_(Math.abs(d)) + ')';
}

// Κείμενο της αναφοράς: λίστα από [επικεφαλίδα|null, γραμμή]. Χωρίς τεχνικά σφάλματα (αυτά πάνε στο okpublisher).
function reportLines_(d, mr) {
  const L = [], c = d.counts, a = d.account;
  const names = { REEL: ['reel', 'reels'], CAROUSEL: ['carousel', 'carousel'], IMAGE: ['εικόνα', 'εικόνες'] };
  const types = ['REEL', 'CAROUSEL', 'IMAGE'].filter(function (t) { return c.by_type[t]; })
    .map(function (t) { return pl_(c.by_type[t], names[t][0], names[t][1]); });
  L.push(['Τι δημοσιεύτηκε', 'Instagram: ' + pl_(c.ig_posts, 'post', 'posts') + (types.length ? ' (' + types.join(', ') + ')' : '') +
    ' και ' + pl_(c.ig_stories, 'story', 'stories')]);
  if (c.fb_posts || c.fb_stories) L.push([null, 'Facebook: ' + pl_(c.fb_posts, 'post', 'posts') + ' και ' + pl_(c.fb_stories, 'story', 'stories')]);
  const res = [];
  if (a.reach !== undefined) res.push(num_(a.reach) + ' λογαριασμοί είδαν το περιεχόμενό σας');
  if (a.views !== undefined) res.push(num_(a.views) + ' προβολές');
  if (a.total_interactions !== undefined) res.push(num_(a.total_interactions) + ' αλληλεπιδράσεις (likes, σχόλια, αποθηκεύσεις, κοινοποιήσεις)');
  else if (d.interactions) res.push(num_(d.interactions) + ' αλληλεπιδράσεις στα posts');
  if (a.contacts && a.contacts.total) res.push(num_(a.contacts.total) + ' πατήματα σε «Κλήση», «Οδηγίες», «Email» κ.λπ. στο προφίλ');
  if (res.length) {
    L.push(['Αποτελέσματα στο Instagram' + (monthDays_(mr) > a.days ? ' (τελευταίες ' + a.days + ' ημέρες του μήνα)' : ''), res[0]]);
    res.slice(1).forEach(function (r) { L.push([null, r]); });
  }
  const f = d.followers, fl = [];
  if (f.now.ig !== undefined) fl.push('Instagram ' + delta_(f.now.ig, f.prev && f.prev.ig));
  if (f.now.fb !== undefined) fl.push('Facebook ' + delta_(f.now.fb, f.prev && f.prev.fb));
  if (fl.length) L.push(['Ακόλουθοι', fl.join(' · ')]);
  if (d.top.length) {
    L.push(['Τα posts με τη μεγαλύτερη εμβέλεια', null]);
    d.top.forEach(function (t, i) {
      L.push([null, (i + 1) + '. ' + t.date + ' ' + INS_.TYPE_EL[t.type] + ': ' + num_(t.reach) + ' λογαριασμοί' +
        (t.interactions !== '' ? ', ' + num_(t.interactions) + ' αλληλεπιδράσεις' : '') + (t.link ? ' — ' + t.link : '')]);
    });
  }
  if (d.stories.count) {
    L.push(['Stories', pl_(d.stories.count, 'story', 'stories') + (d.stories.avg_reach !== null ? ', κατά μέσο όρο ' + num_(d.stories.avg_reach) + ' λογαριασμοί το καθένα' : '') + '.']);
  }
  const t = d.times, b = t.best;
  if (t.mode === 'auto' && b && b.mode === 'auto') {
    L.push(['Ώρες δημοσίευσης', 'Οι ακόλουθοί σας είναι πιο πολύ online γύρω στις ' + b.peak_time + '. Τα posts βγαίνουν στις ' + b.post_time +
      ' και τα stories στις ' + b.story_time + ', αυτόματα με βάση αυτό. Αν προτιμάτε δικές σας ώρες, απαντήστε σε αυτό το email.']);
  } else if (t.mode === 'auto') {
    L.push(['Ώρες δημοσίευσης', 'Μέχρι τους ' + INS_.MIN_FOLLOWERS + ' ακόλουθους χρησιμοποιούμε σταθερές ώρες· μετά τις υπολογίζουμε αυτόματα από το πότε είναι online οι ακόλουθοί σας.']);
  } else if (t.mode === 'manual' && t.post_time) {
    L.push(['Ώρες δημοσίευσης', 'Οι δημοσιεύσεις βγαίνουν στις ώρες που έχουν οριστεί (posts ' + t.post_time + (t.story_time ? ', stories ' + t.story_time : '') + ').' +
      (b && b.mode === 'auto' ? ' Οι ακόλουθοί σας είναι πιο πολύ online γύρω στις ' + b.peak_time + '· αν θέλετε να περάσουμε σε αυτόματες ώρες, απαντήστε σε αυτό το email.' : '')]);
  }
  return L;
}

function monthDays_(mr) { return Math.round((mr.end - mr.start) / 864e5); }

function esc_(s) { return String(s).replace(/&/g, '&amp;').replace(/</g, '&lt;').replace(/>/g, '&gt;').replace(/"/g, '&quot;'); }

function reportMail_(d, mr) {
  const title = 'Αναφορά ' + INS_.MONTHS_GEN[mr.m - 1] + ' ' + mr.y;
  const L = reportLines_(d, mr);
  const text = [title + ' · ' + d.name, ''];
  const html = ['<div style="font-family:Arial,Helvetica,sans-serif;font-size:15px;line-height:1.5;color:#1F2328;max-width:560px">',
    '<h2 style="margin:0 0 4px;font-size:20px">' + esc_(title) + '</h2>', '<div style="color:#57606a;margin-bottom:12px">' + esc_(d.name) + '</div>'];
  let open = false;
  L.forEach(function (x) {
    if (x[0]) {
      if (open) html.push('</ul>');
      text.push('', x[0]);
      html.push('<h3 style="margin:16px 0 4px;font-size:16px">' + esc_(x[0]) + '</h3><ul style="margin:0;padding-left:20px">');
      open = true;
    }
    if (x[1]) {
      text.push('• ' + x[1]);
      html.push('<li>' + esc_(x[1]).replace(/(https?:\/\/\S+)/g, '<a href="$1">δείτε το</a>') + '</li>');
    }
  });
  if (open) html.push('</ul>');
  // Πελάτης agency: χωρίς «OK Publisher», για να μπορεί η agency να την προωθήσει όπως είναι (Agency.gs).
  const sig = agencyOf_(d.client) ? '' : 'OK Publisher';
  text.push('', 'Για οποιαδήποτε ερώτηση, απαντήστε σε αυτό το email.');
  if (sig) text.push(sig);
  html.push('<p style="margin-top:20px">Για οποιαδήποτε ερώτηση, απαντήστε σε αυτό το email.' + (sig ? '<br>' + sig : '') + '</p></div>');
  return { subject: title + ' · ' + d.name, text: text.join('\n'), html: html.join('') };
}

function maybeReport_(K, now) {
  if (cprop_(K, 'REPORT', 'true') === 'false') return false;
  if (Number(athens_(now, 'dd')) === 1 && Number(athens_(now, 'HH')) < INS_.REPORT_HOUR) return false;
  const mr = prevMonth_(now);
  if (prop_('REPORT_SENT_' + K, '') >= mr.key) return false;
  const after = startAfter_();
  if (after && after.getTime() > mr.start.getTime()) { P_().setProperty('REPORT_SENT_' + K, mr.key + ' (όχι ολόκληρος μήνας)'); return false; }
  if (prop_('REPORT_SENDING_' + K, '') === mr.key) {
    P_().setProperty('REPORT_SENT_' + K, mr.key + ' (διακόπηκε)');
    systemNotify_('Αναφορά ' + K + ' ' + mr.key + ' διακόπηκε', 'Η αποστολή της μηνιαίας αναφοράς ξεκίνησε αλλά δεν ολοκληρώθηκε. ' +
      'Δεν ξαναστέλνεται αυτόματα (για να μη φτάσει δεύτερο email στον πελάτη). Έλεγξε τα Απεσταλμένα.');
    return false;
  }
  const d = buildReport_(K, mr, now);
  if (!d) { P_().setProperty('REPORT_SENT_' + K, mr.key + ' (χωρίς δημοσιεύσεις)'); return false; }
  const mail = reportMail_(d, mr);
  P_().setProperty('REPORT_SENDING_' + K, mr.key);
  const r = sendMail_(K, { subject: mail.subject, text: mail.text, html: mail.html });
  P_().setProperty('REPORT_SENT_' + K, mr.key);
  P_().deleteProperty('REPORT_SENDING_' + K);
  P_().setProperty('FOLLOWERS_' + K, JSON.stringify({ month: mr.key, ig: d.followers.now.ig, fb: d.followers.now.fb }));
  d.email = { message_id: r.message_id, thread_id: r.thread_id, subject: mail.subject, text: mail.text };
  ghPutJson_('clients/' + K + '/reports/' + mr.key + '.json', d, 'okpublisher: ' + K + ' μηνιαία αναφορά ' + mr.key);
  if (d.errors.length) systemNotify_('Αναφορά ' + K + ' ' + mr.key + ': στοιχεία που έλειψαν', d.errors.join('\n'));
  return true;
}

// Προεπισκόπηση ΜΟΝΟ στο repo (clients/<K>/reports/<μήνας>.preview.json) και στο αρχείο καταγραφής. Κανένα email.
function previewReport() { manualOnly_('previewReport'); previewFor_(prevMonth_(new Date()), new Date()); }          // ο προηγούμενος μήνας
function previewCurrentMonth() { manualOnly_('previewCurrentMonth');                                                        // ο τρέχων μήνας μέχρι τώρα
  const now = new Date(), y = Number(athens_(now, 'yyyy')), m = Number(athens_(now, 'MM'));
  const mr = monthRange_(y, m);
  mr.end = now;
  previewFor_(mr, now);
}

function previewFor_(mr, now) {
  clients_().forEach(function (K) {
    if (!cprop_(K, 'TOKEN', '')) return;
    try {
      const d = buildReport_(K, mr, now);
      if (!d) { console.log('[' + K + '] ' + mr.key + ': καμία δημοσίευση από το okpublisher'); return; }
      const mail = reportMail_(d, mr);
      ghPutJson_('clients/' + K + '/reports/' + mr.key + '.preview.json', { data: d, subject: mail.subject, text: mail.text, html: mail.html },
        'okpublisher: ' + K + ' προεπισκόπηση αναφοράς ' + mr.key);
      console.log('[' + K + '] προεπισκόπηση (ΔΕΝ στάλθηκε):\n' + mail.text + (d.errors.length ? '\n\nΣτοιχεία που έλειψαν:\n' + d.errors.join('\n') : ''));
    } catch (e) { console.log('[' + K + '] ΣΦΑΛΜΑ: ' + e.message); }
  });
}

// ------------------------------------------------------------------ έλεγχος (δεν αλλάζει τίποτα)
function checkInsights() { manualOnly_('checkInsights');
  const out = [], now = new Date();
  clients_().forEach(function (K) {
    const line = ['[' + K + ']'];
    if (!cprop_(K, 'TOKEN', '')) { out.push(line.concat(['χωρίς token']).join(' · ')); return; }
    try {
      const tok = token_(K), ig = igUserId_(K);
      try { line.push('ακόλουθοι IG: ' + api_('get', ig, { fields: 'followers_count' }, tok).followers_count); } catch (e) { line.push('ακόλουθοι: ' + e.message); }
      const until = Math.floor(now.getTime() / 1000);
      try {
        const v = insValues_(api_('get', ig + '/insights', { metric: 'reach', period: 'day', metric_type: 'total_value', since: until - 86400, until: until }, tok));
        line.push('insights: OK (εμβέλεια 24ώρου ' + nz_(v.reach) + ')');
      } catch (e) { line.push('insights: ' + e.message + ' (χρειάζεται instagram_manage_insights και νέο token)'); }
      try {
        const r = api_('get', ig + '/insights', { metric: 'online_followers', period: 'lifetime', since: until - 3 * 86400, until: until }, tok);
        line.push('online_followers: ' + ((((r.data || [])[0] || {}).values || []).length ? 'OK' : 'κενό (λιγότεροι από 100 ακόλουθοι;)'));
      } catch (e) { line.push('online_followers: ' + e.message); }
    } catch (e) { line.push(e.message); }
    line.push('αναφορά: ' + (cprop_(K, 'REPORT', 'true') === 'false' ? 'ΟΧΙ (REPORT_' + K + '=false)' : 'ναι') +
      (prop_('REPORT_SENT_' + K, '') ? ', τελευταία ' + prop_('REPORT_SENT_' + K, '') : ''));
    line.push('ώρες: ' + (prop_('BEST_TIMES_' + K, '') || 'δεν έχουν υπολογιστεί'));
    out.push(line.join(' · '));
  });
  const t = ScriptApp.getProjectTriggers().filter(function (t) { return t.getHandlerFunction() === 'insightsCycle'; }).length;
  out.push(t ? 'Κύκλος στατιστικών: ενεργός' : 'Κύκλος στατιστικών: ΟΧΙ ακόμα (setupInsights)');
  console.log(out.join('\n'));
  return out;
}
