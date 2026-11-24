#!/usr/bin/env python3
"""Προεπισκόπηση για έγκριση από τον πελάτη: PDF που διαβάζεται άνετα στο κινητό (σελίδα 9:16, μία ανάρτηση ανά σελίδα).

    python3 build_approval_pdf.py <παρτίδα> <φάκελος εξόδου> "<Μήνας ΕΕΕΕ>" [--reels-link URL] [--round N] [--changes "…"]
                                  [--client K]   (ή OKP_CLIENT=K· χρώματα, λογότυπο, όνομα και ώρες από τις ρυθμίσεις του)

Βγάζει:
  1_Posts_και_Reels.pdf   κάθε post/carousel/reel με αριθμό (#1, #2…), ημέρα, ώρα και ΟΛΗ τη λεζάντα
  2_Stories.pdf           όλα τα stories (πλέγμα 2×2 ανά σελίδα), με αριθμό
  reels/<ημ/νία>_reel_preview.mp4   ελαφριά αντίγραφα των reels για το Drive (≤ 2,8 MB το καθένα)
Κάθε PDF μένει ≤ 2,8 MB (όριο ανεβάσματος/συνημμένου από εδώ): η ποιότητα των εικόνων προσαρμόζεται μόνη της.
Οι αριθμοί (#N) είναι σταθεροί για όλο τον μήνα, ώστε η υπεύθυνη να γράφει π.χ. «στο #7 άλλαξε…».
"""
import argparse, glob, io, json, os, subprocess, sys
from datetime import date

from PIL import Image
from reportlab.lib.colors import HexColor, white
from reportlab.lib.styles import ParagraphStyle
from reportlab.lib.utils import ImageReader
from reportlab.pdfbase import pdfmetrics
from reportlab.pdfbase.ttfonts import TTFont
from reportlab.pdfgen import canvas
from reportlab.platypus import Paragraph

sys.path.insert(0, os.path.dirname(os.path.abspath(__file__)))
import client as clientlib  # noqa: E402

DJ = '/usr/share/fonts/truetype/dejavu/'
pdfmetrics.registerFont(TTFont('S', DJ + 'DejaVuSans.ttf'))
pdfmetrics.registerFont(TTFont('SB', DJ + 'DejaVuSans-Bold.ttf'))
MUTED = HexColor('#5C6670')
CL = None                            # ο πελάτης (ορίζεται στο main / use())
Y = P = B = INK = None
W, H = 360, 640                      # 9:16, γεμίζει την οθόνη του κινητού
M = 18
DAYS = ['Δευτέρα', 'Τρίτη', 'Τετάρτη', 'Πέμπτη', 'Παρασκευή', 'Σάββατο', 'Κυριακή']
LIMIT = int(2.8 * 1024 * 1024)
ACC = None
POST_TIME = STORY_TIME = None


def use(cl):
    """Ορίζει πελάτη: χρώματα, ώρες, όνομα, λογότυπο."""
    global CL, Y, P, B, INK, POST_TIME, STORY_TIME
    CL = cl
    Y, P, B, INK = (HexColor(cl.color(r)) for r in ('primary', 'accent', 'dark', 'text'))
    POST_TIME, STORY_TIME = cl.post_time, cl.story_time
    globals()['cap_style'] = ParagraphStyle('c', fontName='S', fontSize=9.4, leading=12.6, textColor=INK)
cap_style = None
EMOJI_FONT = '/usr/share/fonts/truetype/noto/NotoColorEmoji.ttf'
EMOJI_DIR = os.path.join(os.environ.get('TMPDIR', '/tmp'), 'okp_emoji')


def is_emoji_cp(o):
    return o >= 0x1F000 or 0x2600 <= o <= 0x27BF or 0x2B00 <= o <= 0x2BFF or o in (0x203C, 0x2049, 0x2122, 0x2139, 0x3030, 0x303D)


def emoji_runs(t):
    """Χωρίζει το κείμενο σε κομμάτια (κείμενο, False) / (emoji, True), με ZWJ, VS16, απόχρωση δέρματος, keycap."""
    out, i, n = [], 0, len(t)
    while i < n:
        o = ord(t[i])
        keycap = t[i] in '0123456789#*' and i + 1 < n and t[i + 1] in '\ufe0f\u20e3' and '\u20e3' in t[i + 1:i + 3]
        if is_emoji_cp(o) or keycap:
            j = i + 1
            while j < n:
                c = ord(t[j])
                if c in (0xFE0F, 0x20E3) or 0x1F3FB <= c <= 0x1F3FF or 0xE0020 <= c <= 0xE007F:
                    j += 1
                elif c == 0x200D and j + 1 < n:
                    j += 2
                elif 0x1F1E6 <= o <= 0x1F1FF and 0x1F1E6 <= c <= 0x1F1FF and j == i + 1:
                    j += 1
                else:
                    break
            out.append((t[i:j], True)); i = j
        else:
            j = i
            while j < n and not is_emoji_cp(ord(t[j])) and not (t[j] in '0123456789#*' and '\u20e3' in t[j + 1:j + 3]):
                j += 1
            j = max(j, i + 1)
            out.append((t[i:j], False)); i = j
    return out


def emoji_png(e):
    """Έγχρωμο emoji ως PNG (η γραμματοσειρά του PDF δεν έχει emoji)."""
    from PIL import ImageDraw, ImageFont
    os.makedirs(EMOJI_DIR, exist_ok=True)
    path = os.path.join(EMOJI_DIR, '-'.join(f'{ord(c):x}' for c in e) + '.png')
    if not os.path.exists(path):
        im = Image.new('RGBA', (136, 128), (0, 0, 0, 0))
        try:
            ImageDraw.Draw(im).text((0, 0), e, font=ImageFont.truetype(EMOJI_FONT, 109), embedded_color=True)
            bb = im.getbbox()
            im = im.crop(bb) if bb else im
        except Exception:
            pass
        im.save(path)
    return path


def dlabel(d):
    x = date.fromisoformat(d)
    return f'{DAYS[x.weekday()]} {x.day}/{x.month}'


def esc(t):
    out = []
    for part, emo in emoji_runs(t):
        if emo:
            if part.strip('\ufe0f'):
                out.append(f'<img src="{emoji_png(part)}" width="11" height="11" valign="-2"/>')
        else:
            out.append(part.replace('&', '&amp;').replace('<', '&lt;').replace('>', '&gt;'))
    return ''.join(out).replace('\n', '<br/>')


def jpeg(path, maxw, q):
    im = Image.open(path).convert('RGB')
    im.thumbnail((maxw, maxw * 2))
    b = io.BytesIO()
    im.save(b, 'JPEG', quality=q, optimize=True)
    b.seek(0)
    return ImageReader(b), im.size


def header(c, num, title, sub):
    c.setFillColor(Y); c.rect(0, H - 54, W, 54, stroke=0, fill=1)
    c.setFillColor(P); c.roundRect(M, H - 42, 52, 30, 15, stroke=0, fill=1)
    c.setFillColor(white); c.setFont('SB', 14); c.drawCentredString(M + 26, H - 32, f'#{num}')
    c.setFillColor(B); c.setFont('SB', 13); c.drawString(M + 62, H - 26, title)
    c.setFillColor(INK); c.setFont('S', 9.5)
    while sub and pdfmetrics.stringWidth(sub, 'S', 9.5) > W - M - 62 - 8:
        sub = sub[:-2].rstrip() + '…' if not sub.endswith('…') else sub[:-2] + '…'
    c.drawString(M + 62, H - 40, sub)


def caption_height(text):
    return sum(Paragraph(esc(x) or '&nbsp;', cap_style).wrap(W - 2 * M, H)[1] + 1 for x in text.split('\n')) + 16


def caption(c, text, y_top, num, cont_title):
    """Λεζάντα από y_top προς τα κάτω· αν δεν χωράει, συνεχίζει σε επόμενη σελίδα."""
    paras = [Paragraph(esc(x) or '&nbsp;', cap_style) for x in text.split('\n')]
    c.setFillColor(B); c.setFont('SB', 10); c.drawString(M, y_top - 4, 'Λεζάντα')
    y = y_top - 12
    for p in paras:
        w, h = p.wrap(W - 2 * M, H)
        if y - h < M:
            c.showPage(); header(c, num, cont_title, '(συνέχεια λεζάντας)'); y = H - 70
        p.drawOn(c, M, y - h)
        y -= h + 1
    return y


def build_posts(items, out, month, reels_link, q, round_no, changes):
    c = canvas.Canvas(out, pagesize=(W, H))
    c.setTitle(f'{CL.name} — {month} — Posts & Reels')
    cover(c, month, 'Posts & Reels', len(items), reels_link, round_no, changes)
    for it in items:
        c.showPage()
        title = f'{dlabel(it["date"])} · {POST_TIME}'
        if it['kind'] == 'reel':
            sub = f'Reel · {it.get("dur", "")}″ · μουσική: {it.get("music", "—")}'
        else:
            n = len(it['images'])
            sub = 'Post · 1 εικόνα' if n == 1 else f'Carousel · {n} εικόνες (σύρσιμο)'
        header(c, it['num'], title, sub)
        top = H - 66
        room = top - M - caption_height(it['caption']) - 18   # ύψος που μένει για εικόνα/ες
        maxh = max(190, min(330, room))
        if it['kind'] == 'reel':
            ir, (iw, ih) = jpeg(it['cover'], 540, q)
            hh = max(190, min(300, room - 28)); ww = hh * iw / ih
            c.drawImage(ir, (W - ww) / 2, top - hh, ww, hh)
            c.setFillColor(P); c.circle(W / 2, top - hh / 2, 26, stroke=0, fill=1)
            c.setFillColor(white); c.setFont('SB', 22); c.drawCentredString(W / 2 + 2, top - hh / 2 - 8, '▶')
            y = top - hh - 14
            c.setFillColor(B); c.setFont('SB', 9.5)
            c.drawCentredString(W / 2, y, 'Το βίντεο: στον φάκελο Drive (link στο email)')
            if reels_link:
                c.linkURL(reels_link, (M, y - 4, W - M, y + 10))
            y -= 14
        else:
            imgs = it['images']
            if len(imgs) == 1:
                ir, (iw, ih) = jpeg(imgs[0], 720, q)
                ww = W - 2 * M; hh = ww * ih / iw
                if hh > maxh:
                    hh = maxh; ww = hh * iw / ih
                c.drawImage(ir, (W - ww) / 2, top - hh, ww, hh); y = top - hh - 12
            else:
                cols = 2 if len(imgs) <= 4 else 3
                rows = (len(imgs) + cols - 1) // cols
                cw = (W - 2 * M - (cols - 1) * 6) / cols
                ih0, iw0 = Image.open(imgs[0]).size[::-1]
                if rows * (cw * ih0 / iw0 + 6) > maxh:          # μικραίνει το πλέγμα για να χωρέσει η λεζάντα
                    cw = max(60, (maxh / rows - 6) * iw0 / ih0)
                y = top
                for k, pth in enumerate(imgs):
                    ir, (iw, ih) = jpeg(pth, 480 if cols == 2 else 360, q)
                    ch = cw * ih / iw
                    x = (W - cols * cw - (cols - 1) * 6) / 2 + (k % cols) * (cw + 6)
                    if k % cols == 0 and k:
                        y -= ch + 6
                    c.drawImage(ir, x, y - ch, cw, ch)
                    c.setFillColor(P); c.circle(x + 10, y - 10, 8, stroke=0, fill=1)
                    c.setFillColor(white); c.setFont('SB', 8); c.drawCentredString(x + 10, y - 13, str(k + 1))
                y -= ch + 12
        caption(c, it['caption'], y - 4, it['num'], title)
    c.save()


def build_stories(stories, out, month, q, round_no, changes):
    c = canvas.Canvas(out, pagesize=(W, H))
    c.setTitle(f'{CL.name} — {month} — Stories')
    cover(c, month, 'Stories', len(stories), None, round_no, changes)
    cw = (W - 2 * M - 10) / 2
    ch = cw * 16 / 9
    for i in range(0, len(stories), 4):
        c.showPage()
        grp = stories[i:i + 4]
        c.setFillColor(Y); c.rect(0, H - 40, W, 40, stroke=0, fill=1)
        c.setFillColor(B); c.setFont('SB', 12)
        c.drawString(M, H - 26, f'Stories #{grp[0]["num"]}–#{grp[-1]["num"]} · κάθε μέρα {STORY_TIME}')
        for k, s in enumerate(grp):
            x = M + (k % 2) * (cw + 10)
            y = H - 52 - (k // 2) * (ch + 34)
            ir, _ = jpeg(s['image'], 400, q)
            c.drawImage(ir, x, y - ch, cw, ch)
            c.setFillColor(P); c.roundRect(x, y - ch - 22, 44, 18, 9, stroke=0, fill=1)
            c.setFillColor(white); c.setFont('SB', 10); c.drawCentredString(x + 22, y - ch - 17, f'#{s["num"]}')
            c.setFillColor(INK); c.setFont('S', 9.5)
            c.drawString(x + 50, y - ch - 17, dlabel(s['date']) + (' · με μουσική' if s.get('video') else ''))
    c.save()


def cover(c, month, what, n, reels_link, round_no, changes):
    c.setFillColor(Y); c.rect(0, 0, W, H, stroke=0, fill=1)
    logo = str(CL.logo('on_primary'))
    if os.path.exists(logo):
        lw, lh = Image.open(logo).size
        c.drawImage(logo, (W - 170) / 2, H - 150, 170, 170 * lh / lw)
    c.setFillColor(B); c.setFont('SB', 20); c.drawCentredString(W / 2, H - 190, f'Πρόγραμμα {month}')
    c.setFillColor(P); c.setFont('SB', 15); c.drawCentredString(W / 2, H - 214, f'{what} · {n}')
    if round_no and round_no > 1:
        c.setFillColor(INK); c.setFont('SB', 11); c.drawCentredString(W / 2, H - 236, f'Ανανεωμένη έκδοση {round_no}')
    y = H - 270
    lines = [
        ('SB', 'Πώς απαντάτε (στο ίδιο email):'),
        ('S', '• Όλα εντάξει: «ΟΚ» ή «εγκρίνεται» ή 👍.'),
        ('S', '• Αλλαγές: γράψτε τον αριθμό και τι θέλετε,'),
        ('S', '  π.χ. «#7: όχι αυτή η φωτογραφία».'),
        ('S', '• Τίποτα δεν δημοσιεύεται πριν την έγκρισή σας.'),
    ]
    if changes:
        lines += [('SB', ''), ('SB', 'Τι άλλαξε σε αυτή την έκδοση:')] + [('S', '• ' + x) for x in changes.split('|')]
    for f, t in lines:
        para = Paragraph(esc(t) or '&nbsp;', ParagraphStyle('l', fontName=f, fontSize=11, leading=14, textColor=INK))
        _, h = para.wrap(W - 2 * M - 8, H)
        para.drawOn(c, M + 8, y - h + 11); y -= h + 4
    if reels_link:
        c.setFillColor(B); c.setFont('SB', 11); c.drawString(M + 8, y - 6, '▶ Τα reels (βίντεο): πατήστε εδώ')
        c.linkURL(reels_link, (M, y - 12, W - M, y + 8))


def collect(batch):
    caps = json.load(open(os.path.join(batch, 'captions.json'), encoding='utf-8'))
    ACC = CL.batch_dir_name(batch)
    cap = lambda d, suffix='': CL.caption(caps, ACC, d, suffix)
    src = os.path.join(batch, ACC)
    days = sorted({os.path.basename(f)[:10] for f in glob.glob(f'{src}/*.jpg') + glob.glob(f'{src}/*.mp4')})
    posts, stories = [], []
    for d in days:
        reel = f'{src}/{d}_reel.mp4'
        imgs = sorted(glob.glob(f'{src}/{d}_post_*.jpg'))
        if os.path.exists(reel):
            dur = float(subprocess.run(['ffprobe', '-v', 'error', '-show_entries', 'format=duration', '-of', 'csv=p=0', reel],
                                       capture_output=True, text=True).stdout or 0)
            m = cap(d, 'reel') or {}
            posts.append({'date': d, 'kind': 'reel', 'video': reel, 'cover': f'{src}/{d}_reel_cover.jpg', 'dur': round(dur),
                          'music': m.get('music', '—'), 'caption': cap(d) or '(λείπει λεζάντα)'})
        elif imgs:
            posts.append({'date': d, 'kind': 'post', 'images': imgs, 'caption': cap(d) or '(λείπει λεζάντα)'})
        for s in sorted(glob.glob(f'{src}/{d}_story_*.jpg')):
            mp4 = s[:-4] + '.mp4'
            stories.append({'date': d, 'image': s, 'video': mp4 if os.path.exists(mp4) else None})
    for i, it in enumerate(posts + stories, 1):
        it['num'] = i
    return posts, stories


def fit(build, out):
    for q in (80, 70, 60, 50, 42, 35):
        build(q)
        if os.path.getsize(out) <= LIMIT:
            return q
    sys.exit(f'{out}: δεν χωράει στα {LIMIT // 1048576} MB ούτε με ποιότητα 35 — χώρισέ το.')


def reel_preview(src, dst):
    for crf in (28, 32, 36):
        subprocess.run(['ffmpeg', '-v', 'error', '-y', '-i', src, '-vf', 'scale=540:960', '-c:v', 'libx264', '-preset', 'veryfast',
                        '-crf', str(crf), '-c:a', 'aac', '-b:a', '96k', '-map_metadata', '-1', '-movflags', '+faststart', dst], check=True)
        if os.path.getsize(dst) <= LIMIT:
            return
    sys.exit(f'{dst}: πάνω από {LIMIT // 1048576} MB')


def main():
    ap = argparse.ArgumentParser()
    ap.add_argument('batch'); ap.add_argument('out'); ap.add_argument('month')
    ap.add_argument('--reels-link'); ap.add_argument('--round', type=int, default=1); ap.add_argument('--changes', default='')
    ap.add_argument('--client')
    a = ap.parse_args()
    use(clientlib.load(a.client))
    os.makedirs(a.out, exist_ok=True)
    posts, stories = collect(a.batch)
    p1, p2 = os.path.join(a.out, '1_Posts_και_Reels.pdf'), os.path.join(a.out, '2_Stories.pdf')
    q1 = fit(lambda q: build_posts(posts, p1, a.month, a.reels_link, q, a.round, a.changes), p1)
    q2 = fit(lambda q: build_stories(stories, p2, a.month, q, a.round, a.changes), p2)
    reels = [p for p in posts if p['kind'] == 'reel']
    if reels:
        os.makedirs(os.path.join(a.out, 'reels'), exist_ok=True)
        for r in reels:
            reel_preview(r['video'], os.path.join(a.out, 'reels', f'{r["num"]:02d}_{r["date"]}_reel.mp4'))
    print(json.dumps({'posts_pdf': p1, 'posts_kb': os.path.getsize(p1) // 1024, 'q_posts': q1,
                      'stories_pdf': p2, 'stories_kb': os.path.getsize(p2) // 1024, 'q_stories': q2,
                      'posts': len(posts), 'stories': len(stories), 'reels': len(reels)}, ensure_ascii=False))


if __name__ == '__main__':
    main()
