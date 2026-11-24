"""Δοκιμές studio χωρίς internet και χωρίς στοιχεία πελατών (φτιάχνουν δικό τους δοκιμαστικό πελάτη TST).

    python3 -m unittest discover -s studio/tests -v
"""
import json, os, shutil, subprocess, sys, tempfile, unittest
from datetime import datetime
from pathlib import Path

HERE = Path(__file__).resolve().parent
STUDIO = HERE.parent
sys.path.insert(0, str(STUDIO))

from PIL import Image  # noqa: E402

FFMPEG = shutil.which('ffmpeg') and shutil.which('ffprobe')


def make_work(root, key='TST', mode='fill_reel_slots_then_posts_then_next_month', aliases=()):
    """Ψεύτικο publisher-work: clients/<K>/config.json + groups/demo/{group.json, logos/}."""
    root = Path(root)
    (root / 'clients' / key).mkdir(parents=True)
    g = root / 'groups' / 'demo'
    (g / 'logos').mkdir(parents=True)
    Image.new('RGBA', (400, 200), (10, 20, 30, 255)).save(g / 'logos' / 'logo.png')
    Image.new('RGB', (400, 200), (250, 240, 0)).save(g / 'logos' / 'logo_on_primary.png')
    (g / 'group.json').write_text(json.dumps({
        'key': 'demo', 'brand': {'colors': {'primary': '#112233', 'accent': '#445566', 'dark': '#778899', 'text': '#000000'},
                                 'fonts': {'titles': 'M PLUS Rounded 1c', 'text': 'Manrope'},
                                 'logos': {'default': 'logos/logo.png', 'on_primary': 'logos/logo_on_primary.png'},
                                 'language': 'el'},
        'banned_phrases': ['απαγορευμ']}), encoding='utf-8')
    (root / 'clients' / key / 'config.json').write_text(json.dumps({
        'key': key, 'name': 'Δοκιμαστικός πελάτης', 'group': 'demo', 'aliases': list(aliases),
        'post_days': ['Δευτέρα', 'Τετάρτη', 'Παρασκευή', 'Κυριακή'], 'post_time': '21:00', 'story_time': '09:30',
        'cta': {'type': 'phone', 'landline': '210 000 0000', 'mobile': '690 000 0000'},
        'ready_reels_mode': mode}), encoding='utf-8')
    return root


class ClientTest(unittest.TestCase):
    def setUp(self):
        self.tmp = tempfile.mkdtemp()
        make_work(self.tmp, aliases=('OLD',))
        import client
        self.client = client

    def tearDown(self):
        shutil.rmtree(self.tmp)

    def test_load(self):
        c = self.client.load('tst', self.tmp)
        self.assertEqual(c.key, 'TST')
        self.assertEqual(c.accounts, ['TST', 'OLD'])
        self.assertEqual(c.color('primary'), '#112233')
        self.assertEqual(c.color('cream'), '#FFFBEA')                   # προεπιλογή όταν λείπει
        self.assertEqual(c.post_weekdays, {0, 2, 4, 6})
        self.assertEqual((c.post_time, c.story_time), ('21:00', '09:30'))
        self.assertEqual(c.phones, [('Σταθερό', '210 000 0000'), ('Κινητό', '690 000 0000')])
        self.assertTrue(str(c.logo('on_primary')).endswith('logo_on_primary.png'))
        self.assertTrue(str(c.logo('logo.png')).endswith('logo.png'))  # και με όνομα αρχείου
        self.assertEqual(c.banned_phrases, ['απαγορευμ'])

    def test_bad_key_and_missing(self):
        with self.assertRaises(SystemExit):
            self.client.load('x', self.tmp)
        with self.assertRaises(SystemExit):
            self.client.load('NOPE', self.tmp)

    def test_batch_dir_and_captions(self):
        c = self.client.load('TST', self.tmp)
        b = Path(self.tmp) / 'batch'
        (b / 'OLD').mkdir(parents=True)
        self.assertEqual(c.batch_dir_name(b), 'OLD')                   # παλιά παρτίδα με alias
        (b / 'TST').mkdir()
        self.assertEqual(c.batch_dir_name(b), 'TST')
        caps = {'OLD|2027-01-04': 'α', 'TST|2027-01-06|reel': {'story': False}}
        self.assertEqual(c.caption(caps, 'TST', '2027-01-04'), 'α')
        self.assertEqual(c.caption(caps, 'TST', '2027-01-06', 'reel'), {'story': False})
        self.assertEqual(self.client.fontsource_id('M PLUS Rounded 1c'), 'm-plus-rounded-1c')


class EngineTest(unittest.TestCase):
    """Το engine διαβάζει τον πελάτη στο import: τρέχει σε ξεχωριστή διεργασία."""

    def test_brand_in_html(self):
        tmp = tempfile.mkdtemp()
        try:
            make_work(tmp)
            code = ("import engine as e\n"
                    "d = e.cta('Τίτλος', 'Κείμενο') + e.quote('Πολύ καλό', 'Α.Β.') + e.cover('x.jpg', 'Τίτλος')\n"
                    "assert '#445566' in d and '#112233' in d and '#778899' in d, 'χρώματα'\n"
                    "assert 'rgba(119,136,153,.12)' in d, 'σκιά'\n"
                    "assert '210\\u00a0000\\u00a00000' in d, 'τηλέφωνο'\n"
                    "assert 'logo_on_primary.png' in d, 'λογότυπο'\n"
                    "assert '__' not in d.replace('__W__', ''), 'ξεχασμένο σημάδι χρώματος'\n"
                    "assert e.ls_cta is e.cta\n"
                    "print('ok')\n")
            env = dict(os.environ, OKP_CLIENT='TST', OKP_WORK=tmp)
            r = subprocess.run([sys.executable, '-c', code], cwd=STUDIO, env=env, capture_output=True, text=True)
            self.assertEqual(r.returncode, 0, r.stderr)
        finally:
            shutil.rmtree(tmp)


class MakeQueueTest(unittest.TestCase):
    def setUp(self):
        self.tmp = Path(tempfile.mkdtemp())
        make_work(self.tmp / 'work', aliases=('OLD',))
        import client, make_queue, privacy_check
        self.mq, self.pc = make_queue, privacy_check
        self.cl = client.load('TST', self.tmp / 'work')
        self.batch = self.tmp / 'batch'
        d = self.batch / 'TST'
        d.mkdir(parents=True)
        for n in ('2027-01-04_post_01.jpg', '2027-01-04_post_02.jpg', '2027-01-05_story_01.jpg', '2027-03-29_post_01.jpg'):
            Image.new('RGB', (108, 135), (200, 100, 50)).save(d / n, 'JPEG')
        (self.batch / 'captions.json').write_text(json.dumps({
            'TST|2027-01-04': 'Καλημέρα #a #b', 'TST|2027-03-29': 'Άνοιξη'}), encoding='utf-8')
        self.mark_all()
        self.repo = self.tmp / 'repo'
        self.repo.mkdir()

    def mark_all(self):
        files = {}
        for p in (self.batch / 'TST').iterdir():
            files[f'TST/{p.name}'] = {'sha256': self.pc.sha256(p), 'reviewed': True, 'status': 'ok', 'metadata': []}
        (self.batch / 'privacy_manifest.json').write_text(json.dumps({'files': files}), encoding='utf-8')

    def tearDown(self):
        shutil.rmtree(self.tmp)

    def test_build(self):
        now = datetime.fromisoformat('2027-01-01T12:00:00+02:00')
        items = self.mq.build(str(self.batch), str(self.repo), self.cl, now=now)
        by = {i['id']: i for i in items}
        self.assertEqual(set(by), {'TST-2027-01-04-post', 'TST-2027-01-05-story', 'TST-2027-03-29-post'})
        self.assertEqual(by['TST-2027-01-04-post']['type'], 'CAROUSEL')
        self.assertEqual(by['TST-2027-01-04-post']['publish_at'], '2027-01-04T21:00:00+02:00')
        self.assertEqual(by['TST-2027-01-05-story']['publish_at'], '2027-01-05T09:30:00+02:00')
        self.assertEqual(by['TST-2027-03-29-post']['publish_at'], '2027-03-29T21:00:00+03:00')   # θερινή ώρα
        self.assertTrue(by['TST-2027-01-04-post']['images'][0].startswith(
            'https://raw.githubusercontent.com/okpublisher/publisher/main/media/2027-01/TST/'))
        self.assertTrue((self.repo / 'media/2027-01/TST/2027-01-04_post_02.jpg').exists())
        self.assertEqual({i['account'] for i in items}, {'TST'})

    def test_refuses_unchecked_file(self):
        Image.new('RGB', (108, 135), (0, 0, 0)).save(self.batch / 'TST' / '2027-01-06_post_01.jpg', 'JPEG')
        with self.assertRaises(SystemExit):
            self.mq.build(str(self.batch), str(self.repo), self.cl, now=datetime.fromisoformat('2027-01-01T12:00:00+02:00'))

    def test_banned_phrase(self):
        (self.batch / 'captions.json').write_text(json.dumps({'TST|2027-01-04': 'Είμαστε απαγορευμένοι', 'TST|2027-03-29': 'x'}),
                                                  encoding='utf-8')
        with self.assertRaises(AssertionError):
            self.mq.build(str(self.batch), str(self.repo), self.cl, now=datetime.fromisoformat('2027-01-01T12:00:00+02:00'))

    def test_late_items_skipped(self):
        items = self.mq.build(str(self.batch), str(self.repo), self.cl, now=datetime.fromisoformat('2027-01-05T09:20:00+02:00'))
        self.assertEqual([i['id'] for i in items], ['TST-2027-03-29-post'])

    def test_clash_guard(self):
        existing = [{'id': 'OLD-2027-01-04-post', 'account': 'OLD', 'type': 'IMAGE', 'publish_at': '2027-01-04T21:00:00+02:00'},
                    {'id': 'XYZ-2027-01-04-post', 'account': 'XYZ', 'type': 'IMAGE', 'publish_at': '2027-01-04T21:00:00+02:00'}]
        new = [{'id': 'TST-2027-01-04-post', 'account': 'TST', 'type': 'REEL', 'publish_at': '2027-01-04T21:00:00+02:00'}]
        self.assertEqual(self.mq.clashes(existing, new, set(self.cl.accounts)), [('TST-2027-01-04-post', 'OLD-2027-01-04-post')])
        with self.assertRaises(SystemExit):
            self.mq.merge({'items': existing}, new, set(self.cl.accounts))
        # ίδιο ID = αντικατάσταση (διόρθωση), όχι σύγκρουση· άλλος πελάτης στην ίδια ώρα = εντάξει
        q = self.mq.merge({'items': existing[1:] + new}, [dict(new[0], caption='νέα')], set(self.cl.accounts))
        self.assertEqual(len(q['items']), 2)


class ReadyReelsPlaceTest(unittest.TestCase):
    def setUp(self):
        import ready_reels
        self.rr = ready_reels
        self.post = {0, 2, 4, 6}          # Δευ, Τετ, Παρ, Κυρ
        # Ιανουάριος 2027: Παρ 1, Κυρ 3, Δευ 4, Τετ 6 …
        self.our = ['2027-01-06', '2027-01-15']

    def test_fill_reel_slots_then_posts(self):
        r = self.rr.place('2027-01', self.post, self.our, ['b.mp4', 'a.mp4', 'c.mp4'], 'fill_reel_slots_then_posts_then_next_month')
        self.assertEqual(r['assign'], {'2027-01-01': 'c.mp4', '2027-01-06': 'a.mp4', '2027-01-15': 'b.mp4'})
        self.assertEqual(r['replaces'], {'2027-01-01': 'post', '2027-01-06': 'reel', '2027-01-15': 'reel'})
        self.assertEqual(r['next_month'], [])

    def test_overflow_next_month(self):
        names = [f'{i:02d}.mp4' for i in range(20)]
        r = self.rr.place('2027-01', self.post, self.our, names, 'fill_reel_slots_then_posts_then_next_month')
        self.assertEqual(len(r['assign']), 18)                        # 18 ημέρες post τον Ιανουάριο 2027
        self.assertEqual(r['next_month'], ['18.mp4', '19.mp4'])
        self.assertEqual(len(set(r['assign'])), len(r['assign']))     # ποτέ δύο σε μία ημέρα

    def test_all_in_month(self):
        names = [f'{i:02d}.mp4' for i in range(20)]
        r = self.rr.place('2027-01', self.post, self.our, names, 'all_in_month')
        self.assertEqual(len(r['assign']), 20)
        self.assertEqual(r['next_month'], [])
        self.assertIn('extra', r['replaces'].values())

    def test_locked_dates(self):
        names = ['2027-01-07 μάθημα.mp4', '2027-01-07 δεύτερο.mp4', '2027-02-03 φεβ.mp4', 'x.mp4']
        r = self.rr.place('2027-01', self.post, self.our, names, 'fill_reel_slots_then_posts_then_next_month')
        self.assertEqual(r['assign']['2027-01-07'], '2027-01-07 δεύτερο.mp4')   # κλειδωμένο (Πέμπτη: επιπλέον θέση)
        self.assertEqual(r['replaces']['2027-01-07'], 'extra')
        self.assertIn('2027-02-03 φεβ.mp4', r['next_month'])
        self.assertEqual(r['assign']['2027-01-06'], '2027-01-07 μάθημα.mp4')     # σύγκρουση → ελεύθερη θέση reel
        self.assertEqual(r['assign']['2027-01-15'], 'x.mp4')


@unittest.skipUnless(FFMPEG, 'χωρίς ffmpeg')
class ReadyReelsVideoTest(unittest.TestCase):
    def setUp(self):
        import ready_reels
        self.rr = ready_reels
        self.tmp = Path(tempfile.mkdtemp())

    def tearDown(self):
        shutil.rmtree(self.tmp)

    def video(self, name, w, h, sec, fps=30, extra=()):
        p = self.tmp / name
        subprocess.run(['ffmpeg', '-v', 'error', '-y', '-f', 'lavfi', '-i', f'testsrc=size={w}x{h}:rate={fps}:duration={sec}',
                        '-f', 'lavfi', '-i', f'sine=frequency=440:duration={sec}', '-shortest',
                        '-metadata', 'location=+40.6-022.9/', *extra, str(p)], check=True)
        return p

    def test_check_and_prepare(self):
        ok = self.video('ok.mp4', 540, 960, 4, extra=('-c:v', 'libx264', '-pix_fmt', 'yuv420p', '-c:a', 'aac'))
        r = self.rr.check(ok)
        self.assertTrue(r['ok'], r)
        self.assertEqual(r['reencode'], [])
        self.assertTrue(r['story'])
        out = self.tmp / 'out' / 'reel.mp4'
        self.rr.prepare(ok, out)
        import privacy_check
        self.assertEqual(privacy_check.metadata_problems(out), [])     # η τοποθεσία έφυγε

    def test_wrong_ratio_and_short(self):
        r = self.rr.check(self.video('wide.mp4', 640, 360, 2))
        self.assertFalse(r['ok'])
        self.assertEqual(len(r['problems']), 2)
        with self.assertRaises(SystemExit):
            self.rr.prepare(self.tmp / 'wide.mp4', self.tmp / 'x.mp4')

    def test_reencode(self):
        src = self.video('hi.mp4', 1080, 1920, 3.5, fps=15, extra=('-c:v', 'mpeg4', '-c:a', 'aac'))
        r = self.rr.check(src)
        self.assertTrue(r['ok'])
        self.assertTrue(r['reencode'])
        after = self.rr.prepare(src, self.tmp / 'fixed.mp4')
        self.assertEqual(after['reencode'], [])
        self.assertEqual((after['width'], after['height']), (1080, 1920))

    def test_add_to_batch(self):
        tmp = self.tmp
        make_work(tmp / 'work')
        import client
        cl = client.load('TST', tmp / 'work')
        src = self.video('2027-01-07 μάθημα.mp4', 540, 960, 4, extra=('-c:v', 'libx264', '-pix_fmt', 'yuv420p', '-c:a', 'aac'))
        (tmp / '2027-01-07 μάθημα.txt').write_text('Λεζάντα συνεργάτη', encoding='utf-8')
        batch = tmp / 'batch'
        self.rr.add(batch, '2027-01-07', src, cl)
        self.assertTrue((batch / 'TST' / '2027-01-07_reel.mp4').exists())
        self.assertTrue((batch / 'TST' / '2027-01-07_reel_cover.jpg').exists())
        caps = json.loads((batch / 'captions.json').read_text(encoding='utf-8'))
        self.assertEqual(caps['TST|2027-01-07'], 'Λεζάντα συνεργάτη')
        self.assertTrue(caps['TST|2027-01-07|reel']['ready'])


class CleanupTest(unittest.TestCase):
    def test_raw_base(self):
        import cleanup_repo
        tmp = tempfile.mkdtemp()
        try:
            subprocess.run(['git', 'init', '-q', tmp], check=True)
            for url, want in (('https://github.com/okpublisher/publisher', 'okpublisher/publisher'),
                              ('git@github.com:someone/old-repo.git', 'someone/old-repo'),
                              ('http://127.0.0.1:1234/git/owner/name', 'owner/name')):
                subprocess.run(['git', '-C', tmp, 'remote', 'remove', 'origin'], capture_output=True)
                subprocess.run(['git', '-C', tmp, 'remote', 'add', 'origin', url], check=True)
                self.assertEqual(cleanup_repo.raw_base(tmp), f'https://raw.githubusercontent.com/{want}/main/')
        finally:
            shutil.rmtree(tmp)


if __name__ == '__main__':
    unittest.main()
