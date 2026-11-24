"""Πρότυπα γραφικών (posts 1080×1350, stories 1080×1920) με Playwright, με το brand του πελάτη.

Πελάτης: μεταβλητή OKP_CLIENT (π.χ. ORE) πριν το import. Χρώματα, γραμματοσειρές, λογότυπα και τηλέφωνα CTA έρχονται από
το okpublisher/publisher-work (clients/<K>/config.json + groups/<ομάδα>/group.json, βλ. client.py).
Ρόλοι χρωμάτων: primary (φόντο/έμφαση, π.χ. κίτρινο), accent (ετικέτες, αριθμοί, π.χ. ροζ), dark (τίτλοι, π.χ. μπλε), text.
Τα πρότυπα κρατούν και τα παλιά ονόματα ls_* (οι παλιές παρτίδες τα χρησιμοποιούν)· τα νέα ονόματα είναι χωρίς πρόθεμα.
Κείμενα: [br] αλλαγή γραμμής, [b]..[/b] έντονα, [p]..[/p] ροζ, [y]..[/y] κίτρινη υπογράμμιση.
Φωτογραφίες: από τον φάκελο assets/ (ΜΟΝΟ αρχεία που πέρασαν τον έλεγχο απορρήτου: privacy_check.py).
"""
import os, sys, html
from pathlib import Path

sys.path.insert(0, os.path.dirname(os.path.abspath(__file__)))
import client as _client  # noqa: E402

ROOT = Path(os.environ.get('OKP_STUDIO') or os.environ.get('LS_ROOT') or Path(__file__).resolve().parent)
A = ROOT / 'assets'
F = ROOT / 'fonts/node_modules/@fontsource'

CLIENT = _client.load()
Y, P, B, INK = CLIENT.color('primary'), CLIENT.color('accent'), CLIENT.color('dark'), CLIENT.color('text')
CREAM, PT, YT, BT = CLIENT.color('cream'), CLIENT.color('accent_light'), CLIENT.color('primary_light'), CLIENT.color('dark_light')
PHONES = CLIENT.phones            # CTA: [(ετικέτα, αριθμός)] από το config.json του πελάτη
LANG = CLIENT.language
POST, STORY = (1080, 1350), (1080, 1920)


def rgba(hexcolor, alpha):
    h = hexcolor.lstrip('#')
    return f"rgba({int(h[0:2], 16)},{int(h[2:4], 16)},{int(h[4:6], 16)},{alpha})"


def ff(family, folder, weight, style='normal', subsets=('greek', 'latin', 'latin-ext')):
    out = []
    for s in subsets:
        p = F / folder / 'files' / f'{folder}-{s}-{weight}-{style}.woff2'
        if p.exists():
            out.append(f"@font-face{{font-family:'{family}';src:url('file://{p}') format('woff2');font-weight:{weight};font-style:{style};}}")
    return '\n'.join(out)


# RND = γραμματοσειρά τίτλων, MR = γραμματοσειρά κειμένου (πακέτα @fontsource στο fonts/package.json).
_T, _X = _client.fontsource_id(CLIENT.font('titles')), _client.fontsource_id(CLIENT.font('text'))
FONTS = '\n'.join([ff('RND', _T, w) for w in (500, 700, 800)] + [ff('MR', _X, w) for w in (400, 500, 600, 700)])


def e(t):
    t = html.escape(t or '')
    for a, b in [('[br]', '<br>'), ('[b]', '<b>'), ('[/b]', '</b>'), ('[p]', '<span class="pk">'), ('[/p]', '</span>'),
                 ('[y]', '<span class="hl">'), ('[/y]', '</span>')]:
        t = t.replace(a, b)
    return t


def img(name):
    p = Path(name)
    return f"file://{p if p.is_absolute() else A / name}"


def logo(variant='default'):
    """variant: 'default' (σε ανοιχτό φόντο), 'on_primary' (σε φόντο primary), 'banner' ή όνομα αρχείου."""
    return f"file://{CLIENT.logo(variant)}"


CSS = """
*{margin:0;padding:0;box-sizing:border-box}
body{width:__W__px;height:__H__px;background:__BG__;color:__INK__;font-family:'MR';overflow:hidden;position:relative}
.h{font-family:'RND';font-weight:800;line-height:1.08;color:__B__;letter-spacing:-.5px}
.pk{color:__P__}
.hl{background:linear-gradient(180deg,transparent 58%,__Y__ 58%,__Y__ 92%,transparent 92%)}
.tag{display:inline-block;font-family:'RND';font-weight:700;font-size:30px;color:#fff;background:__P__;border-radius:999px;padding:12px 30px 14px}
.body{font-size:42px;line-height:1.42;color:__INK__;font-weight:500}
.body b{font-weight:700;color:__B__}
.bar{width:96px;height:12px;border-radius:6px;background:__P__}
.photo{position:absolute;background-size:cover;background-position:__POS__;border-radius:44px;overflow:hidden}
.dots{position:absolute;border-radius:50%}
.count{position:absolute;top:66px;right:74px;font-family:'RND';font-weight:700;font-size:30px;color:__B__;opacity:.75}
.mail{display:inline-block;font-family:'RND';font-weight:700;font-size:38px;color:__B__;background:#fff;border-radius:999px;padding:18px 38px 20px}
.tel{display:block;width:fit-content;font-family:'RND';font-weight:800;font-size:44px;color:__B__;background:#fff;border-radius:999px;padding:16px 40px 18px;margin-top:22px}
.tel span{font-weight:700;font-size:30px;color:__P__;margin-right:16px}
"""


def brandify(t):
    """Τα πρότυπα γράφουν τα χρώματα ως __Y__ (primary), __P__ (accent), __B__ (dark), __INK__ (text)."""
    for k, v in (('__BSHADOW__', rgba(B, '.12')), ('__INK__', INK), ('__B__', B), ('__P__', P), ('__Y__', Y)):
        t = t.replace(k, v)
    return t


def page(w, h, inner, bg=Y, pos='center'):
    css = CSS.replace('__W__', str(w)).replace('__H__', str(h)).replace('__BG__', bg).replace('__POS__', pos)
    return brandify(f"<!doctype html><html lang='{LANG}'><head><meta charset='utf-8'><style>{FONTS}"
                    f"{css}</style></head><body>{inner}</body></html>")


def deco(w, h, seed=0):
    """Διακριτικοί κύκλοι στις γωνίες (όπως το ροζ «L&S» του λογότυπου)."""
    s = [(-90, -110, 300, P, .10), (w - 170, h - 230, 380, B, .08), (w - 120, 120, 90, P, .9)]
    if seed % 2:
        s = [(w - 210, -120, 330, P, .10), (-140, h - 260, 400, B, .08), (70, 160, 70, P, .9)]
    return ''.join(f"<div class='dots' style='left:{x}px;top:{y}px;width:{d}px;height:{d}px;background:{c};opacity:{o}'></div>"
                   for x, y, d, c, o in s)


def logo_tag(x, y, height, variant='default', anchor='left'):
    side = f'left:{x}px' if anchor == 'left' else f'right:{x}px'
    return f"<img src='{logo(variant)}' style='position:absolute;{side};top:{y}px;height:{height}px'>"


# ---------------------------------------------------------------- posts 1080×1350
def ls_cover(photo, title, tag=None, sub=None, pos='center', swipe=True, size=POST, title_px=82):
    """Φωτογραφία πάνω σε στρογγυλεμένη κάρτα, τίτλος από κάτω. Για πρώτη εικόνα carousel ή απλό post."""
    w, h = size
    ph = 760 if h == 1350 else 1060
    inner = f"""<div class='photo' style="left:48px;right:48px;top:48px;height:{ph}px;background-image:url('{img(photo)}')"></div>
    {logo_tag(70, 70, 120, 'on_primary')}
    <div style='position:absolute;left:76px;right:76px;top:{ph + 86}px'>
      {f"<div class='tag' style='margin-bottom:22px'>{e(tag)}</div>" if tag else ''}
      <div class='h' style='font-size:{title_px}px'>{e(title)}</div>
      {f"<div class='body' style='margin-top:18px;font-size:38px'>{e(sub)}</div>" if sub else ''}
      {"<div style='margin-top:26px;font-family:RND;font-weight:700;font-size:30px;color:__P__'>Σύρετε για περισσότερα →</div>" if swipe else ''}
    </div>"""
    return page(w, h, inner, Y, pos)


def ls_text(title, body, tag=None, size=POST, title_px=88, bg=Y, seed=0, count=None):
    """Τίτλος + κείμενο, χωρίς φωτογραφία (συμβουλές για γονείς, ενημερώσεις)."""
    w, h = size
    top = 250 if h == 1350 else 520
    inner = f"""{deco(w, h, seed)}{f"<div class='count'>{e(count)}</div>" if count else ''}
    <div style='position:absolute;left:84px;right:84px;top:{top}px'>
      {f"<div class='tag' style='margin-bottom:34px'>{e(tag)}</div>" if tag else ''}
      <div class='h' style='font-size:{title_px}px'>{e(title)}</div>
      <div class='bar' style='margin:44px 0 40px'></div>
      <div class='body' style='font-size:{50 if h == 1920 else 42}px'>{e(body)}</div>
    </div>
    {logo_tag(70, h - (200 if h == 1350 else 430), 130, 'on_primary' if bg == Y else 'default', 'right')}"""
    return page(w, h, inner, bg)


def ls_point(num, total, title, body, size=POST, bg=CREAM, seed=0):
    """Μία σελίδα carousel με αριθμό (π.χ. «3 σημάδια ότι…»)."""
    w, h = size
    inner = f"""{deco(w, h, seed)}<div class='count'>{num} / {total}</div>
    <div style='position:absolute;left:84px;right:84px;top:240px'>
      <div style='width:170px;height:170px;border-radius:50%;background:__P__;color:#fff;font-family:RND;font-weight:800;font-size:100px;display:flex;align-items:center;justify-content:center'>{num}</div>
      <div class='h' style='font-size:76px;margin-top:56px'>{e(title)}</div>
      <div class='bar' style='margin:40px 0 36px'></div>
      <div class='body'>{e(body)}</div>
    </div>
    {logo_tag(70, h - 200, 120, 'default', 'right')}"""
    return page(w, h, inner, bg)


def ls_list(title, items, tag=None, size=POST, bg=CREAM, seed=1, start=1):
    w, h = size
    rows = ''.join(
        f"<div style='display:flex;gap:30px;margin-bottom:38px;align-items:flex-start'>"
        f"<div style='min-width:74px;height:74px;border-radius:50%;background:__P__;color:#fff;font-family:RND;font-weight:800;font-size:42px;display:flex;align-items:center;justify-content:center'>{i}</div>"
        f"<div class='body' style='font-size:40px;padding-top:6px'>{e(t)}</div></div>"
        for i, t in enumerate(items, start))
    inner = f"""{deco(w, h, seed)}
    <div style='position:absolute;left:84px;right:84px;top:{190 if h == 1350 else 420}px'>
      {f"<div class='tag' style='margin-bottom:30px'>{e(tag)}</div>" if tag else ''}
      <div class='h' style='font-size:74px;margin-bottom:56px'>{e(title)}</div>
      {rows}
    </div>
    {logo_tag(70, h - (190 if h == 1350 else 420), 115, 'default', 'right')}"""
    return page(w, h, inner, bg)


def ls_quote(quote, who, label='Κριτική Google', size=POST, seed=0):
    """Κριτική γονιού: αυτούσια, χωρίς ονόματα παιδιών, ο γονιός μόνο με αρχικά."""
    w, h = size
    big = h == 1920
    fs = 60 if big else (44 if len(quote) > 220 else 50 if len(quote) > 130 else 58)
    inner = f"""{deco(w, h, seed)}
    <div style='position:absolute;left:70px;right:70px;top:{230 if not big else 470}px;background:#fff;border-radius:48px;padding:70px 66px 62px;box-shadow:0 18px 50px __BSHADOW__'>
      <div style='color:__P__;font-size:52px;letter-spacing:10px'>★★★★★</div>
      <div style='font-family:RND;font-weight:800;color:__Y__;font-size:220px;line-height:.6;height:96px;margin-top:26px'>“</div>
      <div style='font-family:MR;font-weight:600;font-size:{fs}px;line-height:1.38;color:__B__'>{e(quote)}</div>
      <div class='bar' style='margin:44px 0 24px'></div>
      <div style='font-family:RND;font-weight:700;font-size:34px;color:__INK__'>{e(who)} · <span style='color:__P__'>{e(label)}</span></div>
    </div>
    {logo_tag(70, h - (200 if not big else 430), 125, 'on_primary', 'right')}"""
    return page(w, h, inner, Y)


def ls_cta(title, body, size=POST):
    """Κλείσιμο carousel / story: ραντεβού αξιολόγησης με τηλέφωνο (σταθερό + κινητό)."""
    w, h = size
    big = h == 1920
    inner = f"""<div class='dots' style='left:-120px;top:-140px;width:420px;height:420px;background:#fff;opacity:.10'></div>
    <div class='dots' style='right:-160px;bottom:-160px;width:520px;height:520px;background:__Y__;opacity:.22'></div>
    <div style='position:absolute;left:84px;right:84px;top:{200 if not big else 470}px;color:#fff'>
      <div style='font-family:RND;font-weight:800;font-size:{86 if not big else 104}px;line-height:1.08'>{e(title)}</div>
      <div style='width:96px;height:12px;border-radius:6px;background:__Y__;margin:46px 0 40px'></div>
      <div style='font-size:{42 if not big else 50}px;line-height:1.42;font-weight:500'>{e(body)}</div>
      <div style='margin-top:40px'>{''.join(f"<div class='tel'><span>{k}</span>{v}</div>" for k, v in PHONES)}</div>
    </div>
    <div style='position:absolute;left:84px;bottom:{80 if not big else 330}px;background:__Y__;border-radius:34px;padding:20px 30px'>
      <img src='{logo('on_primary')}' style='height:{150 if not big else 170}px;display:block'></div>"""
    return page(w, h, inner, P)


# ---------------------------------------------------------------- stories 1080×1920
def ls_story_photo(photo, title, body=None, tag=None, pos='center'):
    """Φωτογραφία σε όλη την οθόνη, κίτρινη κάρτα κειμένου κάτω (εκτός ζώνης κουμπιών του Instagram)."""
    inner = f"""<div class='photo' style="inset:0;border-radius:0;background-image:url('{img(photo)}')"></div>
    <div style='position:absolute;left:0;right:0;top:0;height:420px;background:linear-gradient(180deg,rgba(0,0,0,.28),rgba(0,0,0,0))'></div>
    <div style='position:absolute;left:60px;top:200px;background:__Y__;border-radius:30px;padding:14px 22px'>
      <img src='{logo('on_primary')}' style='height:120px;display:block'></div>
    <div style='position:absolute;left:60px;right:60px;bottom:300px;background:__Y__;border-radius:44px;padding:54px 56px 58px'>
      {f"<div class='tag' style='margin-bottom:26px'>{e(tag)}</div>" if tag else ''}
      <div class='h' style='font-size:76px'>{e(title)}</div>
      {f"<div class='body' style='margin-top:22px;font-size:42px'>{e(body)}</div>" if body else ''}
    </div>"""
    return page(1080, 1920, inner, Y, pos)


def ls_story_text(title, body, tag=None, bg=Y, seed=0):
    return ls_text(title, body, tag=tag, size=STORY, title_px=100, bg=bg, seed=seed)


# ---------------------------------------------------------------- νέα ονόματα (χωρίς πρόθεμα πελάτη)
cover, text, point, list_card, quote, cta, story_photo, story_text = (
    ls_cover, ls_text, ls_point, ls_list, ls_quote, ls_cta, ls_story_photo, ls_story_text)


# ---------------------------------------------------------------- render
def render_all(jobs, outdir):
    """jobs: λίστα από (όνομα αρχείου χωρίς κατάληξη, html, (w, h)). Γράφει <όνομα>.jpg στο outdir."""
    from playwright.sync_api import sync_playwright
    os.makedirs(outdir, exist_ok=True)
    with sync_playwright() as p:
        try:
            b = p.chromium.launch()
        except Exception:
            b = p.chromium.launch(executable_path='/usr/bin/google-chrome')
        pg = b.new_page(device_scale_factor=1)
        for name, doc, (w, h) in jobs:
            hp = (Path(outdir) / (name + '.html')).resolve()
            hp.parent.mkdir(parents=True, exist_ok=True)
            hp.write_text(doc, encoding='utf-8')
            pg.set_viewport_size({'width': w, 'height': h})
            pg.goto(f'file://{hp}')
            pg.evaluate('document.fonts.ready')
            pg.wait_for_timeout(150)
            out = Path(outdir) / (name + '.jpg')
            pg.screenshot(path=str(out), type='jpeg', quality=93, clip={'x': 0, 'y': 0, 'width': w, 'height': h})
            hp.unlink()
        b.close()
