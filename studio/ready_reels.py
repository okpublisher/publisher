#!/usr/bin/env python3
"""Έτοιμα reels του πελάτη (υποφάκελος «REELS ΕΤΟΙΜΑ»): έλεγχος προδιαγραφών, θέσεις στον μήνα, προσθήκη στην παρτίδα.

Δημοσιεύονται ΟΠΩΣ ΕΙΝΑΙ (χωρίς μοντάζ, χωρίς αλλαγή ήχου). Μόνο:
  - έλεγχος προδιαγραφών (9:16, διάρκεια, μέγεθος, κωδικοποίηση) και επανακωδικοποίηση αν χρειάζεται·
  - αφαίρεση metadata (π.χ. τοποθεσία) — πάντα·
  - ο ίδιος έλεγχος ιδιωτικότητας με όλα τα υπόλοιπα (privacy_check.py verify στην παρτίδα). Αν αποτύχει → δεν
    δημοσιεύεται και ενημερώνεται ο ΠΕΛΑΤΗΣ (ποτέ προσωπικό email).

    python3 ready_reels.py check <βίντεο>                        → JSON: ok, προβλήματα, χρειάζεται επανακωδικοποίηση
    python3 ready_reels.py plan <ΕΕΕΕ-ΜΜ> <βίντεο…> [--our-reels ΗΜ,ΗΜ] [--client K]
                                                                  → JSON: ποιο reel σε ποια ημέρα, τι αντικαθιστά, τι πάει
                                                                    στον επόμενο μήνα
    python3 ready_reels.py add <παρτίδα> <ΕΕΕΕ-ΜΜ-ΗΗ> <βίντεο> [--client K]
                                                                  → <παρτίδα>/<K>/<ημ>_reel.mp4 (+ _reel_cover.jpg) και
                                                                    λεζάντα από <όνομα>.txt στο captions.json, αν υπάρχει

Θέσεις (ρύθμιση πελάτη `ready_reels_mode`):
  fill_reel_slots_then_posts_then_next_month (προεπιλογή): πρώτα στις θέσεις των δικών μας reels, μετά στις θέσεις
      post, ό,τι περισσεύει → επόμενος μήνας. Ποτέ δύο σε μία θέση.
  all_in_month: όπως πάνω, και ό,τι περισσεύει μπαίνει σε ημέρες χωρίς post (αυξημένη συχνότητα) μέσα στον μήνα.
Ημερομηνία στην αρχή του ονόματος (`2027-01-05 ….mp4`) = κλείδωμα ημέρας.
Εξώφυλλο: εικόνα με το ίδιο όνομα (.jpg/.jpeg/.png) ή καρέ του βίντεο. Λεζάντα: .txt με το ίδιο όνομα ή γράφεται.
"""
import argparse, calendar, json, os, re, shutil, subprocess, sys
from datetime import date
from pathlib import Path

sys.path.insert(0, os.path.dirname(os.path.abspath(__file__)))
import client as clientlib  # noqa: E402

RATIO, RATIO_TOL = 9 / 16, 0.02
MIN_SEC, MAX_SEC, STORY_MAX_SEC = 3, 15 * 60, 60
MAX_BYTES = 300 * 1024 * 1024
OK_VCODECS, OK_ACODECS = ('h264', 'hevc'), ('aac',)
FPS_MIN, FPS_MAX = 23, 60
DATE_RE = re.compile(r'^(\d{4}-\d{2}-\d{2})')


# ---------------------------------------------------------------- προδιαγραφές
def probe(path):
    r = subprocess.run(['ffprobe', '-v', 'error', '-print_format', 'json', '-show_format', '-show_streams', str(path)],
                       capture_output=True, text=True)
    if r.returncode:
        raise SystemExit(f'{path}: δεν διαβάζεται ως βίντεο ({r.stderr.strip()[:200]})')
    return json.loads(r.stdout)


def _fps(s):
    try:
        n, d = (s.get('avg_frame_rate') or s.get('r_frame_rate') or '0/1').split('/')
        return float(n) / float(d) if float(d) else 0.0
    except ValueError:
        return 0.0


def check(path):
    """Τι χρειάζεται το βίντεο για να δημοσιευτεί ως reel. Δεν αλλάζει τίποτα."""
    info = probe(path)
    v = next((s for s in info['streams'] if s.get('codec_type') == 'video'), None)
    a = next((s for s in info['streams'] if s.get('codec_type') == 'audio'), None)
    dur = float(info['format'].get('duration') or (v or {}).get('duration') or 0)
    size = os.path.getsize(path)
    problems, reencode = [], []
    if not v:
        return {'file': str(path), 'ok': False, 'problems': ['δεν έχει εικόνα'], 'reencode': [], 'duration': dur}
    w, h = int(v.get('width', 0)), int(v.get('height', 0))
    rot = 0
    for sd in v.get('side_data_list') or []:
        if 'rotation' in sd:
            rot = abs(int(float(sd['rotation']))) % 180
    if rot == 90:
        w, h = h, w
    ratio = w / h if h else 0
    if abs(ratio - RATIO) > RATIO * RATIO_TOL:
        problems.append(f'αναλογία {w}×{h} (θέλει 9:16, κάθετο)')
    if dur < MIN_SEC:
        problems.append(f'διάρκεια {dur:.1f}″ (ελάχιστο {MIN_SEC}″)')
    if dur > MAX_SEC:
        problems.append(f'διάρκεια {dur:.0f}″ (μέγιστο {MAX_SEC // 60}′)')
    if v.get('codec_name') not in OK_VCODECS:
        reencode.append(f'κωδικοποίηση εικόνας {v.get("codec_name")}')
    if v.get('pix_fmt') not in ('yuv420p', 'yuvj420p'):
        reencode.append(f'pix_fmt {v.get("pix_fmt")}')
    fps = _fps(v)
    if not FPS_MIN <= fps <= FPS_MAX:
        reencode.append(f'{fps:.1f} καρέ/δευτ.')
    if max(w, h) > 1920:
        reencode.append(f'ανάλυση {w}×{h} (πάνω από 1920)')
    if a and (a.get('codec_name') not in OK_ACODECS or int(a.get('sample_rate') or 0) > 48000):
        reencode.append(f'ήχος {a.get("codec_name")} {a.get("sample_rate")} Hz')
    if size > MAX_BYTES:
        reencode.append(f'μέγεθος {size / 1048576:.0f} MB')
    return {'file': str(path), 'ok': not problems, 'problems': problems, 'reencode': reencode, 'duration': round(dur, 2),
            'width': w, 'height': h, 'fps': round(fps, 2), 'audio': bool(a), 'bytes': size,
            'story': dur <= STORY_MAX_SEC}


def prepare(src, dst, info=None):
    """Γράφει αντίγραφο έτοιμο για δημοσίευση: χωρίς metadata, faststart· επανακωδικοποίηση μόνο αν χρειάζεται.
    Ο ήχος του πελάτη ΜΕΝΕΙ (τα έτοιμα reels δημοσιεύονται όπως είναι)."""
    info = info or check(src)
    if not info['ok']:
        raise SystemExit(f'{src}: δεν γίνεται reel: ' + '; '.join(info['problems']))
    Path(dst).parent.mkdir(parents=True, exist_ok=True)
    base = ['ffmpeg', '-v', 'error', '-y', '-i', str(src), '-map', '0:v:0', '-map', '0:a:0?', '-map_metadata', '-1',
            '-map_chapters', '-1', '-movflags', '+faststart']
    if info['reencode']:
        vf = "scale='min(1080,iw)':-2,fps=30,format=yuv420p"
        cmd = base + ['-vf', vf, '-c:v', 'libx264', '-profile:v', 'high', '-preset', 'veryfast', '-crf', '20',
                      '-c:a', 'aac', '-ar', '48000', '-b:a', '128k', str(dst)]
    else:
        cmd = base + ['-c', 'copy', str(dst)]
    subprocess.run(cmd, check=True)
    after = check(dst)
    if not after['ok'] or after['reencode'] or after['bytes'] > MAX_BYTES:
        raise SystemExit(f'{dst}: μετά την προετοιμασία ακόμα: ' + '; '.join(after['problems'] + after['reencode']))
    return after


def cover_for(src, dst, at=1.0):
    """Εξώφυλλο: εικόνα με το ίδιο όνομα, αλλιώς καρέ του βίντεο (1″)."""
    src = Path(src)
    for ext in ('.jpg', '.jpeg', '.png', '.JPG', '.JPEG', '.PNG'):
        img = src.with_suffix(ext)
        if img.exists():
            from PIL import Image, ImageOps
            im = ImageOps.exif_transpose(Image.open(img)).convert('RGB')
            im.save(dst, 'JPEG', quality=92)          # νέο αρχείο: χωρίς EXIF
            return 'εικόνα ' + img.name
    subprocess.run(['ffmpeg', '-v', 'error', '-y', '-ss', str(at), '-i', str(src), '-frames:v', '1', '-q:v', '2',
                    '-map_metadata', '-1', str(dst)], check=True)
    return f'καρέ {at:g}″'


# ---------------------------------------------------------------- θέσεις στον μήνα
def locked_date(name):
    m = DATE_RE.match(Path(name).name)
    if not m:
        return None
    try:
        return date.fromisoformat(m.group(1)).isoformat()
    except ValueError:
        return None


def month_days(month):
    y, m = map(int, month.split('-'))
    return [date(y, m, d).isoformat() for d in range(1, calendar.monthrange(y, m)[1] + 1)]


def place(month, post_weekdays, our_reels, names, mode):
    """Καθαρή λογική (χωρίς αρχεία). Επιστρέφει {'assign': {ημ: όνομα}, 'replaces': {ημ: reel|post|extra},
    'next_month': [ονόματα], 'notes': [...]}. Ποτέ δύο σε μία ημέρα."""
    days = month_days(month)
    posts = [d for d in days if date.fromisoformat(d).weekday() in post_weekdays]
    our = [d for d in posts if d in set(our_reels)]
    assign, replaces, nxt, notes = {}, {}, [], []

    def kind(d):
        return 'reel' if d in our else ('post' if d in posts else 'extra')

    free = []
    for n in sorted(names, key=lambda x: (locked_date(x) or '9999', Path(x).name)):
        ld = locked_date(n)
        if ld and ld[:7] == month:
            if ld in assign:
                notes.append(f'{Path(n).name}: η {ld} έχει ήδη έτοιμο reel → μπαίνει σε ελεύθερη θέση')
                free.append(n)
            else:
                assign[ld] = n; replaces[ld] = kind(ld)
        elif ld and ld[:7] > month:
            nxt.append(n); notes.append(f'{Path(n).name}: κλειδωμένο για {ld} → επόμενος μήνας')
        elif ld:
            notes.append(f'{Path(n).name}: η ημερομηνία {ld} πέρασε → μπαίνει σε ελεύθερη θέση')
            free.append(n)
        else:
            free.append(n)
    order = [d for d in our if d not in assign] + [d for d in posts if d not in our and d not in assign]
    if mode == 'all_in_month':
        order += [d for d in days if d not in posts and d not in assign]
    for n in free:
        if order:
            d = order.pop(0); assign[d] = n; replaces[d] = kind(d)
        else:
            nxt.append(n)
    return {'assign': dict(sorted(assign.items())), 'replaces': dict(sorted(replaces.items())), 'next_month': nxt,
            'notes': notes}


# ---------------------------------------------------------------- προσθήκη στην παρτίδα
def add(batch, day, src, cl):
    batch, src = Path(batch), Path(src)
    acc = cl.batch_dir_name(batch)
    out = batch / acc
    out.mkdir(parents=True, exist_ok=True)
    if (out / f'{day}_reel.mp4').exists() or list(out.glob(f'{day}_post_*.jpg')):
        print(f'Προσοχή: η {day} είχε ήδη reel/post — το έτοιμο reel τα αντικαθιστά (σβήσε τα δικά μας για εκείνη την ημέρα).')
    info = prepare(src, out / f'{day}_reel.mp4')
    how = cover_for(src, out / f'{day}_reel_cover.jpg')
    caps_path = batch / 'captions.json'
    caps = json.loads(caps_path.read_text(encoding='utf-8')) if caps_path.exists() else {}
    meta = {'ready': True, 'source': src.name, 'music': 'του πελάτη (όπως είναι)'}
    if not info['story']:
        meta['story'] = False
    caps[f'{acc}|{day}|reel'] = meta
    txt = src.with_suffix('.txt')
    if txt.exists():
        caps[f'{acc}|{day}'] = txt.read_text(encoding='utf-8').strip()
    caps_path.write_text(json.dumps(caps, ensure_ascii=False, indent=1), encoding='utf-8')
    print(json.dumps({'reel': str(out / f'{day}_reel.mp4'), 'cover': how, 'duration': info['duration'],
                      'story': info['story'], 'caption': 'από ' + txt.name if txt.exists() else 'ΛΕΙΠΕΙ — γράψε λεζάντα'},
                     ensure_ascii=False))


def main():
    ap = argparse.ArgumentParser()
    sub = ap.add_subparsers(dest='cmd', required=True)
    c = sub.add_parser('check'); c.add_argument('files', nargs='+')
    p = sub.add_parser('plan'); p.add_argument('month'); p.add_argument('files', nargs='*')
    p.add_argument('--our-reels', default=''); p.add_argument('--client')
    d = sub.add_parser('add'); d.add_argument('batch'); d.add_argument('day'); d.add_argument('file'); d.add_argument('--client')
    a = ap.parse_args()
    if a.cmd == 'check':
        print(json.dumps([check(f) for f in a.files], ensure_ascii=False, indent=1))
    elif a.cmd == 'plan':
        cl = clientlib.load(a.client)
        ours = [x for x in a.our_reels.split(',') if x]
        print(json.dumps(place(a.month, cl.post_weekdays, ours, a.files, cl.ready_reels_mode), ensure_ascii=False, indent=1))
    else:
        add(a.batch, a.day, a.file, clientlib.load(a.client))


if __name__ == '__main__':
    main()
