#!/usr/bin/env python3
"""Λογότυπο πελάτη σε οποιαδήποτε μορφή → διάφανα PNG για τα posts (okpublisher studio, 26/11/2026).

    python3 studio/logo_prep.py ΑΡΧΕΙΟ [ΑΡΧΕΙΟ …] --client K [--name logo] [--primary #HEX] [--out ΦΑΚΕΛΟΣ] [--keep-holes]

ΑΡΧΕΙΟ: ό,τι ανέβασε ο πελάτης στον υποφάκελο «ΛΟΓΟΤΥΠΟ» του Drive: PNG, JPG, WEBP, GIF, BMP, TIFF, HEIC, PSD, ICO,
SVG, PDF, AI (με PDF μέσα, όπως σχεδόν όλα), EPS (θέλει ghostscript). Με πολλά αρχεία διαλέγει το καλύτερο:
διανυσματικό > PNG με διαφάνεια > μεγαλύτερη εικόνα· «logo» / «λογότυπο» στο όνομα μετράει.

Βγάζει στο clients/<K>/logos/ του publisher-work (OKP_WORK) ή στο --out:
    <name>.png          τα χρώματα του λογότυπου, διάφανο φόντο, κομμένα περιθώρια
    <name>_white.png    όλο λευκό (για σκούρα φόντα / το κύριο χρώμα)
    <name>_dark.png     όλο σκούρο (για ανοιχτόχρωμα λογότυπα σε ανοιχτά φόντα)
    <name>_preview.png  δείγμα σε ανοιχτό, κύριο και σκούρο φόντο: το βλέπει ο Πέτρος πριν μπει στο config
και τυπώνει JSON με προειδοποιήσεις, τα χρώματα του λογότυπου και το προτεινόμενο brand.logos (default, on_primary).

Φόντο: αν το αρχείο δεν έχει διαφάνεια και οι άκρες του είναι ένα χρώμα, το χρώμα του φόντου γίνεται διάφανο παντού,
και μέσα στα γράμματα (Ο, ρ, …), με μαλακές άκρες. Αν το λογότυπο έχει στοιχεία στο ίδιο χρώμα με το φόντο (π.χ. λευκά
γράμματα μέσα σε κόκκινο κύκλο) και πρέπει να μείνουν, --keep-holes: διάφανο μόνο το φόντο που ακουμπά τις άκρες (το δείγμα
το δείχνει). Άκρες με πολλά χρώματα (π.χ. φωτογραφία ταμπέλας) → προειδοποίηση: ζητάμε καλύτερο αρχείο από τον πελάτη.
Ασφάλεια: τα αρχεία του πελάτη ανοίγουν μόνο με rsvg-convert, pdftocairo, ghostscript -dSAFER και Pillow (όχι ImageMagick).
"""
import argparse, json, os, shutil, subprocess, sys, tempfile
from pathlib import Path

import numpy as np
from PIL import Image, ImageOps

VECTOR = {'.svg': 3.0, '.svgz': 3.0, '.pdf': 2.6, '.ai': 2.6, '.eps': 2.4, '.ps': 2.2}
RASTER = {'.png', '.jpg', '.jpeg', '.webp', '.gif', '.bmp', '.tif', '.tiff', '.heic', '.heif', '.psd', '.ico'}
TARGET = 1600            # πλευρά απόδοσης των διανυσματικών
MIN_SIDE = 400           # πιο μικρό → προειδοποίηση (θολό στα posts)
LIGHT_BG = (255, 255, 255)
DARK_BG = (20, 22, 46)   # σκούρο για το δείγμα (όπως το dark του okpublisher)
DARK_LOGO = (26, 26, 26)
WORK = Path(os.environ.get('OKP_WORK', '/home/claude/publisher-work'))


def _run(cmd):
    subprocess.run(cmd, check=True, capture_output=True, timeout=180)


def load(path):
    """Άνοιγμα οποιασδήποτε μορφής → (RGBA εικόνα, είδος)."""
    path = Path(path)
    ext = path.suffix.lower()
    tmp = Path(tempfile.mkdtemp(prefix='logo_'))
    try:
        if ext in ('.svg', '.svgz'):
            out = tmp / 'x.png'
            if shutil.which('rsvg-convert'):
                _run(['rsvg-convert', '-w', str(TARGET), '-a', '-o', str(out), str(path)])
            else:
                import cairosvg  # pip install cairosvg
                cairosvg.svg2png(url=str(path), write_to=str(out), output_width=TARGET)
            return Image.open(out).convert('RGBA'), 'svg'
        if ext in ('.pdf', '.ai'):
            out = tmp / 'x'
            if shutil.which('pdftocairo'):
                _run(['pdftocairo', '-png', '-transp', '-singlefile', '-f', '1', '-l', '1', '-scale-to', str(TARGET), str(path), str(out)])
                return Image.open(str(out) + '.png').convert('RGBA'), 'pdf'
            import fitz  # pip install pymupdf
            page = fitz.open(str(path))[0]
            z = TARGET / max(page.rect.width, page.rect.height)
            pix = page.get_pixmap(alpha=True, matrix=fitz.Matrix(z, z))
            return Image.frombytes('RGBA', (pix.width, pix.height), pix.samples), 'pdf'
        if ext in ('.eps', '.ps'):
            if not shutil.which('gs'):
                raise ValueError('EPS: χρειάζεται ghostscript (gs). Ζήτα PDF, SVG ή PNG από τον πελάτη.')
            out = tmp / 'x.png'
            _run(['gs', '-q', '-dSAFER', '-dBATCH', '-dNOPAUSE', '-dEPSCrop', '-sDEVICE=pngalpha', '-r600', f'-sOutputFile={out}', str(path)])
            return Image.open(out).convert('RGBA'), 'eps'
        if ext in ('.heic', '.heif'):
            import pillow_heif  # στο studio/setup.sh
            pillow_heif.register_heif_opener()
        im = Image.open(path)
        if getattr(im, 'n_frames', 1) > 1:
            im.seek(0)
        im = ImageOps.exif_transpose(im)
        return im.convert('RGBA'), 'raster'
    finally:
        shutil.rmtree(tmp, ignore_errors=True)


def score(path, im, kind):
    """Ποιο αρχείο είναι το καλύτερο λογότυπο."""
    ext = Path(path).suffix.lower()
    s = VECTOR.get(ext, 0.0)
    a = np.asarray(im)[..., 3]
    if kind == 'raster':
        s += 1.5 if (a < 250).mean() > 0.02 else 0.0
        s += min(max(im.size) / 2000, 1.0)
    if any(w in Path(path).stem.lower() for w in ('logo', 'λογότυπ', 'logotyp', 'σήμα')):
        s += 0.3
    return s


def remove_background(im, keep_holes=False, tol=40):
    """Διάφανο φόντο αν λείπει διαφάνεια και οι άκρες είναι ένα χρώμα. → (εικόνα, σημείωση, προειδοποίηση)."""
    a = np.asarray(im).astype(np.float64)
    alpha = a[..., 3]
    if (alpha < 250).mean() > 0.02:
        return im, 'είχε ήδη διαφάνεια', None
    rgb = a[..., :3]
    border = np.concatenate([rgb[0], rgb[-1], rgb[:, 0], rgb[:, -1]])
    bg = np.median(border, axis=0)
    if (np.abs(border - bg).max(axis=1) > tol).mean() > 0.12:
        return im, 'φόντο: δεν αφαιρέθηκε', 'Οι άκρες δεν έχουν ένα χρώμα (φωτογραφία;). Ζήτα από τον πελάτη το αρχείο του λογότυπου (PNG με διαφάνεια, PDF ή SVG).'
    diff = np.abs(rgb - bg).max(axis=2)
    close = (diff <= tol).astype(np.uint8)
    import cv2
    n, lab = cv2.connectedComponents(close, connectivity=4)
    if not keep_holes:
        bgmask = close.astype(bool)
    else:
        edge = np.concatenate([lab[0][close[0] > 0], lab[-1][close[-1] > 0], lab[:, 0][close[:, 0] > 0], lab[:, -1][close[:, -1] > 0]])
        bgmask = np.isin(lab, np.unique(edge))
    new_a = np.where(bgmask, np.clip((diff - 12) / (tol - 12), 0, 1), 1.0)
    # Χρώμα στις μισοδιάφανες άκρες χωρίς «φωτοστέφανο» από το παλιό φόντο.
    part = (new_a > 0) & (new_a < 1)
    if part.any():
        al = new_a[part][:, None]
        rgb[part] = np.clip((rgb[part] - bg * (1 - al)) / al, 0, 255)
    out = np.dstack([rgb, new_a * 255]).round().astype(np.uint8)
    name = 'λευκό' if bg.min() > 235 else ('#%02X%02X%02X' % tuple(int(v) for v in bg))
    return Image.fromarray(out, 'RGBA'), f'φόντο {name}: αφαιρέθηκε' + (' (μόνο γύρω-γύρω)' if keep_holes else ''), None


def trim(im, pad=0.02):
    a = np.asarray(im)[..., 3]
    ys, xs = np.where(a > 10)
    if not len(xs):
        raise ValueError('Το λογότυπο βγήκε άδειο (όλο διάφανο).')
    box = (xs.min(), ys.min(), xs.max() + 1, ys.max() + 1)
    im = im.crop(box)
    p = max(2, int(max(im.size) * pad))
    canvas = Image.new('RGBA', (im.width + 2 * p, im.height + 2 * p), (0, 0, 0, 0))
    canvas.paste(im, (p, p))
    return canvas


def mono(im, color):
    a = np.asarray(im)
    out = np.zeros_like(a)
    out[..., :3] = color
    out[..., 3] = a[..., 3]
    return Image.fromarray(out, 'RGBA')


def _lum(c):
    c = np.asarray(c, dtype=np.float64) / 255
    c = np.where(c <= 0.03928, c / 12.92, ((c + 0.055) / 1.055) ** 2.4)
    return c[..., 0] * 0.2126 + c[..., 1] * 0.7152 + c[..., 2] * 0.0722


def visibility(im, bg):
    """Μερίδιο των ορατών pixel του λογότυπου με αντίθεση ≥ 1,6 πάνω στο φόντο bg."""
    a = np.asarray(im).astype(np.float64)
    vis = a[..., 3] > 128
    if not vis.any():
        return 0.0
    l1, l2 = _lum(a[..., :3][vis]), _lum(np.array(bg, dtype=np.float64))
    ratio = (np.maximum(l1, l2) + 0.05) / (np.minimum(l1, l2) + 0.05)
    return float((ratio >= 1.6).mean())


def colors(im, n=6):
    """Τα κύρια χρώματα του λογότυπου (κοντινές αποχρώσεις μαζί), με το μερίδιό τους."""
    a = np.asarray(im)
    px = a[..., :3][a[..., 3] > 200].astype(np.int64)
    if not len(px):
        return []
    keys, counts = np.unique((px // 16) * 16 + 8, axis=0, return_counts=True)
    groups = []
    for i in np.argsort(-counts):
        k, c = keys[i], int(counts[i])
        for g in groups:
            if np.abs(g['rgb'] - k).max() <= 40:
                g['n'] += c
                break
        else:
            groups.append({'rgb': k, 'n': c})
    tot = float(len(px))
    groups.sort(key=lambda g: -g['n'])
    return [{'hex': '#%02X%02X%02X' % tuple(int(min(v, 255)) for v in g['rgb']), 'share': round(g['n'] / tot, 3)}
            for g in groups if g['n'] / tot >= 0.03][:n]


def hex2rgb(h):
    h = str(h or '').lstrip('#')
    return tuple(int(h[i:i + 2], 16) for i in (0, 2, 4)) if len(h) == 6 else None


def brand_color(key, role):
    """Χρώμα από το config του πελάτη ή της ομάδας του (αν υπάρχει)."""
    try:
        cfg = json.loads((WORK / 'clients' / key / 'config.json').read_text(encoding='utf-8'))
        c = ((cfg.get('brand') or {}).get('colors') or {}).get(role)
        if not c and cfg.get('group'):
            g = json.loads((WORK / 'groups' / cfg['group'] / 'group.json').read_text(encoding='utf-8'))
            c = ((g.get('brand') or {}).get('colors') or {}).get(role)
        return hex2rgb(c)
    except Exception:
        return None


def pick(variants, bg):
    """Η πρώτη παραλλαγή (με σειρά προτίμησης) που φαίνεται καλά στο φόντο· αλλιώς αυτή που φαίνεται καλύτερα."""
    best = max(variants, key=lambda v: visibility(v[1], bg))
    for name, im in variants:
        if visibility(im, bg) >= 0.6:
            return name
    return best[0]


def prepare(files, out_dir, name='logo', primary=None, light=None, keep_holes=False):
    warnings, loaded = [], []
    for f in files:
        try:
            im, kind = load(f)
            loaded.append((score(f, im, kind), str(f), im, kind))
        except Exception as e:  # noqa: BLE001
            warnings.append(f'{Path(f).name}: δεν άνοιξε ({e})')
    if not loaded:
        raise SystemExit(json.dumps({'ok': False, 'warnings': warnings}, ensure_ascii=False))
    loaded.sort(key=lambda x: -x[0])
    _, src, im, kind = loaded[0]
    if len(loaded) > 1:
        warnings.append('Πολλά αρχεία: διάλεξα το ' + Path(src).name + ' (' + ', '.join(Path(x[1]).name for x in loaded[1:]) + ' όχι).')
    im, bg_note, warn = remove_background(im, keep_holes=keep_holes)
    if warn:
        warnings.append(warn)
    im = trim(im)
    if kind == 'raster' and max(im.size) < MIN_SIDE:
        warnings.append(f'Μικρό λογότυπο ({im.width}×{im.height}): θα φαίνεται θολό. Ζήτα μεγαλύτερο αρχείο ή PDF/SVG.')
    if max(im.size) > TARGET:
        im.thumbnail((TARGET, TARGET), Image.LANCZOS)

    out_dir = Path(out_dir)
    out_dir.mkdir(parents=True, exist_ok=True)
    white, dark = mono(im, (255, 255, 255)), mono(im, DARK_LOGO)
    paths = {'default': out_dir / f'{name}.png', 'white': out_dir / f'{name}_white.png', 'dark': out_dir / f'{name}_dark.png'}
    im.save(paths['default'], optimize=True)
    white.save(paths['white'], optimize=True)
    dark.save(paths['dark'], optimize=True)

    primary = primary or (0, 0, 0)
    light = light or LIGHT_BG
    V = [('default', im), ('dark', dark), ('white', white)]
    rec = {'default': pick(V, light), 'on_primary': pick([('default', im), ('white', white), ('dark', dark)], primary)}
    if rec['default'] != 'default':
        warnings.append('Το λογότυπο είναι ανοιχτόχρωμο: στα ανοιχτά φόντα προτείνεται η σκούρα παραλλαγή.')

    # Δείγμα: ανοιχτό φόντο, κύριο χρώμα, σκούρο φόντο.
    W, H = 600, 320
    prev = Image.new('RGB', (W * 3, H), light)
    for i, (bgc, var) in enumerate([(light, rec['default']), (primary, rec['on_primary']), (DARK_BG, 'white')]):
        tile = Image.new('RGBA', (W, H), bgc + (255,))
        lg = {'default': im, 'white': white, 'dark': dark}[var].copy()
        lg.thumbnail((int(W * 0.7), int(H * 0.6)), Image.LANCZOS)
        tile.alpha_composite(lg, ((W - lg.width) // 2, (H - lg.height) // 2))
        prev.paste(tile.convert('RGB'), (i * W, 0))
    paths['preview'] = out_dir / f'{name}_preview.png'
    prev.save(paths['preview'])

    rel = {k: f'logos/{Path(v).name}' for k, v in paths.items()}
    return {'ok': True, 'source': Path(src).name, 'kind': kind, 'size': list(im.size), 'background': bg_note,
            'files': {k: str(v) for k, v in paths.items()}, 'warnings': warnings, 'colors': colors(im),
            'logos': {'default': rel[rec['default']], 'on_primary': rel[rec['on_primary']]},
            'visibility': {'light': round(visibility({'default': im, 'white': white, 'dark': dark}[rec['default']], light), 2),
                           'primary': round(visibility({'default': im, 'white': white, 'dark': dark}[rec['on_primary']], primary), 2)}}


def main(argv=None):
    ap = argparse.ArgumentParser(description='Λογότυπο πελάτη → διάφανα PNG για τα posts.')
    ap.add_argument('files', nargs='+')
    ap.add_argument('--client', help='κωδικός πελάτη K (για χρώματα brand και φάκελο logos)')
    ap.add_argument('--name', default='logo')
    ap.add_argument('--primary', help='κύριο χρώμα #HEX (αλλιώς από το config)')
    ap.add_argument('--out', help='φάκελος εξόδου (αλλιώς clients/<K>/logos)')
    ap.add_argument('--keep-holes', action='store_true', help='διάφανο μόνο το φόντο γύρω-γύρω (όχι μέσα στο λογότυπο)')
    a = ap.parse_args(argv)
    if not a.out and not a.client:
        ap.error('δώσε --client ή --out')
    out = Path(a.out) if a.out else WORK / 'clients' / a.client / 'logos'
    primary = hex2rgb(a.primary) if a.primary else (brand_color(a.client, 'primary') if a.client else None)
    light = brand_color(a.client, 'cream') if a.client else None
    res = prepare(a.files, out, name=a.name, primary=primary, light=light, keep_holes=a.keep_holes)
    print(json.dumps(res, ensure_ascii=False, indent=1))


if __name__ == '__main__':
    main()
