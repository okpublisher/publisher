# okpublisher — publisher

Αυτόματη δημοσίευση σε Instagram και Facebook για πολλούς πελάτες. Κάθε πελάτης εγκρίνει μία φορά τον μήνα το πακέτο του· ό,τι εγκρίθηκε μπαίνει στην ουρά (`queue.json`) και το Apps Script το δημοσιεύει στην ώρα του.

```
queue.json          η ουρά (μόνο εγκεκριμένα)
media/<ΕΕΕΕ-ΜΜ>/<K>/ τα αρχεία της ουράς (σβήνονται 3 μέρες μετά τη δημοσίευση)
PRIVACY.md          πολιτική απορρήτου της εφαρμογής Meta «OK Publisher»
publisher/          Apps Script (Code.gs, Approval.gs, Tidy.gs, Transfer.gs, Upload.gs, appsscript.json)
publisher/test/     δοκιμές χωρίς internet: node publisher/test/run_tests.js
studio/             παραγωγή (Python): γραφικά, θόλωμα, reels, έτοιμα reels, PDF έγκρισης, ουρά — βλ. studio/RUNBOOK.md
studio/tests/       δοκιμές: python3 -m unittest discover -s studio/tests
```

Ρυθμίσεις πελατών, πακέτα και κατάσταση: στο ιδιωτικό repo `okpublisher/publisher-work`. Σε αυτό το δημόσιο repo δεν μπαίνουν ποτέ emails, ονόματα προσώπων, IDs Drive ή κείμενα email (εξαίρεση: η πολιτική απορρήτου).

## Πελάτες
Κάθε πελάτης έχει ένα κλειδί (π.χ. `ORE` = Learning & Sensory Ωραιόκαστρο). Ιδιότητα σεναρίου `CLIENTS` = όλα τα κλειδιά με κόμμα. Για κάθε κλειδί `<K>`:

| Ιδιότητα | Τι είναι |
|---|---|
| `TOKEN_<K>` | μόνιμο token σελίδας (το βάζεις εσύ) |
| `IG_USER_<K>`, `FB_PAGE_<K>` | τα γράφει μόνο του το `findInstagramIds` |
| `NOTIFY_TO_<K>` | email του πελάτη — εκεί πάνε **όλες** οι ειδοποιήσεις του (κενό = καμία) |
| `NAME_<K>` | όνομα για τα email και το Sheet |
| `FOLDER_<K>` | φάκελος υλικού στο Drive (σύνδεσμος ή ID) |
| `QUEUE_URL_<K>` | προαιρετικά δική του ουρά |
| `ALIAS_<K>` | παλιά κλειδιά του ίδιου πελάτη (π.χ. `ALIAS_ORE` = `LS`) |
| `PAUSED_<K>`, `FB_ENABLED_<K>`, `REEL_STORY_<K>`, `TRIAL_REELS_<K>` | παύση, μόνο Instagram, story από reel, δοκιμαστικά reels |

Γενικές: `START_AFTER` (ό,τι είναι πριν αγνοείται — **υποχρεωτικό σε κάθε μετάβαση**), `PAUSED`, `SYSTEM_NOTIFY_TO` (σφάλματα του ίδιου του συστήματος· κενό = ο λογαριασμός του okpublisher), `GRAPH_VERSION`.

Έγκριση (`Approval.gs`): `GITHUB_TOKEN` (fine-grained, μόνο `okpublisher/publisher-work`, Contents: Read and write — το βάζεις εσύ), προαιρετικά `APPROVERS_<K>` (επιπλέον διευθύνσεις που μετράνε ως έγκριση· οι βασικές είναι στο `config.json` του πελάτη), `TEST_CLIENTS` (π.χ. `TST`: μόνο έγκριση, ποτέ δημοσίευση), `WORK_REPO`.

Ειδοποιήσεις: ό,τι αφορά έναν πελάτη (παράλειψη, αποτυχία, τέλος ουράς, διπλότυπα) πάει **μόνο** στο `NOTIFY_TO_<K>` του. Σφάλματα ρύθμισης/ουράς πάνε στο inbox του okpublisher. Ποτέ σε προσωπικά email.

## Εγκατάσταση (μία φορά, από υπολογιστή)

### 1. Εφαρμογή Meta «OK Publisher»
1. developers.facebook.com → My Apps → **Create App** → όνομα **OK Publisher** → Business portfolio: **OK Publisher** → use cases **«Manage everything on your Page»** και **«Manage messaging & content on Instagram»**.
2. App settings → Basic → Privacy Policy URL: `https://github.com/okpublisher/publisher/blob/main/PRIVACY.md` · Category: Business · Αποθήκευση.
3. App Mode → **Live** (σε Development οι δημοσιεύσεις φαίνονται μόνο σε όσους έχουν ρόλο στην εφαρμογή).

### 2. Μόνιμο token σελίδας (για κάθε πελάτη)
Προϋπόθεση: πλήρης έλεγχος στη σελίδα, Instagram επαγγελματικό και συνδεδεμένο με τη σελίδα.
1. developers.facebook.com/tools/explorer → Meta App: **OK Publisher** → User Token → δικαιώματα `instagram_basic`, `instagram_content_publish`, `pages_show_list`, `pages_read_engagement`, `pages_manage_posts`, `business_management` (+ `instagram_manage_insights` για τις αναφορές) → **Generate Access Token** → στις σελίδες, στα Instagram και στις επιχειρήσεις **κρατάς τσεκαρισμένα όσα ήδη υπάρχουν** (αλλιώς η εφαρμογή χάνει την πρόσβαση στους άλλους πελάτες και σταματούν οι δημοσιεύσεις τους) και προσθέτεις του νέου πελάτη.
2. developers.facebook.com/tools/debug/accesstoken → Debug → **Extend Access Token** → αντιγραφή.
3. Graph API Explorer με το νέο token: `me/accounts?fields=name,access_token` → Submit.
4. Το `access_token` της σελίδας **του νέου πελάτη** → έλεγχος στο Debugger: **Type: Page, Expires: Never** → Ιδιότητα `TOKEN_<K>`.

### 3. Google Sheet + Apps Script (στον λογαριασμό Google του okpublisher)
1. Νέο Google Sheet **okpublisher** → Επεκτάσεις → Apps Script, όνομα έργου **okpublisher**.
2. Επικόλληση `publisher/Code.gs` στο `Code.gs`· νέα αρχεία `Tidy`, `Transfer`, `Upload` με τα αντίστοιχα.
3. Ρυθμίσεις έργου → «Εμφάνιση αρχείου manifest» → επικόλληση `publisher/appsscript.json`. Ζώνη ώρας: Athens.
4. Ιδιότητες σεναρίου: `CLIENTS` και, για κάθε πελάτη, `TOKEN_<K>`, `NOTIFY_TO_<K>`, `NAME_<K>`, `FOLDER_<K>` (+ ό,τι χρειάζεται από τον πίνακα). Ο φάκελος υλικού κάθε πελάτη μοιράζεται στον λογαριασμό του okpublisher ως **Συντάκτης**.

### 4. Έλεγχος (επιλογή συνάρτησης → Εκτέλεση) — δεν δημοσιεύει τίποτα
1. `findInstagramIds` (την πρώτη φορά ζητάει άδειες Google).
2. `checkSetup` → για κάθε πελάτη: «δεν λήγει, δικαιώματα εντάξει», Instagram, Facebook, φάκελος, ουρά, «προβληματικά: 0».
3. `dryRun` (εικόνα σε Instagram + Facebook), `dryRunReel` (reel στο Instagram) και `dryRunReelFb` (reel στο Facebook ως πρόχειρο που σβήνεται) → «OK … ΔΕΝ δημοσιεύτηκε τίποτα».

### 5. Ενεργοποίηση
1. `START_AFTER` = η ώρα της αλλαγής (π.χ. `2026-11-24T15:00:00+02:00`).
2. `setup` (έλεγχος κάθε 10′) και `setupDailyDedupe` (διπλότυπα + κόψιμο μεγάλων βίντεο κάθε βράδυ).
3. Προαιρετικά `setupClientFolders` (υποφάκελος «REELS ΕΤΟΙΜΑ» σε κάθε πελάτη) και συντόμευση iPhone (`Upload.gs`).

### 6. Έγκριση μέσω του Gmail του okpublisher (μία φορά)
1. github.com → Settings → Developer settings → Fine-grained tokens → Generate: Resource owner **okpublisher**, Repository access **Only select: publisher-work**, Permissions → Contents: **Read and write**, λήξη 1 χρόνος → Ιδιότητα `GITHUB_TOKEN`.
2. Επικόλληση `publisher/Approval.gs` (νέο αρχείο `Approval`) και του νέου `appsscript.json` (προστέθηκε άδεια Gmail).
3. `checkApproval` → ζητάει νέα άδεια (Gmail). Η Google γράφει «δεν έχει επαληθευτεί»: Advanced → Μετάβαση στο okpublisher. Πρέπει να δείξει «GitHub: OK … (γράφει)», «Gmail: OK» και για κάθε πελάτη email, εγκρίνοντες, φάκελο.
4. `setupApproval` (κύκλος κάθε 15′: εκτελεί τα αιτήματα του Claude και γράφει τις απαντήσεις των πελατών στο repo).

Πώς δουλεύει: ο Claude γράφει αιτήματα στο `publisher-work/clients/<K>/outbox/` (email πακέτου, απάντηση στο thread, μετακίνηση πηγών, ειδοποίηση). Το Apps Script τα εκτελεί από τον λογαριασμό του okpublisher — **κάθε email μόνο στο `NOTIFY_TO_<K>`**, Drive μόνο μέσα στον φάκελο του πελάτη, τίποτα δεν σβήνεται — και γράφει το αποτέλεσμα δίπλα (`<id>.result.json`). Κάθε email από τις διευθύνσεις έγκρισης γράφεται στο `clients/<K>/inbox/`.

### 7. Μηνιαία αναφορά και αυτόματες ώρες (μία φορά)
1. Εφαρμογή Meta: άδειες `instagram_manage_insights` και `pages_read_engagement`, και νέο token σελίδας για κάθε πελάτη.
2. Επικόλληση `publisher/Insights.gs` (νέο αρχείο `Insights`). Τα υπόλοιπα αρχεία δεν αλλάζουν.
3. `checkInsights` → για κάθε πελάτη «insights: OK» και «online_followers: OK» (ή «κενό» κάτω από 100 ακόλουθους). Δεν αλλάζει τίποτα.
4. Προαιρετικά `previewReport` (προηγούμενος μήνας) ή `previewCurrentMonth` (τρέχων μήνας): η αναφορά γράφεται μόνο στο repo (`clients/<K>/reports/<μήνας>.preview.json`), **χωρίς email**.
5. `setupInsights` (κύκλος κάθε 6 ώρες).

Πώς δουλεύει:
- **Stories:** τα στατιστικά τους κρατιούνται μόνο 24 ώρες, γι' αυτό καταγράφονται κάθε 6 ώρες στην καρτέλα **Stories**.
- **Αυτόματες ώρες (στις 15 του μήνα):** από το `online_followers` (30 ημέρες, σε ώρα Ελλάδας). Post στην ώρα με τους περισσότερους ακόλουθους online (08:00–22:00), story σε άλλη ώρα με πολλούς online (08:00–20:00, τουλάχιστον 3 ώρες μακριά). Γράφονται στο `publisher-work/clients/<K>/best_times.json`. Το studio τις χρησιμοποιεί **μόνο** αν το `config.json` έχει `"times": "auto"`· αλλιώς ισχύουν τα `post_time`/`story_time` (π.χ. όσα όρισε ο πελάτης). Κάτω από 100 ακόλουθους → προεπιλεγμένες ώρες.
- **Αναφορά (την 1η του μήνα, από τις 09:00):** ξεχωριστό email μόνο στο `NOTIFY_TO_<K>`: τι δημοσιεύτηκε, εμβέλεια, προβολές, αλληλεπιδράσεις, πατήματα σε κλήση/οδηγίες, ακόλουθοι πριν/μετά, τα 3 καλύτερα posts, stories, ώρες. Αντίγραφο στο `clients/<K>/reports/<μήνας>.json`. Μόνο για μήνες που κάλυψε ολόκληρους το okpublisher (από `START_AFTER`). Ποτέ δεύτερη αποστολή· `REPORT_<K>=false` = καμία αναφορά.

### 8. Αυτόματο ανέβασμα κώδικα (αντί για επικόλληση)
Από εδώ και πέρα ο κώδικας **δεν αλλάζει ποτέ στον editor**: το `clasp push` αντικαθιστά όλα τα αρχεία του project.
1. Στον λογαριασμό του okpublisher: https://script.google.com/home/usersettings → Google Apps Script API: **On**.
2. Κλειδί clasp του ίδιου λογαριασμού (π.χ. από το Google Cloud Shell: `npx -y @google/clasp@3.4.1 login --no-localhost`, μετά `cat ~/.clasprc.json`, μετά `rm ~/.clasprc.json`).
3. Στο GitHub (Settings → Secrets and variables → Actions) δύο secrets: `CLASPRC_JSON` (όλο το περιεχόμενο του `.clasprc.json`) και `SCRIPT_ID` (Project Settings → Script ID). Το ID **δεν** μπαίνει μέσα στο repo.
4. Actions → **Έλεγχος live (Apps Script)** → Run workflow: βρίσκει ποιο commit τρέχει και βάζει εκεί την ετικέτα `deployed-gas`. Δεν αλλάζει τίποτα.

Μετά: κάθε αλλαγή στο `publisher/*.gs` ή `appsscript.json` στο `main` ανεβαίνει μόνη της (**Deploy Apps Script**: δοκιμές → έλεγχος ότι δεν άλλαξε τίποτα στον editor → `clasp push` → επαλήθευση). Οι triggers και τα Script Properties δεν επηρεάζονται. Νέα άδεια Google (νέο scope) θέλει πάντα μία εκτέλεση από τον editor για έγκριση.

### 9. Φόρμα του site (Apps Script «okpublisher form», χωριστό project)
Ο κώδικας της φόρμας του okpublisher.gr ζει στο `form/` (δοκιμές: `node form/test/run_tests.js`) και ανεβαίνει με τον ίδιο τρόπο, με το ίδιο κλειδί `CLASPRC_JSON`.
1. Secret `FORM_SCRIPT_ID` (Apps Script της φόρμας → Project Settings → Script ID). Το ID **δεν** μπαίνει μέσα στο repo.
2. Actions → **Έλεγχος live (φόρμα)**: δείχνει τι τρέχει, ελέγχει ότι το `/exec` απαντά και βάζει την ετικέτα `deployed-form`. Δεν αλλάζει τίποτα.

Μετά: κάθε αλλαγή στο `form/Form.gs` ή `form/appsscript.json` στο `main` → **Deploy φόρμας**: δοκιμές → έλεγχος editor → `clasp push` → νέα έκδοση στην **ίδια** ανάπτυξη (ο σύνδεσμος `/exec` του site δεν αλλάζει) → έλεγχος ότι απαντά, αλλιώς επιστροφή στην προηγούμενη έκδοση.

**Φύλακας** (κάθε ώρα, workflow «Φύλακας»): το `run()` γράφει σε κάθε κύκλο «Τελευταίος κύκλος» στην καρτέλα Ουρά. Αν το Sheet δεν αλλάξει για πάνω από 40′ (π.χ. χάθηκε η άδεια της Google και σταμάτησαν οι triggers), το run αποτυγχάνει και το GitHub στέλνει email. Λύση: στον editor Run της `setup` (και `setupApproval`) με νέα έγκριση.

## Καθημερινά
- Καρτέλα **Ουρά** στο Sheet: πρόγραμμα όλων των πελατών με κατάσταση και link. Καρτέλα **Ιστορικό**: κάθε δημοσίευση ή σφάλμα.
- Μετά από 3 αποτυχίες ή καθυστέρηση πάνω από 3 ώρες η δημοσίευση παραλείπεται, ώστε να μη βγει ποτέ διπλή.
- Βίντεο ξεκινά μόνο στο πρώτο λεπτό κάθε κύκλου και καμία δημοσίευση μετά τα 3′· ό,τι δεν πρόλαβε βγαίνει 10′ μετά.
- `pause()` / `resume()` για όλους, `PAUSED_<K>` για έναν πελάτη. Ρυθμίσεις και από το μενού **⚙️ okpublisher** του Sheet.
