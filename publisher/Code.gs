/**
 * okpublisher — δημοσίευση για πολλούς πελάτες (Instagram + Facebook)
 *
 * Δημοσιεύει στο Instagram (post, carousel, story, reel) μέσω του Instagram Graph API και τα ίδια στη σελίδα
 * Facebook κάθε πελάτη, σύμφωνα με την ουρά (queue.json). Στην ουρά μπαίνει μόνο ό,τι έχει εγκρίνει ο πελάτης.
 * Τρέχει στον λογαριασμό Google του okpublisher (δικό του Sheet «okpublisher», δικά του Script Properties),
 * ανεξάρτητα από κάθε άλλο project.
 *
 * Πελάτες: Ιδιότητα σεναρίου CLIENTS = κλειδιά χωρισμένα με κόμμα, π.χ. ORE ή ORE,KAL,NEA
 * Ανά πελάτη <K> (π.χ. TOKEN_ORE):
 *   TOKEN_<K>        Page access token της σελίδας (μόνιμο, «Expires: Never»). Το βάζεις εσύ.
 *   IG_USER_<K>      Instagram Business Account ID   } τα βρίσκει και τα γράφει μόνο του
 *   FB_PAGE_<K>      Facebook Page ID                 } το findInstagramIds()
 *   NOTIFY_TO_<K>    email του πελάτη: εκεί πάνε ΟΛΕΣ οι ειδοποιήσεις που τον αφορούν (πολλά με κόμμα).
 *                    Κενό = καμία ειδοποίηση προς τον πελάτη.
 *   NAME_<K>         όνομα για τα email/Sheet, π.χ. «Learning & Sensory Ωραιόκαστρο»
 *   FOLDER_<K>       φάκελος υλικού στο Drive (ID ή σύνδεσμος) — για διπλότυπα, κόψιμο βίντεο, συντόμευση
 *   QUEUE_URL_<K>    προαιρετικό: δική του ουρά (π.χ. μεταβατικά η ουρά του παλιού συστήματος)
 *   ALIAS_<K>        προαιρετικό: παλιά κλειδιά που ανήκουν σε αυτόν τον πελάτη, π.χ. ALIAS_ORE = LS
 *   PAUSED_<K>       true = παύση μόνο αυτού του πελάτη
 *   FB_ENABLED_<K>   false = μόνο Instagram
 *   REEL_STORY_<K>   false = τα reels ΔΕΝ βγαίνουν και ως story (προεπιλογή: βγαίνουν 15′ μετά)
 *   TRIAL_REELS_<K>  true = δοκιμαστικά reels (πρώτα σε μη ακολούθους)
 * Γενικές:
 *   START_AFTER      ώρα αλλαγής από το παλιό σύστημα (π.χ. 2026-11-24T15:00:00+02:00): ό,τι είναι προγραμματισμένο
 *                    πριν από αυτήν αγνοείται εντελώς (ούτε δημοσίευση, ούτε email).
 *   PAUSED           true = παύση όλων (ή pause() / resume())
 *   SYSTEM_NOTIFY_TO email για σφάλματα του ίδιου του συστήματος (όχι ενός πελάτη). Κενό = ο λογαριασμός που τρέχει
 *                    το script (okpublisher). Ποτέ προσωπικά email.
 *   GRAPH_VERSION    προαιρετικό, π.χ. v23.0
 *
 * Συναρτήσεις με το χέρι (επιλογή πάνω → Εκτέλεση):
 *   findInstagramIds()  βρίσκει και αποθηκεύει IDs Instagram/Facebook για κάθε πελάτη με token
 *   checkSetup()        ελέγχει token, δικαιώματα, λογαριασμούς, φακέλους, ουρά (δεν δημοσιεύει)
 *   dryRun()            δοκιμή στην επόμενη εικόνα κάθε πελάτη ΧΩΡΙΣ δημοσίευση
 *   dryRunReel()        δοκιμή στο επόμενο reel κάθε πελάτη στο Instagram ΧΩΡΙΣ δημοσίευση (1–3 λεπτά ανά reel)
 *   dryRunReelFb()      το ίδιο στο Facebook: ανεβαίνει ως πρόχειρο και σβήνεται, ΧΩΡΙΣ δημοσίευση
 *   setup()             αυτόματος έλεγχος κάθε 10 λεπτά
 *   pause() / resume()  παύση / συνέχεια όλων
 * Μενού «⚙️ okpublisher» στο Sheet: «Αλλαγή ρύθμισης…», «Δες τις ρυθμίσεις».
 */

const CFG = {
  QUEUE_URL: 'https://raw.githubusercontent.com/okpublisher/publisher/main/queue.json',
  GRAPH: 'https://graph.facebook.com',
  LATE_LIMIT_MIN: 180,        // αν κάτι καθυστερήσει πάνω από 3 ώρες, δεν δημοσιεύεται (email στον πελάτη)
  MAX_FAILS: 3,               // μετά από 3 αποτυχίες σταματάει να ξαναδοκιμάζει (email στον πελάτη)
  EVERY_MIN: 10,
  REEL_STORY_DELAY_MIN: 15,   // το story ενός reel βγαίνει τόσα λεπτά μετά το reel
  QUEUE_WARN_DAYS: 5,         // email όταν η ουρά ενός πελάτη τελειώνει σε λιγότερες από τόσες ημέρες
  RUN_BUDGET_MS: 3 * 60 * 1000,   // μετά από 3′ δεν ξεκινά νέα δημοσίευση· συνεχίζει στον επόμενο κύκλο (όριο Apps Script 6′)
  VIDEO_START_MS: 60 * 1000,      // βίντεο (reel, video story) ξεκινά μόνο στο πρώτο λεπτό: μπορεί να θέλει ως 4–5′
  STATUS_KEEP_DAYS: 45,       // σημειώσεις κατάστασης για ό,τι έχει φύγει από την ουρά σβήνονται μετά από τόσες ημέρες
  SENDER_NAME: 'OK Publisher',
  TEST_IMAGE_URL: 'https://raw.githubusercontent.com/okpublisher/publisher/main/publisher/test/dryrun.jpg',
};

// ------------------------------------------------------------------ helpers
function P_() { return PropertiesService.getScriptProperties(); }
function prop_(k, d) { const v = P_().getProperty(k); return v === null || v === '' ? d : v; }
function cprop_(K, name, d) { return prop_(name + '_' + K, d); }

function clients_() {
  return String(prop_('CLIENTS', '')).split(',').map(function (s) { return s.trim().toUpperCase(); })
    .filter(function (s, i, a) { return /^[A-Z0-9]{2,12}$/.test(s) && a.indexOf(s) === i; });
}

function clientName_(K) { return cprop_(K, 'NAME', K); }

function token_(K) {
  const t = cprop_(K, 'TOKEN', '');
  if (!t) throw new Error('Λείπει το token: βάλε TOKEN_' + K + ' στις Ιδιότητες σεναρίου');
  return t;
}

function igUserId_(K) {
  const id = cprop_(K, 'IG_USER', '');
  if (!id) throw new Error('Λείπει το IG_USER_' + K + ': τρέξε findInstagramIds()');
  return id;
}

function fbPageId_(K) { return cprop_(K, 'FB_PAGE', ''); }

// Δέχεται ID ή σύνδεσμο φακέλου Drive.
function folderId_(K) {
  const v = String(cprop_(K, 'FOLDER', '')).trim();
  const m = v.match(/folders\/([A-Za-z0-9_-]+)/) || v.match(/[?&]id=([A-Za-z0-9_-]+)/);
  return m ? m[1] : v;
}

function base_() {
  const v = prop_('GRAPH_VERSION', '');
  return v ? CFG.GRAPH + '/' + v : CFG.GRAPH;
}

function api_(method, path, params, tok) {
  if (!tok) throw new Error('api_: λείπει token');
  const p = Object.assign({}, params || {}, { access_token: tok });
  let url = base_() + '/' + path;
  const opt = { method: method, muteHttpExceptions: true };
  if (method === 'get') {
    url += '?' + Object.keys(p).map(function (k) { return encodeURIComponent(k) + '=' + encodeURIComponent(p[k]); }).join('&');
  } else {
    opt.payload = p;
  }
  const res = UrlFetchApp.fetch(url, opt);
  let body = {};
  try { body = JSON.parse(res.getContentText() || '{}'); } catch (e) { body = { raw: res.getContentText() }; }
  if (res.getResponseCode() >= 400 || body.error) {
    const er = body.error || {};
    throw new Error('Graph API ' + res.getResponseCode() + ': ' + (er.message || res.getContentText()) +
      ' [code ' + (er.code || '') + ', subcode ' + (er.error_subcode || '') + ']');
  }
  return body;
}

// Ειδοποίηση προς τον πελάτη K (μόνο στο δικό του email). Χωρίς NOTIFY_TO_<K> δεν στέλνεται τίποτα.
function notify_(K, subject, text) {
  const to = String(cprop_(K, 'NOTIFY_TO', '')).trim();
  if (!to) { console.warn('[' + K + '] Δεν στάλθηκε email (λείπει NOTIFY_TO_' + K + '): ' + subject); return; }
  try {
    MailApp.sendEmail({ to: to, subject: '[' + clientName_(K) + '] ' + subject, body: text, name: CFG.SENDER_NAME });
  } catch (e) { console.error('email failed: ' + e.message); }
}

// Σφάλματα του ίδιου του συστήματος (όχι ενός πελάτη): στο inbox του okpublisher, ποτέ σε πελάτη ή προσωπικό email.
function systemNotify_(subject, text) {
  let to = String(prop_('SYSTEM_NOTIFY_TO', '')).trim();
  if (!to) { try { to = Session.getEffectiveUser().getEmail(); } catch (e) { to = ''; } }
  if (!to) { console.error('[system] ' + subject + ': ' + text); return; }
  try {
    MailApp.sendEmail({ to: to, subject: '[okpublisher] ' + subject, body: text, name: CFG.SENDER_NAME });
  } catch (e) { console.error('email failed: ' + e.message); }
}

function athens_(d, fmt) { return Utilities.formatDate(d, 'Europe/Athens', fmt); }

function startAfter_() {
  const v = prop_('START_AFTER', '');
  if (!v) return null;
  const d = new Date(v);
  if (isNaN(d.getTime())) throw new Error('Μη έγκυρη START_AFTER: ' + v);
  return d;
}

// Ουρά ενός πελάτη. Οι ουρές που διαβάζονται σε μία εκτέλεση κρατιούνται στη μνήμη (cache), ώστε η ίδια
// διεύθυνση να κατεβαίνει μία φορά για όλους τους πελάτες.
function fetchQueue_(K, cache) {
  const own = cprop_(K, 'QUEUE_URL', '');
  const url = own || CFG.QUEUE_URL;
  cache = cache || {};
  if (!cache[url]) {
    const res = UrlFetchApp.fetch(url + (url.indexOf('?') < 0 ? '?' : '&') + 'nocache=' + Date.now(), { muteHttpExceptions: true });
    if (res.getResponseCode() !== 200) throw new Error('Δεν διαβάστηκε η ουρά ' + url + ' (' + res.getResponseCode() + ')');
    cache[url] = JSON.parse(res.getContentText());
  }
  const accounts = [K].concat(String(cprop_(K, 'ALIAS', '')).split(',').map(function (s) { return s.trim(); }).filter(String));
  const after = startAfter_();
  let items = (cache[url].items || []).filter(function (it) {
    if (it.account ? accounts.indexOf(it.account) < 0 : !own) return false;
    return !after || new Date(it.publish_at) >= after;
  }).map(function (it) { return Object.assign({}, it, { client: K }); });
  items = withReelStories_(K, items);
  items.sort(function (a, b) { return new Date(a.publish_at) - new Date(b.publish_at); });
  return { items: items, url: url };
}

// Κάθε reel της ουράς βγαίνει και ως story (το ίδιο βίντεο), REEL_STORY_DELAY_MIN λεπτά μετά.
// Όχι αν το reel έχει "story": false ή αν REEL_STORY_<K> = false.
function withReelStories_(K, items) {
  if (cprop_(K, 'REEL_STORY', 'true') === 'false') return items;
  const have = {};
  items.forEach(function (it) { have[it.id] = true; });
  const extra = [];
  items.forEach(function (it) {
    if (it.type !== 'REEL' || it.story === false || !it.video) return;
    const id = String(it.id).replace(/-post$/, '') + '-reelstory';
    if (have[id]) return;
    extra.push({
      id: id, account: it.account, client: K, type: 'STORY', video: it.video, from_reel: it.id,
      caption: '(story από το reel ' + it.id + ')',
      publish_at: new Date(new Date(it.publish_at).getTime() + CFG.REEL_STORY_DELAY_MIN * 60000).toISOString(),
    });
  });
  return items.concat(extra);
}

// ------------------------------------------------------------------ Instagram
function createContainer_(igId, params, tok) {
  return api_('post', igId + '/media', params, tok).id;
}

function waitReady_(containerId, tries, sleepMs, tok) {
  tries = tries || 20; sleepMs = sleepMs || 3000;
  for (let i = 0; i < tries; i++) {
    const s = api_('get', containerId, { fields: 'status_code,status' }, tok);
    if (s.status_code === 'FINISHED') return;
    if (s.status_code === 'ERROR' || s.status_code === 'EXPIRED') {
      throw new Error('Container ' + containerId + ': ' + s.status_code + ' ' + (s.status || ''));
    }
    Utilities.sleep(sleepMs);
  }
  throw new Error('Το container ' + containerId + ' δεν ετοιμάστηκε εγκαίρως');
}

function storyParams_(item) {
  return item.video ? { video_url: item.video, media_type: 'STORIES' } : { image_url: item.images[0], media_type: 'STORIES' };
}

function trialOn_(item) {
  return item.type === 'REEL' && item.trial !== false && cprop_(item.client, 'TRIAL_REELS', 'false') === 'true';
}

function reelParams_(item, cap, trial) {
  const p = { media_type: 'REELS', video_url: item.video, caption: cap };
  if (item.cover) p.cover_url = item.cover;
  if (trial) p.trial_params = JSON.stringify({ graduation_strategy: prop_('TRIAL_STRATEGY', 'SS_PERFORMANCE') });
  else p.share_to_feed = 'true';
  return p;
}

function buildContainer_(item) {
  const K = item.client, ig = igUserId_(K), tok = token_(K);
  const cap = item.caption || '';
  switch (item.type) {
    case 'IMAGE':
      return createContainer_(ig, { image_url: item.images[0], caption: cap }, tok);
    case 'STORY':
      return createContainer_(ig, storyParams_(item), tok);
    case 'CAROUSEL': {
      const kids = item.images.map(function (u) {
        return createContainer_(ig, { image_url: u, is_carousel_item: 'true' }, tok);
      });
      kids.forEach(function (k) { waitReady_(k, 0, 0, tok); });
      return createContainer_(ig, { media_type: 'CAROUSEL', children: kids.join(','), caption: cap }, tok);
    }
    case 'REEL':
      return createContainer_(ig, reelParams_(item, cap, trialOn_(item)), tok);
    default:
      throw new Error('Άγνωστος τύπος: ' + item.type);
  }
}

function publishItemOnce_(item) {
  const K = item.client, ig = igUserId_(K), tok = token_(K);
  const c = buildContainer_(item);
  const isVideo = item.type === 'REEL' || !!item.video;
  waitReady_(c, isVideo ? 50 : 20, isVideo ? 5000 : 3000, tok);
  const r = api_('post', ig + '/media_publish', { creation_id: c }, tok);
  let link = '';
  try { link = api_('get', r.id, { fields: 'permalink' }, tok).permalink || ''; } catch (e) { /* τα stories δεν έχουν πάντα permalink */ }
  return { mediaId: r.id, permalink: link };
}

// Αν το Instagram δεν δεχτεί trial reel, βγαίνει ως κανονικό (email μία φορά).
function publishItem_(item) {
  if (!trialOn_(item)) return publishItemOnce_(item);
  try {
    return publishItemOnce_(item);
  } catch (e) {
    let r;
    try { r = publishItemOnce_(Object.assign({}, item, { trial: false })); } catch (e2) { throw e; }
    log_(item, 'Instagram: το trial δεν έγινε δεκτό, δημοσιεύτηκε ως κανονικό reel', e.message);
    const k = 'TRIAL_REJECTED_' + item.client;
    if (!prop_(k, '')) {
      P_().setProperty(k, new Date().toISOString());
      notify_(item.client, 'Trial reel δεν έγινε δεκτό', 'Το Instagram δεν δέχτηκε το ' + item.id + ' ως δοκιμαστικό reel και δημοσιεύτηκε ως κανονικό.\n\n' + e.message);
    }
    return r;
  }
}

// ------------------------------------------------------------------ Facebook
function fbEnabled_(item) {
  const K = item.client;
  if (cprop_(K, 'FB_ENABLED', 'true') === 'false') return false;
  if (!fbPageId_(K)) return false;
  return !item.platforms || item.platforms.indexOf('facebook') >= 0;
}

function igEnabled_(item) { return !item.platforms || item.platforms.indexOf('instagram') >= 0; }

// Βίντεο στο Facebook (reel ή video story): start → upload από URL → finish
function fbVideo_(pid, pt, edge, videoUrl, desc) {
  const st = api_('post', pid + '/' + edge, { upload_phase: 'start' }, pt);
  const up = UrlFetchApp.fetch(st.upload_url, {
    method: 'post', muteHttpExceptions: true,
    headers: { Authorization: 'OAuth ' + pt, file_url: videoUrl },
  });
  if (up.getResponseCode() >= 400) throw new Error('FB upload ' + up.getResponseCode() + ': ' + up.getContentText());
  const fin = { upload_phase: 'finish', video_id: st.video_id };
  if (edge === 'video_reels') { fin.video_state = 'PUBLISHED'; fin.description = desc || ''; }
  const r = api_('post', pid + '/' + edge, fin, pt);
  return { id: r.post_id || st.video_id, link: '' };
}

function publishFb_(item) {
  const K = item.client, pid = fbPageId_(K), pt = token_(K);   // το TOKEN_<K> είναι ήδη token της σελίδας
  const cap = item.fb_caption || item.caption || '';
  switch (item.type) {
    case 'IMAGE': {
      const r = api_('post', pid + '/photos', { url: item.images[0], message: cap, published: 'true' }, pt);
      return { id: r.post_id || r.id, link: 'https://www.facebook.com/' + (r.post_id || r.id) };
    }
    case 'CAROUSEL': {
      const p = { message: cap };
      item.images.forEach(function (u, i) {
        const ph = api_('post', pid + '/photos', { url: u, published: 'false' }, pt);
        p['attached_media[' + i + ']'] = JSON.stringify({ media_fbid: ph.id });
      });
      const r = api_('post', pid + '/feed', p, pt);
      return { id: r.id, link: 'https://www.facebook.com/' + r.id };
    }
    case 'STORY': {
      if (item.video) return fbVideo_(pid, pt, 'video_stories', item.video, '');
      const ph = api_('post', pid + '/photos', { url: item.images[0], published: 'false' }, pt);
      const r = api_('post', pid + '/photo_stories', { photo_id: ph.id }, pt);
      return { id: r.post_id || ph.id, link: '' };
    }
    case 'REEL':
      return fbVideo_(pid, pt, 'video_reels', item.video, cap);
    default:
      throw new Error('Άγνωστος τύπος: ' + item.type);
  }
}

// ------------------------------------------------------------------ main loop (trigger)
// Instagram και Facebook παρακολουθούνται χωριστά: αν αποτύχει το ένα, το άλλο δεν ξαναδημοσιεύεται.
// Κλειδιά: Instagram done_/fail_/skip_<id>, Facebook fbdone_/fbfail_/fbskip_<id> (τα id είναι μοναδικά ανά πελάτη).
function targets_(item) {
  const t = [];
  if (igEnabled_(item)) t.push({ pre: '', label: 'Instagram', fn: publishItem_, link: function (r) { return r.permalink || r.mediaId; } });
  if (fbEnabled_(item)) t.push({ pre: 'fb', label: 'Facebook', fn: publishFb_, link: function (r) { return r.link || r.id; } });
  return t;
}

function paused_(K) { return prop_('PAUSED', 'false') === 'true' || (K && cprop_(K, 'PAUSED', 'false') === 'true'); }

// Δημοσιεύει ό,τι έχει έρθει η ώρα του για έναν πελάτη. Επιστρέφει false αν τελείωσε ο χρόνος της εκτέλεσης.
// Ό,τι δεν προλαβαίνει, βγαίνει στον επόμενο κύκλο (10′ μετά), ώστε μια δημοσίευση να μη διακοπεί ποτέ στη μέση.
function runClient_(K, q, S, now, start) {
  for (let i = 0; i < q.items.length; i++) {
    const item = q.items[i];
    const when = new Date(item.publish_at);
    if (when > now) continue;
    const late = (now - when) / 60000;
    const ts = targets_(item);
    for (let j = 0; j < ts.length; j++) {
      const t = ts[j];
      const kd = t.pre + 'done_' + item.id, ks = t.pre + 'skip_' + item.id, kf = t.pre + 'fail_' + item.id;
      if (S.getProperty(kd) || S.getProperty(ks)) continue;
      if (late > CFG.LATE_LIMIT_MIN) {
        S.setProperty(ks, now.toISOString());
        log_(item, t.label + ': ΠΑΡΑΛΕΙΦΘΗΚΕ', 'Καθυστέρηση ' + Math.round(late) + ' λεπτά');
        notify_(K, 'Παραλείφθηκε ' + item.id + ' (' + t.label + ')', 'Το ' + item.id + ' δεν δημοσιεύτηκε στο ' + t.label + ' γιατί πέρασαν ' + Math.round(late) + ' λεπτά από την ώρα του.');
        continue;
      }
      const isVideo = item.type === 'REEL' || !!item.video;
      if (Date.now() - start > (isVideo ? CFG.VIDEO_START_MS : CFG.RUN_BUDGET_MS)) return false;
      try {
        const r = t.fn(item);
        const link = t.link(r);
        S.setProperty(kd, JSON.stringify({ at: new Date().toISOString(), link: link, media: r.mediaId || r.id || '' }));
        S.deleteProperty(kf);
        log_(item, t.label + ': ΔΗΜΟΣΙΕΥΤΗΚΕ', link);
      } catch (e) {
        const n = Number(S.getProperty(kf) || 0) + 1;
        S.setProperty(kf, String(n));
        log_(item, t.label + ': ΣΦΑΛΜΑ ' + n + '/' + CFG.MAX_FAILS, e.message);
        if (n >= CFG.MAX_FAILS) {
          S.setProperty(ks, now.toISOString());
          notify_(K, 'Απέτυχε ' + item.id + ' (' + t.label + ')', 'Το ' + item.id + ' απέτυχε ' + n + ' φορές στο ' + t.label + ' και δεν θα ξαναδοκιμαστεί.\n\n' + e.message);
        }
      }
    }
  }
  return true;
}

function run() {
  const lock = LockService.getScriptLock();
  if (!lock.tryLock(5000)) return;
  const start = Date.now();
  const cache = {}, queues = {}, problems = [];
  try {
    const S = P_();
    const now = new Date();
    clients_().forEach(function (K) {
      try {
        const q = fetchQueue_(K, cache);
        queues[K] = q;
        if (paused_(K)) return;
        runClient_(K, q, S, now, start);
        try { queueEndCheck_(K, q, S, now); } catch (e) { console.log('[' + K + '] Τέλος ουράς: ' + e.message); }
      } catch (e) {
        problems.push(K + ': ' + e.message);
      }
    });
    try { pruneStatus_(S, queues, now); } catch (e) { console.log('Καθάρισμα σημειώσεων: ' + e.message); }
    syncSheet_(queues);
    if (problems.length) reportProblems_(problems);
  } catch (e) {
    systemNotify_('Σφάλμα εκτέλεσης', e.message);
    throw e;
  } finally {
    lock.releaseLock();
  }
}

// Σφάλματα ρύθμισης/ουράς (όχι μιας δημοσίευσης): στο inbox του okpublisher, μία φορά ανά διαφορετικό μήνυμα.
function reportProblems_(problems) {
  const text = problems.join('\n');
  if (prop_('LAST_PROBLEMS', '') === text) return;
  P_().setProperty('LAST_PROBLEMS', text.slice(0, 8000));
  systemNotify_('Πρόβλημα σε πελάτη', text);
}

// Email μία φορά όταν η ουρά ενός πελάτη τελειώνει σε λιγότερες από QUEUE_WARN_DAYS ημέρες.
function queueEndCheck_(K, q, S, now) {
  const future = q.items.filter(function (it) { return new Date(it.publish_at) > now; });
  const last = future.length ? future[future.length - 1] : null;
  const key = last ? last.id : 'EMPTY-' + athens_(now, 'yyyy-MM');
  const pk = 'QEND_WARNED_' + K;
  if (S.getProperty(pk) === key) return;
  const daysLeft = last ? (new Date(last.publish_at) - now) / 864e5 : 0;
  if (daysLeft >= CFG.QUEUE_WARN_DAYS) return;
  S.setProperty(pk, key);
  notify_(K, 'Η ουρά τελειώνει ' + (last ? 'στις ' + athens_(new Date(last.publish_at), 'd/M') : 'τώρα'),
    (last ? 'Η τελευταία προγραμματισμένη δημοσίευση είναι ' + last.id + ' (' + athens_(new Date(last.publish_at), 'd/M HH:mm') + ').'
      : 'Δεν υπάρχει καμία επόμενη δημοσίευση στην ουρά.') +
    '\nΑν το πακέτο του επόμενου μήνα δεν έχει εγκριθεί ακόμα, δείτε το email έγκρισης.');
}

// Σβήνει σημειώσεις κατάστασης για ό,τι δεν είναι πια σε καμία ουρά και είναι παλιότερο από STATUS_KEEP_DAYS
// (όριο 500 KB στις Ιδιότητες). Ό,τι είναι ακόμα στην ουρά δεν αγγίζεται ποτέ.
function pruneStatus_(S, queues, now) {
  const live = {};
  Object.keys(queues).forEach(function (K) { queues[K].items.forEach(function (it) { live[it.id] = true; }); });
  const limit = now.getTime() - CFG.STATUS_KEEP_DAYS * 864e5;
  const all = S.getProperties();
  Object.keys(all).forEach(function (k) {
    const m = k.match(STATUS_KEY_);
    if (!m) return;
    const id = k.slice(m[0].length);
    if (live[id]) return;
    let at = null;
    if (m[2] === 'done') { try { at = new Date(JSON.parse(all[k]).at); } catch (e) { at = null; } }
    else if (m[2] === 'skip') at = new Date(all[k]);
    if (m[2] === 'fail' || !at || isNaN(at.getTime()) || at.getTime() < limit) S.deleteProperty(k);
  });
}

// ------------------------------------------------------------------ sheet view
function sheet_(name, header) {
  const ss = SpreadsheetApp.getActive();
  let sh = ss.getSheetByName(name);
  if (!sh) {
    sh = ss.insertSheet(name);
    sh.getRange(1, 1, 1, header.length).setValues([header]).setFontWeight('bold');
    sh.setFrozenRows(1);
  }
  return sh;
}

const HIST_H_ = ['Χρόνος', 'Πελάτης', 'ID', 'Τύπος', 'Κατάσταση', 'Λεπτομέρειες'];

function log_(item, status, detail) {
  const sh = sheet_('Ιστορικό', HIST_H_);
  sh.appendRow([new Date(), item.client || '', item.id, item.type, status, String(detail || '').slice(0, 500)]);
}

function status_(S, pre, id) {
  const done = S.getProperty(pre + 'done_' + id), skip = S.getProperty(pre + 'skip_' + id), fail = S.getProperty(pre + 'fail_' + id);
  if (done) { let l = ''; try { l = JSON.parse(done).link || ''; } catch (e) {} return ['Δημοσιεύτηκε', l]; }
  if (skip) return ['Δεν δημοσιεύτηκε', ''];
  if (fail) return ['Σφάλμα (' + fail + ')', ''];
  return ['Σε αναμονή', ''];
}

function syncSheet_(queues) {
  const H = ['Πελάτης', 'Ώρα δημοσίευσης', 'Τύπος', 'Λεζάντα', 'Αρχεία', 'Instagram', 'Link Instagram', 'Facebook', 'Link Facebook', 'ID'];
  const sh = sheet_('Ουρά', H);
  sh.getRange(1, 1, 1, H.length).setValues([H]).setFontWeight('bold');
  const S = P_();
  let all = [];
  Object.keys(queues).forEach(function (K) { all = all.concat(queues[K].items); });
  all.sort(function (a, b) { return new Date(a.publish_at) - new Date(b.publish_at); });
  const rows = all.map(function (it) {
    const ig = igEnabled_(it) ? status_(S, '', it.id) : ['—', ''];
    const fb = fbEnabled_(it) ? status_(S, 'fb', it.id) : ['—', ''];
    const files = (it.images || []).length + (it.video ? 1 : 0);
    return [it.client, new Date(it.publish_at), it.type, String(it.caption || '').slice(0, 120), files, ig[0], ig[1], fb[0], fb[1], it.id];
  });
  if (sh.getLastRow() > 1) sh.getRange(2, 1, sh.getLastRow() - 1, H.length).clearContent();
  if (rows.length) {
    sh.getRange(2, 1, rows.length, H.length).setValues(rows);
    sh.getRange(2, 2, rows.length, 1).setNumberFormat('ddd dd/MM HH:mm');
  }
}

function allQueues_() {
  const cache = {}, queues = {};
  clients_().forEach(function (K) {
    try { queues[K] = fetchQueue_(K, cache); } catch (e) { console.log('[' + K + '] Ουρά: ΣΦΑΛΜΑ ' + e.message); }
  });
  return queues;
}

// ------------------------------------------------------------------ manual helpers
function findInstagramIds() {
  const list = clients_();
  if (!list.length) { console.log('Βάλε πρώτα την Ιδιότητα CLIENTS (π.χ. ORE).'); return; }
  list.forEach(function (K) {
    if (!cprop_(K, 'TOKEN', '')) { console.log('[' + K + '] Δεν υπάρχει TOKEN_' + K + ' ακόμα.'); return; }
    try {
      const r = api_('get', 'me', { fields: 'id,name,instagram_business_account{id,username}' }, token_(K));
      P_().setProperty('FB_PAGE_' + K, String(r.id));
      const ig = r.instagram_business_account;
      if (ig) P_().setProperty('IG_USER_' + K, String(ig.id));
      console.log('[' + K + '] Σελίδα «' + r.name + '» (FB_PAGE_' + K + ' = ' + r.id + ')' +
        (ig ? ', Instagram @' + ig.username + ' (IG_USER_' + K + ' = ' + ig.id + ')' : ' — Η ΣΕΛΙΔΑ ΔΕΝ ΕΧΕΙ ΣΥΝΔΕΔΕΜΕΝΟ INSTAGRAM!'));
    } catch (e) { console.log('[' + K + '] ΣΦΑΛΜΑ: ' + e.message); }
  });
  console.log('Μετά τρέξε το checkSetup.');
}

function checkSetup() {
  const list = clients_();
  console.log('Πελάτες: ' + (list.join(', ') || '(κανένας — βάλε CLIENTS)'));
  const after = startAfter_();
  console.log('START_AFTER: ' + (after ? athens_(after, 'd/M/yyyy HH:mm') + ' (ό,τι είναι πριν αγνοείται)' : '(δεν έχει οριστεί)'));
  console.log('Παύση όλων: ' + (prop_('PAUSED', 'false') === 'true' ? 'ΝΑΙ' : 'όχι'));
  const cache = {}, queues = {};
  list.forEach(function (K) {
    const pre = '[' + K + '] ';
    console.log(pre + clientName_(K) + (paused_(K) ? ' — ΣΕ ΠΑΥΣΗ' : ''));
    console.log(pre + 'Ειδοποιήσεις: ' + (cprop_(K, 'NOTIFY_TO', '') || 'ΚΑΜΙΑ (λείπει NOTIFY_TO_' + K + ')'));
    try {
      const t = token_(K);
      const d = api_('get', 'debug_token', { input_token: t }, t).data || {};
      const need = ['instagram_basic', 'instagram_content_publish', 'pages_read_engagement', 'pages_manage_posts'];
      const miss = need.filter(function (n) { return (d.scopes || []).indexOf(n) < 0; });
      const exp = !d.expires_at ? 'δεν λήγει' : 'ΛΗΓΕΙ ' + athens_(new Date(d.expires_at * 1000), 'd/M/yyyy');
      console.log(pre + 'TOKEN: ' + (d.type || '?') + ', ' + exp + ', ' + (miss.length ? 'ΛΕΙΠΟΥΝ ' + miss.join(', ') : 'δικαιώματα εντάξει') + (d.is_valid === false ? ', ΜΗ ΕΓΚΥΡΟ' : ''));
      const u = api_('get', igUserId_(K), { fields: 'username,followers_count' }, t);
      console.log(pre + 'Instagram: @' + u.username + ' (' + u.followers_count + ' ακόλουθοι)');
      const pid = fbPageId_(K);
      if (!pid) console.log(pre + 'Facebook: δεν έχει οριστεί FB_PAGE_' + K + ' (μόνο Instagram)');
      else {
        const pg = api_('get', pid, { fields: 'name,followers_count' }, t);
        console.log(pre + 'Facebook: ' + pg.name + ' (' + (pg.followers_count || 0) + ' ακόλουθοι)' + (cprop_(K, 'FB_ENABLED', 'true') === 'false' ? ' — ΑΠΕΝΕΡΓΟ' : ''));
      }
    } catch (e) { console.log(pre + 'Meta: ΣΦΑΛΜΑ ' + e.message); }
    const fid = folderId_(K);
    if (!fid) console.log(pre + 'Φάκελος υλικού: δεν έχει οριστεί FOLDER_' + K);
    else {
      try {
        const f = DriveApp.getFolderById(fid);
        const access = f.getAccess(Session.getEffectiveUser());
        console.log(pre + 'Φάκελος υλικού: «' + f.getName() + '» (' + access + ')');
      } catch (e) { console.log(pre + 'Φάκελος υλικού: ΧΩΡΙΣ ΠΡΟΣΒΑΣΗ (' + e.message + ')'); }
    }
    try {
      const q = fetchQueue_(K, cache);
      queues[K] = q;
      const now = new Date();
      let bad = 0, checked = 0;
      q.items.forEach(function (it) {
        if (new Date(it.publish_at) < now) return;   // τα παλιά αρχεία σβήνονται από το repo μετά τη δημοσίευση
        (it.images || []).concat(it.video ? [it.video] : []).forEach(function (url) {
          checked++;
          const r = UrlFetchApp.fetch(url, { method: 'get', muteHttpExceptions: true, followRedirects: true });
          if (r.getResponseCode() !== 200) { bad++; console.log(pre + 'ΛΑΘΟΣ ' + r.getResponseCode() + ': ' + url); }
        });
      });
      const next = q.items.filter(function (it) { return new Date(it.publish_at) > now; })[0];
      console.log(pre + 'Ουρά (' + q.url + '): ' + q.items.length + ' δημοσιεύσεις, ' + checked + ' επόμενα αρχεία, προβληματικά: ' + bad +
        (next ? ' · επόμενη ' + next.id + ' στις ' + athens_(new Date(next.publish_at), 'd/M HH:mm') : ''));
    } catch (e) { console.log(pre + 'Ουρά: ΣΦΑΛΜΑ ' + e.message); }
  });
  syncSheet_(queues);
}

function dryRun() {
  const S = P_(), now = new Date();
  const queues = allQueues_();
  Object.keys(queues).forEach(function (K) {
    const pre = '[' + K + '] ';
    try {
      const next = queues[K].items.filter(function (it) {
        return igEnabled_(it) && !S.getProperty('done_' + it.id) && new Date(it.publish_at) > now && it.images && it.images.length;
      })[0];
      // Άδεια ουρά (π.χ. πριν την πρώτη έγκριση): δοκιμή με σταθερή εικόνα ελέγχου από το repo.
      const item = next || { id: 'δοκιμαστική εικόνα', client: K, type: 'POST', images: [CFG.TEST_IMAGE_URL] };
      if (!next) console.log(pre + 'Η ουρά δεν έχει επόμενη εικόνα. Δοκιμή με την εικόνα ελέγχου.');
      const ig = igUserId_(K), tok = token_(K);
      const c = item.type === 'STORY'
        ? createContainer_(ig, { image_url: item.images[0], media_type: 'STORIES' }, tok)
        : createContainer_(ig, { image_url: item.images[0], caption: 'dry run' }, tok);
      waitReady_(c, 0, 0, tok);
      console.log(pre + 'Instagram OK: δέχτηκε την ' + (next ? 'εικόνα του ' + item.id : 'εικόνα ελέγχου') + '. ΔΕΝ δημοσιεύτηκε τίποτα.');
      if (fbEnabled_(item)) {
        const ph = api_('post', fbPageId_(K) + '/photos', { url: item.images[0], published: 'false' }, tok);
        try { api_('post', ph.id, { method: 'delete' }, tok); } catch (e) { /* μένει αδημοσίευτη, δεν φαίνεται πουθενά */ }
        console.log(pre + 'Facebook OK: η σελίδα δέχτηκε την εικόνα (αδημοσίευτη, σβήστηκε). ΔΕΝ δημοσιεύτηκε τίποτα.');
      }
    } catch (e) { console.log(pre + 'ΣΦΑΛΜΑ: ' + e.message); }
  });
}

function dryRunReel() {
  const now = new Date();
  const queues = allQueues_();
  Object.keys(queues).forEach(function (K) {
    const pre = '[' + K + '] ';
    const next = queues[K].items.filter(function (it) { return it.type === 'REEL' && igEnabled_(it) && new Date(it.publish_at) > now; })[0];
    if (!next) { console.log(pre + 'Δεν υπάρχει επόμενο reel στην ουρά.'); return; }
    try {
      const ig = igUserId_(K), tok = token_(K);
      const c = createContainer_(ig, reelParams_(next, 'dry run', false), tok);
      waitReady_(c, 50, 5000, tok);
      console.log(pre + 'Instagram OK: το reel ' + next.id + ' επεξεργάστηκε σωστά. ΔΕΝ δημοσιεύτηκε τίποτα.');
    } catch (e) { console.log(pre + 'ΣΦΑΛΜΑ: ' + e.message); }
  });
}

// Δοκιμή του reel στο Facebook: ανεβαίνει ως ΠΡΟΧΕΙΡΟ (DRAFT, δεν φαίνεται πουθενά) και σβήνεται αμέσως.
// Αν δεν σβηστεί, μένει μόνο ως πρόχειρο στο Business Suite (Περιεχόμενο → Πρόχειρα) και το σβήνεις με το χέρι.
function dryRunReelFb() {
  const now = new Date();
  const queues = allQueues_();
  Object.keys(queues).forEach(function (K) {
    const pre = '[' + K + '] ';
    const next = queues[K].items.filter(function (it) { return it.type === 'REEL' && fbEnabled_(it) && new Date(it.publish_at) > now; })[0];
    if (!next) { console.log(pre + 'Δεν υπάρχει επόμενο reel για Facebook στην ουρά (ή δεν έχει οριστεί FB_PAGE_' + K + ').'); return; }
    try {
      const pid = fbPageId_(K), pt = token_(K);
      const st = api_('post', pid + '/video_reels', { upload_phase: 'start' }, pt);
      const up = UrlFetchApp.fetch(st.upload_url, {
        method: 'post', muteHttpExceptions: true,
        headers: { Authorization: 'OAuth ' + pt, file_url: next.video },
      });
      if (up.getResponseCode() >= 400) throw new Error('FB upload ' + up.getResponseCode() + ': ' + up.getContentText());
      api_('post', pid + '/video_reels', { upload_phase: 'finish', video_id: st.video_id, video_state: 'DRAFT', description: 'dry run' }, pt);
      let gone = false;
      try { api_('post', st.video_id, { method: 'delete' }, pt); gone = true; } catch (e) { /* μένει πρόχειρο */ }
      console.log(pre + 'Facebook OK: το reel ' + next.id + ' ανέβηκε ως πρόχειρο' +
        (gone ? ' και σβήστηκε.' : ' (ΔΕΝ σβήστηκε: σβήσ\' το από Business Suite → Περιεχόμενο → Πρόχειρα).') + ' ΔΕΝ δημοσιεύτηκε τίποτα.');
    } catch (e) { console.log(pre + 'Facebook ΣΦΑΛΜΑ: ' + e.message); }
  });
}

// ------------------------------------------------------------------ μενού «⚙️ okpublisher» στο Sheet
const STATUS_KEY_ = /^(fb)?(done|fail|skip)_/;
function secretKey_(k) { return /TOKEN|KEY|SECRET/.test(k); }
function mask_(v) { v = String(v || ''); return v.length <= 10 ? '••••' : v.slice(0, 4) + '…' + v.slice(-4) + ' (' + v.length + ' χαρ.)'; }

function onOpen() {
  SpreadsheetApp.getUi().createMenu('⚙️ okpublisher')
    .addItem('Αλλαγή ρύθμισης…', 'menuSetProperty')
    .addItem('Δες τις ρυθμίσεις', 'menuShowSettings')
    .addToUi();
}

function menuSetProperty() {
  const ui = SpreadsheetApp.getUi();
  const k = ui.prompt('Αλλαγή ρύθμισης', 'Όνομα ρύθμισης, π.χ. CLIENTS, TOKEN_ORE, NOTIFY_TO_ORE, FOLDER_ORE, PAUSED, START_AFTER:', ui.ButtonSet.OK_CANCEL);
  if (k.getSelectedButton() !== ui.Button.OK) return;
  const key = k.getResponseText().trim();
  if (!/^[A-Za-z0-9_]+$/.test(key)) { ui.alert('Μη έγκυρο όνομα: «' + key + '»'); return; }
  if (STATUS_KEY_.test(key)) { ui.alert('Το ' + key + ' το κρατάει μόνο του το script (κατάσταση δημοσίευσης). Δεν αλλάζει από εδώ.'); return; }
  const secret = secretKey_(key);
  const cur = P_().getProperty(key);
  const v = ui.prompt(key, 'Τωρινή τιμή: ' + (cur === null ? '(δεν υπάρχει)' : secret ? mask_(cur) : cur) +
    '\n\nΝέα τιμή (άφησέ το κενό για διαγραφή):', ui.ButtonSet.OK_CANCEL);
  if (v.getSelectedButton() !== ui.Button.OK) return;
  const val = v.getResponseText().trim();
  if (!val) {
    if (cur === null) return;
    if (ui.alert('Διαγραφή του ' + key + ';', ui.ButtonSet.YES_NO) !== ui.Button.YES) return;
    P_().deleteProperty(key);
    ui.alert('Διαγράφηκε: ' + key);
    return;
  }
  P_().setProperty(key, val);
  ui.alert('Αποθηκεύτηκε: ' + key + ' = ' + (secret ? mask_(val) : val));
}

function menuShowSettings() {
  const all = P_().getProperties();
  let status = 0;
  const lines = Object.keys(all).sort().filter(function (k) {
    if (STATUS_KEY_.test(k)) { status++; return false; }
    return true;
  }).map(function (k) {
    const v = secretKey_(k) ? mask_(all[k]) : String(all[k]);
    return k + ' = ' + (v.length > 90 ? v.slice(0, 90) + '…' : v);
  });
  SpreadsheetApp.getUi().alert('Ρυθμίσεις', lines.join('\n') + '\n\n(+ ' + status + ' σημειώσεις κατάστασης δημοσιεύσεων)', SpreadsheetApp.getUi().ButtonSet.OK);
}

function setup() {
  if (!clients_().length) throw new Error('Βάλε πρώτα την Ιδιότητα CLIENTS (π.χ. ORE).');
  ScriptApp.getProjectTriggers().forEach(function (t) {
    if (t.getHandlerFunction() === 'run') ScriptApp.deleteTrigger(t);
  });
  ScriptApp.newTrigger('run').timeBased().everyMinutes(CFG.EVERY_MIN).create();
  sheet_('Ιστορικό', HIST_H_);
  syncSheet_(allQueues_());
  console.log('Έτοιμο: ο έλεγχος τρέχει κάθε ' + CFG.EVERY_MIN + ' λεπτά.');
}

function pause() { P_().setProperty('PAUSED', 'true'); console.log('Παύση: δεν θα δημοσιευτεί τίποτα μέχρι resume().'); }
function resume() { P_().setProperty('PAUSED', 'false'); console.log('Συνέχεια δημοσιεύσεων.'); }
