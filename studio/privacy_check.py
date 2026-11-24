#!/usr/bin/env python3
"""Έλεγχος απορρήτου (okpublisher, κάθε πελάτης): τίποτα δεν πάει στο δημόσιο repo χωρίς να περάσει από εδώ.

Κανόνας (απόφαση 22/11/2026, αντικαθιστά της 21/11): φωτογραφίες/βίντεο με παιδιά ΔΕΝ απορρίπτονται·
ΚΑΘΕ πρόσωπο που μπορεί να είναι παιδιού θολώνεται (στην αμφιβολία θόλωμα), ακόμα κι αν φαίνονται ρούχα.
Ό,τι δεν θολώνεται αξιόπιστα (π.χ. γρήγορη κίνηση, πρόσωπο που δεν πιάνει ο ανιχνευτής) ΔΕΝ χρησιμοποιείται.
Πρόσωπα ενηλίκων (υπεύθυνη, συνεργάτιδες) μένουν καθαρά. Ονόματα παιδιών σε ζωγραφιές/ντουλαπάκια θολώνονται.

Ανίχνευση προσώπων (YuNet) και ανθρώπων (YOLOX) — ΟΧΙ αναγνώριση: δεν βρίσκει ΠΟΙΟΣ είναι, μόνο ΑΝ υπάρχει
πρόσωπο/άνθρωπος. Δεν κρίνει ηλικία: κάθε εύρημα το κοιτάζει ο Claude στα φύλλα ελέγχου και αποφασίζει·
στην αμφιβολία, απόρριψη. Στα βίντεο: πρόσωπα σε ΚΑΘΕ καρέ, άνθρωποι σε κάθε 2ο καρέ.

Εντολές:
  scan   <φάκελος ή αρχεία…> --out <φάκελος αναφοράς>
         Ακατέργαστο υλικό: πρόσωπα, άνθρωποι, κείμενο (OCR ελληνικά/αγγλικά) → report.json + φύλλα ελέγχου
         (review/<αρχείο>.jpg με κουτιά: κόκκινο πρόσωπο, πορτοκαλί άνθρωπος, μπλε κείμενο). Για βίντεο και
         χρονολόγιο: σε ποια δευτερόλεπτα υπάρχει πρόσωπο/άνθρωπος.
  blurfaces <εικόνα|βίντεο> <έξοδος> --review <φάκελος> [--keep F2,T3]
         Θολώνει ΟΛΑ τα πρόσωπα (pixelate + gaussian, έλλειψη με περιθώριο), εκτός από όσα δοθούν στο --keep
         (ενήλικες: F<n> σε φωτογραφία, T<n> = ίχνος προσώπου σε βίντεο). Στα βίντεο: ανίχνευση σε ΚΑΘΕ καρέ,
         ίχνη με συνέχεια, γέμισμα κενών έως 10 καρέ και +6 καρέ πριν/μετά, ήχος αφαιρείται. Μετά ξαναψάχνει
         πρόσωπα στο αποτέλεσμα (ό,τι βρεθεί εκτός --keep = ΑΠΟΤΥΧΙΑ, exit 2) και γράφει φύλλα ελέγχου:
         <review>/<όνομα>.ids.jpg (πρόσωπα με αριθμό, πριν το θόλωμα) και <όνομα>.after_NN.jpg (μετά, πυκνά).
  blur   <εικόνα> <έξοδος> --box x,y,w,h [--box …]
         Θόλωμα περιοχών (π.χ. όνομα σε ζωγραφιά): pixelate + gaussian, με περιθώριο. Το αποτέλεσμα ξαναελέγχεται.
  clean  <είσοδος> <έξοδος>
         Αφαίρεση ΟΛΩΝ των metadata (EXIF, GPS, ημερομηνίες συσκευής, QuickTime udta). Εικόνες → JPEG χωρίς EXIF
         (με σωστό προσανατολισμό), βίντεο → ffmpeg -map_metadata -1.
  verify <φάκελος παρτίδας>
         Τελικός έλεγχος ΚΑΘΕ αρχείου που θα ανέβει (jpg/mp4 κάτω από <παρτίδα>/<K>, π.χ. ORE/ ή παλιό LS/): metadata, πρόσωπα
         (κάθε καρέ), άνθρωποι, κείμενο. Γράφει <παρτίδα>/privacy_manifest.json (sha256 ανά αρχείο) και φύλλα
         ελέγχου στο <παρτίδα>/_review/. Αρχεία με εύρημα μένουν "needs_review".
  mark   <φάκελος παρτίδας> ok|reject <αρχείο…> --note "<τι είδες>"
         Μετά τον ΟΠΤΙΚΟ έλεγχο από τον Claude. Το make_queue.py δέχεται μόνο αρχεία με status ok, reviewed
         και ίδιο sha256 (αν το αρχείο αλλάξει μετά τον έλεγχο, ξαναελέγχεται).

Μοντέλα: studio/models/ (τα κατεβάζει το setup.sh· δεν μπαίνουν στο repo).
"""
import argparse, hashlib, json, os, re, subprocess, sys
from datetime import datetime
from pathlib import Path

import cv2
import numpy as np
from PIL import Image, ImageFilter, ImageOps, ImageDraw, ImageFont

try:
    import pillow_heif
    pillow_heif.register_heif_opener()
except Exception:  # χωρίς HEIC: το setup.sh το εγκαθιστά
    pass

HERE = Path(__file__).resolve().parent
MODELS = Path(os.environ.get('OKP_MODELS') or os.environ.get('LS_MODELS') or HERE / 'models')
YUNET = MODELS / 'face_detection_yunet_2023mar.onnx'
YOLOX = MODELS / 'object_detection_yolox_2022nov.onnx'
TESSDATA = MODELS / 'tessdata'

IMG_EXT = ('.jpg', '.jpeg', '.png', '.webp', '.heic', '.heif')
VID_EXT = ('.mp4', '.mov', '.m4v', '.3gp', '.avi', '.webm')
FACE_SCORE = 0.55        # χαμηλό όριο: προτιμάμε ψευδή συναγερμό από χαμένο πρόσωπο
PERSON_SCORE = 0.30
PERSON_EVERY = 2         # άνθρωποι σε κάθε 2ο καρέ βίντεο (πρόσωπα σε ΚΑΘΕ καρέ)


# ---------------------------------------------------------------- loaders
def load_image(path):
    """RGB numpy (BGR για OpenCV) με τον σωστό προσανατολισμό (EXIF)."""
    im = ImageOps.exif_transpose(Image.open(path)).convert('RGB')
    return cv2.cvtColor(np.array(im), cv2.COLOR_RGB2BGR)


def sha256(path):
    h = hashlib.sha256()
    with open(path, 'rb') as f:
        for chunk in iter(lambda: f.read(1 << 20), b''):
            h.update(chunk)
    return h.hexdigest()


# ---------------------------------------------------------------- detectors
class Faces:
    def __init__(self):
        if not YUNET.exists():
            sys.exit(f'Λείπει το μοντέλο {YUNET}: τρέξε studio/setup.sh')
        self.det = cv2.FaceDetectorYN.create(str(YUNET), '', (320, 320), FACE_SCORE, 0.3, 5000)

    def _run(self, bgr):
        h, w = bgr.shape[:2]
        self.det.setInputSize((w, h))
        _, f = self.det.detect(bgr)
        return [] if f is None else [(float(r[0]), float(r[1]), float(r[2]), float(r[3]), float(r[14])) for r in f]

    def __call__(self, bgr):
        """Πρόσωπα σε δύο κλίμακες (ολόκληρη εικόνα έως 1280px + πλακίδια για μικρά/μακρινά πρόσωπα)."""
        H, W = bgr.shape[:2]
        out = []
        s = min(1.0, 1280 / max(H, W))
        small = cv2.resize(bgr, (int(W * s), int(H * s))) if s < 1 else bgr
        out += [(x / s, y / s, w / s, h / s, sc) for x, y, w, h, sc in self._run(small)]
        if max(H, W) > 1400:   # πλακίδια 2×2 με επικάλυψη, σε πλήρη ανάλυση
            th, tw = int(H * 0.6), int(W * 0.6)
            for oy in (0, H - th):
                for ox in (0, W - tw):
                    tile = bgr[oy:oy + th, ox:ox + tw]
                    ts = min(1.0, 1280 / max(th, tw))
                    t2 = cv2.resize(tile, (int(tw * ts), int(th * ts))) if ts < 1 else tile
                    out += [(ox + x / ts, oy + y / ts, w / ts, h / ts, sc) for x, y, w, h, sc in self._run(t2)]
        return nms(out)


class People:
    """YOLOX-S (COCO) μόνο για την κλάση «person»."""
    def __init__(self):
        if not YOLOX.exists():
            sys.exit(f'Λείπει το μοντέλο {YOLOX}: τρέξε studio/setup.sh')
        self.net = cv2.dnn.readNet(str(YOLOX))
        self.size, strides = 640, [8, 16, 32]
        grids, exp = [], []
        for st in strides:
            n = self.size // st
            xv, yv = np.meshgrid(np.arange(n), np.arange(n))
            g = np.stack((xv, yv), 2).reshape(1, -1, 2)
            grids.append(g); exp.append(np.full((*g.shape[:2], 1), st))
        self.grids, self.strides = np.concatenate(grids, 1), np.concatenate(exp, 1)

    def __call__(self, bgr):
        H, W = bgr.shape[:2]
        r = min(self.size / H, self.size / W)
        pad = np.full((self.size, self.size, 3), 114, np.uint8)
        pad[:int(H * r), :int(W * r)] = cv2.resize(cv2.cvtColor(bgr, cv2.COLOR_BGR2RGB), (int(W * r), int(H * r)))
        self.net.setInput(np.transpose(pad.astype(np.float32), (2, 0, 1))[None])
        d = self.net.forward(self.net.getUnconnectedOutLayersNames())[0][0]
        d[:, :2] = (d[:, :2] + self.grids[0]) * self.strides[0]
        d[:, 2:4] = np.exp(d[:, 2:4]) * self.strides[0]
        score = d[:, 4] * d[:, 5]                     # objectness × P(person)
        keep = score > PERSON_SCORE
        b, s = d[keep, :4], score[keep]
        boxes = [[float((cx - w / 2) / r), float((cy - h / 2) / r), float(w / r), float(h / r)] for cx, cy, w, h in b]
        idx = cv2.dnn.NMSBoxes(boxes, s.tolist(), PERSON_SCORE, 0.5) if boxes else []
        return [(*boxes[i], float(s[i])) for i in np.array(idx).flatten()]


def nms(dets, thr=0.4):
    if not dets:
        return []
    idx = cv2.dnn.NMSBoxes([d[:4] for d in dets], [d[4] for d in dets], 0.0, thr)
    return [dets[i] for i in np.array(idx).flatten()]


def ocr(bgr):
    """Λέξεις με το πλαίσιό τους (ελληνικά + αγγλικά). Για εύρεση ονομάτων σε καρτελάκια/ζωγραφιές."""
    env = dict(os.environ, TESSDATA_PREFIX=str(TESSDATA)) if TESSDATA.exists() else None
    langs = 'ell+eng' if (TESSDATA / 'ell.traineddata').exists() else 'eng'
    H, W = bgr.shape[:2]
    s = min(1.0, 2200 / max(H, W))
    img = cv2.resize(bgr, (int(W * s), int(H * s))) if s < 1 else bgr
    ok, buf = cv2.imencode('.png', img)
    try:
        r = subprocess.run(['tesseract', 'stdin', 'stdout', '-l', langs, '--psm', '11', 'tsv'],
                           input=buf.tobytes(), capture_output=True, env=env, timeout=120)
    except Exception as e:
        return [{'error': str(e)}]
    words = []
    for line in r.stdout.decode('utf-8', 'ignore').splitlines()[1:]:
        p = line.split('\t')
        if len(p) == 12 and p[11].strip() and float(p[10]) >= 55 and len(p[11].strip()) >= 2:
            x, y, w, h = (int(v) / s for v in p[6:10])
            words.append({'text': p[11].strip(), 'conf': float(p[10]), 'box': [round(x), round(y), round(w), round(h)]})
    return words


# ---------------------------------------------------------------- drawing
def font(px):
    for f in ('/usr/share/fonts/truetype/dejavu/DejaVuSans-Bold.ttf',
              '/usr/share/fonts/truetype/liberation/LiberationSans-Bold.ttf'):
        if os.path.exists(f):
            return ImageFont.truetype(f, px)
    return ImageFont.load_default()


def draw(bgr, faces, people, words, label=''):
    im = Image.fromarray(cv2.cvtColor(bgr, cv2.COLOR_BGR2RGB))
    d = ImageDraw.Draw(im)
    lw = max(3, im.width // 300)
    for x, y, w, h, s in people:
        d.rectangle([x, y, x + w, y + h], outline=(255, 140, 0), width=lw)
    for x, y, w, h, s in faces:
        d.rectangle([x, y, x + w, y + h], outline=(255, 0, 0), width=lw * 2)
        d.text((x, max(0, y - lw * 9)), f'{s:.2f}', fill=(255, 0, 0), font=font(lw * 8))
    for wd in words:
        if 'box' in wd:
            x, y, w, h = wd['box']
            d.rectangle([x, y, x + w, y + h], outline=(0, 90, 255), width=lw)
    if label:
        px = max(22, im.width // 28)
        d.rectangle([0, 0, im.width, int(px * 1.6)], fill=(0, 0, 0))
        d.text((10, int(px * 0.25)), label, fill=(255, 255, 255), font=font(px))
    return im


def sheet(frames, cols=4, width=1600):
    """Φύλλο επαφής: πολλά καρέ σε μία εικόνα για οπτικό έλεγχο."""
    if not frames:
        return None
    cw = width // cols
    ims = [f.copy() for f in frames]
    for f in ims:
        f.thumbnail((cw, cw * 2))
    ch = max(f.height for f in ims)
    rows = (len(ims) + cols - 1) // cols
    out = Image.new('RGB', (cw * cols, ch * rows), (40, 40, 40))
    for i, f in enumerate(ims):
        out.paste(f, ((i % cols) * cw, (i // cols) * ch))
    return out


# ---------------------------------------------------------------- analysis
def analyze_image(path, F, Pp, review_dir):
    bgr = load_image(path)
    faces, people, words = F(bgr), Pp(bgr), ocr(bgr)
    name = Path(path).name
    draw(bgr, faces, people, words, f'{name}  πρόσωπα:{len(faces)} άνθρωποι:{len(people)} λέξεις:{len(words)}') \
        .save(review_dir / (name + '.review.jpg'), quality=85)
    return {'file': str(path), 'kind': 'image', 'size': [bgr.shape[1], bgr.shape[0]],
            'faces': [[round(v, 1) for v in f] for f in faces], 'people': [[round(v, 1) for v in p] for p in people],
            'text': words, 'review': str(review_dir / (name + '.review.jpg'))}


def analyze_video(path, F, Pp, review_dir, sheet_every=0.5):
    cap = cv2.VideoCapture(str(path))
    fps = cap.get(cv2.CAP_PROP_FPS) or 30.0
    n_total = int(cap.get(cv2.CAP_PROP_FRAME_COUNT) or 0)
    face_frames, person_frames, thumbs = [], [], []
    next_thumb, i = 0.0, 0
    name = Path(path).name
    while True:
        ok, frame = cap.read()
        if not ok:
            break
        t = i / fps
        faces = F(frame)
        people = Pp(frame) if i % PERSON_EVERY == 0 else []
        if faces:
            face_frames.append((round(t, 2), [[round(v, 1) for v in f] for f in faces]))
        if people:
            person_frames.append((round(t, 2), len(people)))
        if t >= next_thumb or faces:
            if t >= next_thumb or (faces and (not thumbs or thumbs[-1][0] < t - 0.2)):
                thumbs.append((t, draw(frame, faces, people, [], f'{t:5.2f}s  πρόσωπα:{len(faces)} άνθρωποι:{len(people)}')))
            if t >= next_thumb:
                next_thumb += sheet_every
        i += 1
    cap.release()
    # OCR σε λίγα καρέ (1/δευτ.)
    words = []
    cap = cv2.VideoCapture(str(path))
    for k in range(0, max(i, 1), max(int(fps), 1)):
        cap.set(cv2.CAP_PROP_POS_FRAMES, k)
        ok, frame = cap.read()
        if ok:
            for wd in ocr(frame):
                wd['t'] = round(k / fps, 2)
                words.append(wd)
    cap.release()
    sheets = []
    for s in range(0, len(thumbs), 24):
        sh = sheet([im for _, im in thumbs[s:s + 24]])
        p = review_dir / f'{name}.review_{s // 24 + 1:02d}.jpg'
        sh.save(p, quality=80)
        sheets.append(str(p))
    return {'file': str(path), 'kind': 'video', 'fps': round(fps, 3), 'frames': i, 'frames_meta': n_total,
            'duration': round(i / fps, 2), 'face_frames': len(face_frames), 'faces': face_frames[:500],
            'face_segments': segments([t for t, _ in face_frames], 1 / fps),
            'person_segments': segments([t for t, _ in person_frames], PERSON_EVERY / fps),
            'text': words, 'review': sheets}


def segments(ts, step):
    """[0.0, 0.03, 0.07, 2.0] → [[0.0, 0.07], [2.0, 2.0]]"""
    out = []
    for t in ts:
        if out and t - out[-1][1] <= step * 2.5:
            out[-1][1] = t
        else:
            out.append([t, t])
    return out


def files_in(paths):
    out = []
    for p in paths:
        p = Path(p)
        if p.is_dir():
            out += sorted(q for q in p.rglob('*') if q.suffix.lower() in IMG_EXT + VID_EXT and '_review' not in q.parts)
        elif p.suffix.lower() in IMG_EXT + VID_EXT:
            out.append(p)
    return out


def cmd_scan(a):
    out = Path(a.out); rv = out / 'review'; rv.mkdir(parents=True, exist_ok=True)
    F, Pp = Faces(), People()
    rep = []
    for p in files_in(a.paths):
        r = analyze_video(p, F, Pp, rv) if p.suffix.lower() in VID_EXT else analyze_image(p, F, Pp, rv)
        flag = bool(r['faces']) or bool(r.get('people')) or bool(r.get('person_segments')) or bool(r['text'])
        r['flag'] = flag
        rep.append(r)
        print(('⚠ ' if flag else '✓ ') + p.name + ': ' + summary(r))
    (out / 'report.json').write_text(json.dumps(rep, ensure_ascii=False, indent=1), encoding='utf-8')
    print(f'\nΑναφορά: {out / "report.json"} · φύλλα ελέγχου: {rv}')


def summary(r):
    if r['kind'] == 'image':
        return f"πρόσωπα {len(r['faces'])}, άνθρωποι {len(r['people'])}, λέξεις {len(r['text'])}"
    return (f"{r['duration']}s, {r['frames']} καρέ, πρόσωπα σε {r['face_frames']} καρέ {r['face_segments']}, "
            f"άνθρωποι {r['person_segments']}, λέξεις {len(r['text'])}")


# ---------------------------------------------------------------- blur / clean
def cmd_blur(a):
    im = ImageOps.exif_transpose(Image.open(a.src)).convert('RGB')
    for b in a.box:
        x, y, w, h = (int(float(v)) for v in b.split(','))
        m = int(max(w, h) * 0.25) + 6
        x0, y0, x1, y1 = max(0, x - m), max(0, y - m), min(im.width, x + w + m), min(im.height, y + h + m)
        reg = im.crop((x0, y0, x1, y1))
        px = max(1, (x1 - x0) // 10)
        reg = reg.resize((max(1, (x1 - x0) // px), max(1, (y1 - y0) // px)), Image.BILINEAR).resize(reg.size, Image.NEAREST)
        reg = reg.filter(ImageFilter.GaussianBlur(max(6, px)))
        im.paste(reg, (x0, y0))
    im.save(a.dst, quality=93)
    print('θολώθηκαν', len(a.box), 'περιοχές →', a.dst, '(ξαναέλεγξέ το με scan)')


def clean_file(src, dst):
    src, dst = Path(src), Path(dst)
    dst.parent.mkdir(parents=True, exist_ok=True)
    if src.suffix.lower() in IMG_EXT:
        im = ImageOps.exif_transpose(Image.open(src)).convert('RGB')
        clean = Image.new('RGB', im.size)
        clean.paste(im)                                   # νέα εικόνα: τίποτα από τα info/exif/icc της πηγής
        if dst.suffix.lower() not in ('.jpg', '.jpeg'):
            dst = dst.with_suffix('.jpg')
        clean.save(dst, 'JPEG', quality=93, optimize=True)
    else:
        subprocess.run(['ffmpeg', '-v', 'error', '-y', '-i', str(src), '-map', '0:v:0', '-map', '0:a:0?',
                        '-map_metadata', '-1', '-map_metadata:s:v', '-1', '-map_metadata:s:a', '-1',
                        '-map_chapters', '-1', '-c', 'copy', '-movflags', '+faststart', str(dst)], check=True)
    return dst


def metadata_problems(path):
    """Κενή λίστα = καθαρό. Ελέγχει EXIF/GPS/XMP σε εικόνες και tags (location, creation_time, συσκευή) σε βίντεο."""
    p = Path(path)
    probs = []
    if p.suffix.lower() in IMG_EXT:
        im = Image.open(p)
        ex = im.getexif()
        if len(ex):
            probs.append(f'EXIF ({len(ex)} πεδία)')
        for k in ('exif', 'xmp', 'XML:com.adobe.xmp', 'comment', 'photoshop'):
            if im.info.get(k):
                probs.append(k)
        raw = p.read_bytes()[:200000]
        if b'GPS' in raw and b'Exif' in raw:
            probs.append('GPS')
    else:
        r = subprocess.run(['ffprobe', '-v', 'error', '-show_entries', 'format_tags:stream_tags', '-of', 'json', str(p)],
                           capture_output=True, text=True)
        j = json.loads(r.stdout or '{}')
        tags = dict((j.get('format') or {}).get('tags') or {})
        for s in j.get('streams', []):
            tags.update({('stream.' + k): v for k, v in (s.get('tags') or {}).items()})
        allowed = {'major_brand', 'minor_version', 'compatible_brands', 'encoder', 'stream.language',
                   'stream.handler_name', 'stream.vendor_id', 'stream.encoder'}
        bad = {k: v for k, v in tags.items() if k not in allowed}
        handler_bad = [v for k, v in tags.items() if k == 'stream.handler_name' and 'core media' in str(v).lower()]
        if bad:
            probs.append('tags: ' + ', '.join(sorted(bad)))
        if handler_bad:
            probs.append('handler συσκευής')
    return probs


def cmd_clean(a):
    d = clean_file(a.src, a.dst)
    pr = metadata_problems(d)
    print(('ΠΡΟΒΛΗΜΑ: ' + '; '.join(pr)) if pr else f'καθαρό: {d}')
    sys.exit(1 if pr else 0)



# ---------------------------------------------------------------- blur faces (παιδιά)
HOLD, MAXGAP, PAD = 6, 10, 0.35


def blur_face(img, box, pad=PAD):
    """Θόλωμα ενός προσώπου σε έλλειψη με περιθώριο (pixelate + gaussian), επιτόπου."""
    x, y, w, h = box[:4]
    H, W = img.shape[:2]
    cx, cy = x + w / 2, y + h / 2 - h * 0.05
    ax, ay = w * (1 + 2 * pad) / 2, h * (1 + 2 * pad) * 1.12 / 2
    x0, y0, x1, y1 = int(max(0, cx - ax)), int(max(0, cy - ay)), int(min(W, cx + ax)), int(min(H, cy + ay))
    if x1 - x0 < 4 or y1 - y0 < 4:
        return
    roi = img[y0:y1, x0:x1]
    k = max(8, (x1 - x0) // 7)
    small = cv2.resize(roi, (max(1, (x1 - x0) // k), max(1, (y1 - y0) // k)), interpolation=cv2.INTER_AREA)
    pix = cv2.resize(small, (x1 - x0, y1 - y0), interpolation=cv2.INTER_NEAREST)
    pix = cv2.GaussianBlur(pix, (0, 0), max(5.0, (x1 - x0) / 8))
    mask = np.zeros((y1 - y0, x1 - x0), np.float32)
    cv2.ellipse(mask, (int(cx - x0), int(cy - y0)), (int(ax), int(ay)), 0, 0, 360, 1.0, -1)
    mask = cv2.GaussianBlur(mask, (0, 0), 2.5)[..., None]
    roi[:] = (roi * (1 - mask) + pix * mask).astype(np.uint8)


def iou(a, b):
    ax, ay, aw, ah = a[:4]; bx, by, bw, bh = b[:4]
    ix, iy = max(0, min(ax + aw, bx + bw) - max(ax, bx)), max(0, min(ay + ah, by + bh) - max(ay, by))
    inter = ix * iy
    return inter / (aw * ah + bw * bh - inter + 1e-9)


def near(a, b):
    """Ίδιο πρόσωπο σε διπλανά καρέ: επικάλυψη ή κέντρα κοντά σε σχέση με το μέγεθος."""
    if iou(a, b) > 0.15:
        return True
    d = ((a[0] + a[2] / 2 - b[0] - b[2] / 2) ** 2 + (a[1] + a[3] / 2 - b[1] - b[3] / 2) ** 2) ** 0.5
    return d < 0.8 * max(a[2], b[2])


def tracks_from(dets):
    """dets: λίστα ανά καρέ με κουτιά → λίστα ιχνών {frame: box}."""
    tracks = []
    for f, boxes in enumerate(dets):
        for b in boxes:
            best = None
            for t in tracks:
                lf = max(t)
                if f - lf <= MAXGAP and lf != f and near(t[lf], b) and (best is None or iou(t[lf], b) > iou(best[max(best)], b)):
                    best = t
            if best is None:
                tracks.append({f: b})
            else:
                best[f] = b
    return tracks


def fill(track, n):
    """Γέμισμα κενών (γραμμική παρεμβολή) και κράτημα HOLD καρέ πριν/μετά."""
    fs = sorted(track)
    out = dict(track)
    for a, b in zip(fs, fs[1:]):
        for f in range(a + 1, b):
            t = (f - a) / (b - a)
            out[f] = tuple(track[a][i] * (1 - t) + track[b][i] * t for i in range(4))
    for f in range(max(0, fs[0] - HOLD), fs[0]):
        out[f] = track[fs[0]]
    for f in range(fs[-1] + 1, min(n, fs[-1] + HOLD + 1)):
        out[f] = track[fs[-1]]
    return out


def covered(b, boxes, pad=PAD):
    """Το κουτί b πέφτει πάνω σε περιοχή που θολώθηκε/κρατήθηκε (κέντρο μέσα στη διευρυμένη έλλειψη ή επικάλυψη)."""
    cx, cy = b[0] + b[2] / 2, b[1] + b[3] / 2
    for x, y, w, h in (q[:4] for q in boxes):
        ax, ay = w * (1 + 2 * pad) / 2, h * (1 + 2 * pad) * 1.12 / 2
        if ((cx - x - w / 2) / ax) ** 2 + ((cy - y - h / 2 + h * 0.05) / ay) ** 2 <= 1 or iou(b, (x, y, w, h)) > 0.2:
            return True
    return False


def crop_thumb(img, box, label):
    x, y, w, h = (int(v) for v in box[:4])
    m = int(max(w, h) * 0.6)
    c = img[max(0, y - m):y + h + m, max(0, x - m):x + w + m]
    im = Image.fromarray(cv2.cvtColor(c, cv2.COLOR_BGR2RGB)) if c.size else Image.new('RGB', (64, 64))
    im.thumbnail((360, 360))
    can = Image.new('RGB', (360, 400), (30, 30, 30)); can.paste(im, ((360 - im.width) // 2, 40))
    ImageDraw.Draw(can).text((10, 8), label, fill=(255, 255, 0), font=font(24))
    return can


def blurfaces_image(src, dst, review, keep, F):
    img = load_image(src)
    faces = sorted(F(img), key=lambda b: (b[0], b[1]))
    ids = {f'F{i + 1}': b for i, b in enumerate(faces)}
    name = Path(src).name
    pre = draw(img, [], [], [], f'{name}: {len(faces)} πρόσωπα (πριν το θόλωμα)')
    d = ImageDraw.Draw(pre)
    for k, (x, y, w, h, sc) in ids.items():
        d.rectangle([x, y, x + w, y + h], outline=(255, 0, 0), width=max(3, pre.width // 250))
        d.text((x, max(0, y - pre.width // 30)), k, fill=(255, 255, 0), font=font(max(18, pre.width // 35)))
    pre.save(review / f'{name}.ids.jpg', quality=85)
    for k, b in ids.items():
        if k not in keep:
            blur_face(img, b)
    out = Image.fromarray(cv2.cvtColor(img, cv2.COLOR_BGR2RGB))
    clean = Image.new('RGB', out.size); clean.paste(out)
    Path(dst).parent.mkdir(parents=True, exist_ok=True)
    clean.save(dst, 'JPEG', quality=93)
    done = list(ids.values())   # θολωμένα + κρατημένα (ενήλικες)
    left = [b for b in F(load_image(dst)) if not covered(b, done)]
    draw(load_image(dst), left, [], [], f'{name}: ΜΕΤΑ — πρόσωπα που φαίνονται ακόμα: {len(left)}').save(
        review / f'{name}.after_01.jpg', quality=85)
    return {'faces': len(faces), 'blurred': len([k for k in ids if k not in keep]), 'kept': sorted(set(keep) & set(ids)),
            'residual': len(left)}


def blurfaces_video(src, dst, review, keep, F, Pp):
    name = Path(src).name
    cap = cv2.VideoCapture(str(src))
    fps = cap.get(cv2.CAP_PROP_FPS) or 30.0
    frames, dets = [], []
    while True:
        ok, fr = cap.read()
        if not ok:
            break
        frames.append(fr)
        dets.append(F(fr))
    cap.release()
    n = len(frames)
    if not n:
        sys.exit(f'{src}: δεν διαβάστηκε κανένα καρέ')
    raw_tracks = tracks_from(dets)
    tracks = {f'T{i + 1}': t for i, t in enumerate(sorted(raw_tracks, key=min))}
    thumbs = []
    for k, t in tracks.items():
        f = max(t, key=lambda q: t[q][2] * t[q][3])
        thumbs.append(crop_thumb(frames[f], t[f], f'{k}: {min(t) / fps:.1f}–{max(t) / fps:.1f}s, {len(t)} καρέ'))
    if thumbs:
        sheet(thumbs, cols=4, width=1440).save(review / f'{name}.ids.jpg', quality=85)
    plan = [[] for _ in range(n)]
    for k, t in tracks.items():
        if k in keep:
            continue
        for f, b in fill(t, n).items():
            plan[f].append(b)
    H, W = frames[0].shape[:2]
    Path(dst).parent.mkdir(parents=True, exist_ok=True)
    enc = subprocess.Popen(['ffmpeg', '-v', 'error', '-y', '-f', 'rawvideo', '-pix_fmt', 'bgr24', '-s', f'{W}x{H}', '-r', f'{fps}',
                            '-i', '-', '-an', '-c:v', 'libx264', '-preset', 'veryfast', '-crf', '18', '-pix_fmt', 'yuv420p',
                            '-map_metadata', '-1', '-movflags', '+faststart', str(dst)], stdin=subprocess.PIPE)
    for f, fr in enumerate(frames):
        for b in plan[f]:
            blur_face(fr, b)
        enc.stdin.write(fr.tobytes())
    enc.stdin.close(); enc.wait()
    # έλεγχος μετά: πρόσωπα που φαίνονται ακόμα (εκτός ενηλίκων του --keep) σε ΚΑΘΕ καρέ του αποτελέσματος
    done = [[] for _ in range(n)]   # ανά καρέ: θολωμένα + κρατημένα (ενήλικες)
    for k, t in tracks.items():
        for ff, b in fill(t, n).items():
            done[ff].append(b)
    cap = cv2.VideoCapture(str(dst))
    residual, after, step, f, nxt = [], [], max(1, int(round(fps / 4))), 0, 0
    while True:
        ok, fr = cap.read()
        if not ok:
            break
        left = [b for b in F(fr) if not covered(b, done[f] if f < n else [])]
        if left:
            residual.append(round(f / fps, 2))
        if f % step == 0 or left:
            people = Pp(fr) if f % step == 0 else []
            after.append(draw(fr, left, people, [], f'{f / fps:5.2f}s ΜΕΤΑ  πρόσωπα που φαίνονται:{len(left)} άνθρωποι:{len(people)}'))
        f += 1
    cap.release()
    for s in range(0, len(after), 24):
        sheet(after[s:s + 24]).save(review / f'{name}.after_{s // 24 + 1:02d}.jpg', quality=80)
    return {'frames': n, 'fps': round(fps, 3), 'tracks': {k: [round(min(t) / fps, 2), round(max(t) / fps, 2), len(t)] for k, t in tracks.items()},
            'kept': sorted(set(keep) & set(tracks)), 'residual_seconds': segments(residual, 1 / fps)}


def cmd_blurfaces(a):
    review = Path(a.review); review.mkdir(parents=True, exist_ok=True)
    keep = [k.strip() for k in (a.keep or '').split(',') if k.strip()]
    F = Faces()
    if Path(a.src).suffix.lower() in VID_EXT:
        r = blurfaces_video(a.src, a.dst, review, keep, F, People())
        bad = bool(r['residual_seconds'])
    else:
        r = blurfaces_image(a.src, a.dst, review, keep, F)
        bad = r['residual'] > 0
    print(json.dumps(r, ensure_ascii=False))
    print(('ΑΠΟΤΥΧΙΑ: φαίνονται ακόμα πρόσωπα (δες τα φύλλα *.after_*). Κόψε αυτά τα σημεία ή μην το χρησιμοποιήσεις.'
           if bad else 'OK: δεν βρέθηκε πρόσωπο εκτός --keep. ΚΟΙΤΑ τα φύλλα *.after_* πριν το χρησιμοποιήσεις.'))
    sys.exit(2 if bad else 0)


# ---------------------------------------------------------------- verify / mark
def manifest_path(batch):
    return Path(batch) / 'privacy_manifest.json'


def load_manifest(batch):
    p = manifest_path(batch)
    return json.loads(p.read_text(encoding='utf-8')) if p.exists() else {'files': {}}


def cmd_verify(a):
    batch = Path(a.batch)
    rv = batch / '_review'; rv.mkdir(exist_ok=True)
    F, Pp = Faces(), People()
    man = load_manifest(batch)
    dirs = [batch / d for d in sorted(os.listdir(batch)) if (batch / d).is_dir() and re.match(r'^[A-Z0-9]{2,12}$', d)]
    files = [p for p in files_in(dirs) if not p.name.endswith('.html')]
    for p in files:
        rel = str(p.relative_to(batch))
        h = sha256(p)
        old = man['files'].get(rel)
        if old and old.get('sha256') == h and old.get('reviewed'):
            print(f'= {rel}: ήδη ελεγμένο ({old["status"]})')
            continue
        r = analyze_video(p, F, Pp, rv) if p.suffix.lower() in VID_EXT else analyze_image(p, F, Pp, rv)
        meta = metadata_problems(p)
        found = bool(r['faces']) or bool(r.get('people')) or bool(r.get('person_segments'))
        entry = {'sha256': h, 'checked_at': datetime.now().isoformat(timespec='seconds'), 'metadata': meta,
                 'faces': len(r['faces']) if r['kind'] == 'image' else r['face_frames'],
                 'face_segments': r.get('face_segments'), 'person_segments': r.get('person_segments'),
                 'people': len(r.get('people') or []), 'text': [w['text'] for w in r['text']][:60],
                 'review': r['review'], 'reviewed': False, 'status': 'blocked' if meta else 'needs_review'}
        man['files'][rel] = entry
        print(('✗ ' if meta else ('⚠ ' if found else '· ')) + rel + ': ' + summary(r) + (f' · METADATA: {meta}' if meta else ''))
    for rel in list(man['files']):
        if not (batch / rel).exists():
            del man['files'][rel]
    manifest_path(batch).write_text(json.dumps(man, ensure_ascii=False, indent=1), encoding='utf-8')
    todo = [k for k, v in man['files'].items() if not v.get('reviewed')]
    print(f'\n{len(man["files"])} αρχεία, χωρίς οπτικό έλεγχο: {len(todo)}. Δες τα φύλλα στο {rv} και μετά: '
          f'privacy_check.py mark {batch} ok|reject <αρχεία> --note "…"')


def cmd_mark(a):
    batch = Path(a.batch)
    man = load_manifest(batch)
    for f in a.files:
        p = Path(f)
        rel = str(p.relative_to(batch)) if p.is_absolute() or str(p).startswith(str(batch)) else str(p)
        e = man['files'].get(rel)
        if not e:
            sys.exit(f'Δεν υπάρχει στο manifest: {rel} (τρέξε πρώτα verify)')
        if e['sha256'] != sha256(batch / rel):
            sys.exit(f'{rel}: άλλαξε μετά τον έλεγχο, τρέξε ξανά verify')
        if a.decision == 'ok' and e['metadata']:
            sys.exit(f'{rel}: έχει metadata {e["metadata"]}, δεν γίνεται ok (τρέξε clean)')
        e.update(reviewed=True, status=a.decision, note=a.note, reviewed_at=datetime.now().isoformat(timespec='seconds'))
        print(f'{rel}: {a.decision} — {a.note}')
    manifest_path(batch).write_text(json.dumps(man, ensure_ascii=False, indent=1), encoding='utf-8')


def cleared(batch, path):
    """Για το make_queue.py: True μόνο αν το αρχείο είναι ok, ελεγμένο οπτικά, χωρίς metadata και αμετάβλητο."""
    batch, path = Path(batch), Path(path)
    e = load_manifest(batch)['files'].get(str(path.relative_to(batch)))
    return bool(e and e.get('reviewed') and e.get('status') == 'ok' and not e.get('metadata')
                and e.get('sha256') == sha256(path))


def main():
    ap = argparse.ArgumentParser(description=__doc__, formatter_class=argparse.RawDescriptionHelpFormatter)
    sp = ap.add_subparsers(dest='cmd', required=True)
    s = sp.add_parser('scan'); s.add_argument('paths', nargs='+'); s.add_argument('--out', required=True); s.set_defaults(fn=cmd_scan)
    s = sp.add_parser('blurfaces'); s.add_argument('src'); s.add_argument('dst'); s.add_argument('--review', required=True)
    s.add_argument('--keep', default=''); s.set_defaults(fn=cmd_blurfaces)
    s = sp.add_parser('blur'); s.add_argument('src'); s.add_argument('dst'); s.add_argument('--box', action='append', required=True); s.set_defaults(fn=cmd_blur)
    s = sp.add_parser('clean'); s.add_argument('src'); s.add_argument('dst'); s.set_defaults(fn=cmd_clean)
    s = sp.add_parser('verify'); s.add_argument('batch'); s.set_defaults(fn=cmd_verify)
    s = sp.add_parser('mark'); s.add_argument('batch'); s.add_argument('decision', choices=['ok', 'reject'])
    s.add_argument('files', nargs='+'); s.add_argument('--note', required=True); s.set_defaults(fn=cmd_mark)
    a = ap.parse_args()
    a.fn(a)


if __name__ == '__main__':
    main()
