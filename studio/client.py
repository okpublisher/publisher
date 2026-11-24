"""Ρυθμίσεις πελάτη για το studio: διαβάζονται από το ιδιωτικό repo `okpublisher/publisher-work`.

    clients/<K>/config.json     στοιχεία πελάτη (ώρες, ημέρες, CTA, τρόπος έτοιμων reels, ομάδα)
    groups/<ομάδα>/group.json   κοινό brand (χρώματα, γραμματοσειρές, λογότυπα) και απαγορευμένες διατυπώσεις

Ποιος πελάτης: όρισμα `--client K` ή μεταβλητή περιβάλλοντος OKP_CLIENT. Πού είναι το ιδιωτικό repo: OKP_WORK
(προεπιλογή /home/claude/publisher-work). Σε αυτό το δημόσιο repo δεν γράφεται κανένα στοιχείο πελάτη.
"""
import json, os, re
from pathlib import Path

WORK = Path(os.environ.get('OKP_WORK', '/home/claude/publisher-work'))
REPO_RAW = 'https://raw.githubusercontent.com/okpublisher/publisher/main/'
KEY_RE = re.compile(r'^[A-Z0-9]{2,12}$')
DAY_NAMES = ['Δευτέρα', 'Τρίτη', 'Τετάρτη', 'Πέμπτη', 'Παρασκευή', 'Σάββατο', 'Κυριακή']
READY_MODES = ('fill_reel_slots_then_posts_then_next_month', 'all_in_month')

# Προεπιλογές για ό,τι δεν ορίζει ο πελάτης ή η ομάδα.
DEFAULT_COLORS = {'primary': '#FFDD00', 'accent': '#E5007D', 'dark': '#004C8C', 'text': '#1F2328',
                  'cream': '#FFFBEA', 'accent_light': '#FDE8F2', 'primary_light': '#FFF8CC', 'dark_light': '#EEF4FA'}
DEFAULT_FONTS = {'titles': 'M PLUS Rounded 1c', 'text': 'Manrope'}


def _merge(a, b):
    out = dict(a or {})
    for k, v in (b or {}).items():
        out[k] = _merge(out.get(k), v) if isinstance(v, dict) and isinstance(out.get(k), dict) else v
    return out


def fontsource_id(family):
    """«M PLUS Rounded 1c» → «m-plus-rounded-1c» (όνομα πακέτου @fontsource)."""
    return re.sub(r'[^a-z0-9]+', '-', family.lower()).strip('-')


class Client:
    def __init__(self, key, work=None):
        self.work = Path(work or WORK)
        key = str(key or '').strip().upper()
        if not KEY_RE.match(key):
            raise SystemExit(f'Μη έγκυρο κλειδί πελάτη: «{key}» (π.χ. ORE). Όρισε --client ή OKP_CLIENT.')
        self.key = key
        self.dir = self.work / 'clients' / key
        cfg_path = self.dir / 'config.json'
        if not cfg_path.exists():
            raise SystemExit(f'Δεν βρέθηκε {cfg_path}. Είναι κλωνοποιημένο το okpublisher/publisher-work (OKP_WORK)?')
        self.config = json.loads(cfg_path.read_text(encoding='utf-8'))
        self.group_key = self.config.get('group')
        self.group_dir = self.work / 'groups' / self.group_key if self.group_key else None
        self.group = {}
        if self.group_dir and (self.group_dir / 'group.json').exists():
            self.group = json.loads((self.group_dir / 'group.json').read_text(encoding='utf-8'))
        self.brand = _merge(self.group.get('brand'), self.config.get('brand'))

    # ------------------------------------------------------------ ταυτότητα
    @property
    def name(self):
        return self.config.get('name') or self.key

    @property
    def aliases(self):
        return [a.strip().upper() for a in self.config.get('aliases') or [] if a.strip()]

    @property
    def accounts(self):
        return [self.key] + self.aliases

    # ------------------------------------------------------------ brand
    def color(self, role):
        c = _merge(DEFAULT_COLORS, self.brand.get('colors'))
        return c[role]

    def font(self, role):
        return _merge(DEFAULT_FONTS, self.brand.get('fonts'))[role]

    def logo(self, variant='default'):
        """Απόλυτη διαδρομή λογότυπου (από την ομάδα ή από τον πελάτη). Δέχεται και παλιά ονόματα αρχείων."""
        logos = self.brand.get('logos') or {}
        rel = logos.get(variant) or variant
        for base in (self.dir, self.group_dir):
            if base and (base / rel).exists():
                return (base / rel).resolve()
            if base and (base / 'logos' / rel).exists():
                return (base / 'logos' / rel).resolve()
        raise SystemExit(f'Δεν βρέθηκε λογότυπο «{variant}» για {self.key} (brand.logos στο group.json / config.json).')

    @property
    def language(self):
        return self.brand.get('language', 'el')

    # ------------------------------------------------------------ πρόγραμμα
    @property
    def post_weekdays(self):
        days = self.config.get('post_days') or ['Δευτέρα', 'Τετάρτη', 'Παρασκευή', 'Κυριακή']
        return {DAY_NAMES.index(d) if isinstance(d, str) else int(d) for d in days}

    @property
    def post_time(self):
        return self.config.get('post_time', '22:00')

    @property
    def story_time(self):
        return self.config.get('story_time', '10:00')

    @property
    def ready_reels_mode(self):
        m = self.config.get('ready_reels_mode') or READY_MODES[0]
        if m not in READY_MODES:
            raise SystemExit(f'{self.key}: άγνωστος ready_reels_mode «{m}» (επιτρέπονται: {", ".join(READY_MODES)})')
        return m

    @property
    def ready_reels_dir(self):
        return self.config.get('ready_reels_dir') or 'REELS ΕΤΟΙΜΑ'

    # ------------------------------------------------------------ κείμενα
    @property
    def phones(self):
        """[(ετικέτα, αριθμός)] για τα γραφικά CTA, με αδιάσπαστα κενά."""
        cta = self.config.get('cta') or {}
        out = []
        for p in cta.get('phones') or []:
            out.append((p['label'], p['number']))
        if not out:
            if cta.get('landline'):
                out.append(('Σταθερό', cta['landline']))
            if cta.get('mobile'):
                out.append(('Κινητό', cta['mobile']))
        return [(k, v.replace(' ', ' ')) for k, v in out]

    @property
    def banned_phrases(self):
        return [b.lower() for b in (self.group.get('banned_phrases') or []) + (self.config.get('banned_phrases') or [])]

    # ------------------------------------------------------------ παρτίδες
    def batch_dir_name(self, batch):
        """Ο φάκελος αρχείων μέσα σε μια παρτίδα: <K>/ ή, για παλιές παρτίδες, ένα alias (π.χ. LS/)."""
        batch = Path(batch)
        for k in self.accounts:
            if (batch / k).is_dir():
                return k
        return self.key

    def caption(self, caps, account, day, suffix=''):
        """Λεζάντα από το captions.json: δοκιμάζει «<account>|<ημ/νία>[|suffix]» και μετά τα υπόλοιπα κλειδιά του πελάτη."""
        for k in [account] + [a for a in self.accounts if a != account]:
            key = f'{k}|{day}' + (f'|{suffix}' if suffix else '')
            if key in caps:
                return caps[key]
        return None


def load(key=None, work=None):
    return Client(key or os.environ.get('OKP_CLIENT'), work)


def batch_media_dirs(batch):
    """Όλοι οι φάκελοι αρχείων μιας παρτίδας (κλειδιά πελατών με κεφαλαία, π.χ. ORE/ ή LS/)."""
    batch = Path(batch)
    return [p for p in sorted(batch.iterdir()) if p.is_dir() and KEY_RE.match(p.name)] if batch.is_dir() else []
