# okpublisher — publisher

Αυτόματη δημοσίευση σε Instagram και Facebook για πολλούς πελάτες. Κάθε πελάτης εγκρίνει μία φορά τον μήνα το πακέτο του· ό,τι εγκρίθηκε μπαίνει στην ουρά (`queue.json`) και το Apps Script το δημοσιεύει στην ώρα του.

```
queue.json          η ουρά (μόνο εγκεκριμένα)
PRIVACY.md          πολιτική απορρήτου της εφαρμογής Meta «OK Publisher»
publisher/          Apps Script (Code.gs, Tidy.gs, Transfer.gs, Upload.gs, appsscript.json)
publisher/test/     δοκιμές χωρίς internet: node publisher/test/run_tests.js
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

Ειδοποιήσεις: ό,τι αφορά έναν πελάτη (παράλειψη, αποτυχία, τέλος ουράς, διπλότυπα) πάει **μόνο** στο `NOTIFY_TO_<K>` του. Σφάλματα ρύθμισης/ουράς πάνε στο inbox του okpublisher. Ποτέ σε προσωπικά email.

## Εγκατάσταση (μία φορά, από υπολογιστή)

### 1. Εφαρμογή Meta «OK Publisher»
1. developers.facebook.com → My Apps → **Create App** → όνομα **OK Publisher** → Business portfolio: **OK Publisher** → use cases **«Manage everything on your Page»** και **«Manage messaging & content on Instagram»**.
2. App settings → Basic → Privacy Policy URL: `https://github.com/okpublisher/publisher/blob/main/PRIVACY.md` · Category: Business · Αποθήκευση.
3. App Mode → **Live** (σε Development οι δημοσιεύσεις φαίνονται μόνο σε όσους έχουν ρόλο στην εφαρμογή).

### 2. Μόνιμο token σελίδας (για κάθε πελάτη)
Προϋπόθεση: πλήρης έλεγχος στη σελίδα, Instagram επαγγελματικό και συνδεδεμένο με τη σελίδα.
1. developers.facebook.com/tools/explorer → Meta App: **OK Publisher** → User Token → δικαιώματα `instagram_basic`, `instagram_content_publish`, `pages_show_list`, `pages_read_engagement`, `pages_manage_posts`, `business_management` → **Generate Access Token** → επιλέγεις **μόνο** τη σελίδα του πελάτη και το Instagram της.
2. developers.facebook.com/tools/debug/accesstoken → Debug → **Extend Access Token** → αντιγραφή.
3. Graph API Explorer με το νέο token: `me/accounts?fields=name,access_token` → Submit.
4. Το `access_token` της σελίδας → έλεγχος στο Debugger: **Type: Page, Expires: Never** → Ιδιότητα `TOKEN_<K>`.

### 3. Google Sheet + Apps Script (στον λογαριασμό Google του okpublisher)
1. Νέο Google Sheet **okpublisher** → Επεκτάσεις → Apps Script, όνομα έργου **okpublisher**.
2. Επικόλληση `publisher/Code.gs` στο `Code.gs`· νέα αρχεία `Tidy`, `Transfer`, `Upload` με τα αντίστοιχα.
3. Ρυθμίσεις έργου → «Εμφάνιση αρχείου manifest» → επικόλληση `publisher/appsscript.json`. Ζώνη ώρας: Athens.
4. Ιδιότητες σεναρίου: `CLIENTS` και, για κάθε πελάτη, `TOKEN_<K>`, `NOTIFY_TO_<K>`, `NAME_<K>`, `FOLDER_<K>` (+ ό,τι χρειάζεται από τον πίνακα). Ο φάκελος υλικού κάθε πελάτη μοιράζεται στον λογαριασμό του okpublisher ως **Συντάκτης**.

### 4. Έλεγχος (επιλογή συνάρτησης → Εκτέλεση) — δεν δημοσιεύει τίποτα
1. `findInstagramIds` (την πρώτη φορά ζητάει άδειες Google).
2. `checkSetup` → για κάθε πελάτη: «δεν λήγει, δικαιώματα εντάξει», Instagram, Facebook, φάκελος, ουρά, «προβληματικά: 0».
3. `dryRun` και `dryRunReel` → «OK … ΔΕΝ δημοσιεύτηκε τίποτα».

### 5. Ενεργοποίηση
1. `START_AFTER` = η ώρα της αλλαγής (π.χ. `2026-11-24T15:00:00+02:00`).
2. `setup` (έλεγχος κάθε 10′) και `setupDailyDedupe` (διπλότυπα + κόψιμο μεγάλων βίντεο κάθε βράδυ).
3. Προαιρετικά `setupClientFolders` (υποφάκελος «REELS ΕΤΟΙΜΑ» σε κάθε πελάτη) και συντόμευση iPhone (`Upload.gs`).

## Καθημερινά
- Καρτέλα **Ουρά** στο Sheet: πρόγραμμα όλων των πελατών με κατάσταση και link. Καρτέλα **Ιστορικό**: κάθε δημοσίευση ή σφάλμα.
- Μετά από 3 αποτυχίες ή καθυστέρηση πάνω από 3 ώρες η δημοσίευση παραλείπεται, ώστε να μη βγει ποτέ διπλή.
- Βίντεο ξεκινά μόνο στο πρώτο λεπτό κάθε κύκλου και καμία δημοσίευση μετά τα 3′· ό,τι δεν πρόλαβε βγαίνει 10′ μετά.
- `pause()` / `resume()` για όλους, `PAUSED_<K>` για έναν πελάτη. Ρυθμίσεις και από το μενού **⚙️ okpublisher** του Sheet.
