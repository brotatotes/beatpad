"""Beat Pad browser check: loads the app from a local static server in Chromium, plays pads by touch and keyboard,
records a loop, toggles the grid, exports a WAV, round-trips a share link and takes phone/desktop screenshots.
Usage: python3 tests/browser_check.py OUT_DIR"""
import http.server, json, os, socketserver, sys, threading, functools, struct

from playwright.sync_api import sync_playwright

ROOT = os.path.dirname(os.path.dirname(os.path.abspath(__file__)))
OUT = sys.argv[1] if len(sys.argv) > 1 else '/tmp/beatpad-check'
os.makedirs(OUT, exist_ok=True)


class Quiet(http.server.SimpleHTTPRequestHandler):
    def log_message(self, *a):
        pass


Quiet.extensions_map = {**http.server.SimpleHTTPRequestHandler.extensions_map, '.js': 'text/javascript', '.webmanifest': 'application/manifest+json', '.ogg': 'audio/ogg', '.m4a': 'audio/mp4', '.woff2': 'font/woff2'}
srv = socketserver.ThreadingTCPServer(('127.0.0.1', 0), functools.partial(Quiet, directory=ROOT))
srv.daemon_threads = True
port = srv.server_address[1]
threading.Thread(target=srv.serve_forever, daemon=True).start()
BASE = f'http://127.0.0.1:{port}/'

INSTR = """
window.__hits = [];
const AC = window.AudioContext;
const orig = AudioBufferSourceNode.prototype.start;
AudioBufferSourceNode.prototype.start = function (when) { window.__hits.push({ when: when || 0, dur: this.buffer ? this.buffer.duration : 0 }); return orig.apply(this, arguments); };
"""

results = {'checks': [], 'errors': [], 'requests': []}


def check(name, ok, detail=''):
    results['checks'].append({'name': name, 'ok': bool(ok), 'detail': detail})
    print(('PASS ' if ok else 'FAIL ') + name + (' : ' + str(detail) if detail else ''))


def run(p, label, viewport, touch, mobile):
    b = p.chromium.launch(args=['--autoplay-policy=no-user-gesture-required'])
    ctx = b.new_context(viewport=viewport, has_touch=touch, is_mobile=mobile, device_scale_factor=2 if mobile else 1, accept_downloads=True)
    page = ctx.new_page()
    page.add_init_script(INSTR)
    page.on('pageerror', lambda e: results['errors'].append(f'{label}: {e}'))
    page.on('console', lambda m: m.type == 'error' and results['errors'].append(f'{label} console: {m.text}'))
    page.on('request', lambda r: results['requests'].append(r.url))
    page.goto(BASE, wait_until='load')
    page.screenshot(path=f'{OUT}/{label}-splash.png')
    if touch:
        page.tap('#startBtn')
    else:
        page.click('#startBtn')
    page.wait_for_selector('#splash', state='hidden', timeout=20000)
    page.wait_for_timeout(300)
    page.screenshot(path=f'{OUT}/{label}-pads.png')
    # play pads
    n0 = page.evaluate('window.__hits.length')
    if touch:
        for i in (12, 8, 2, 13):
            page.tap(f'.pad[data-i="{i}"]')
    else:
        for k in ('z', 'a', '3', 'x'):
            page.keyboard.press(k)
    page.wait_for_timeout(150)
    n1 = page.evaluate('window.__hits.length')
    check(f'{label}: four pad hits start four sample voices', n1 - n0 == 4, n1 - n0)
    # multitouch: two simultaneous pointerdowns on different pads
    if touch:
        cdp = ctx.new_cdp_session(page)
        r1 = page.locator('.pad[data-i="12"]').bounding_box(); r2 = page.locator('.pad[data-i="3"]').bounding_box()
        pts = [{'x': r1['x'] + r1['width'] / 2, 'y': r1['y'] + r1['height'] / 2, 'id': 1}, {'x': r2['x'] + r2['width'] / 2, 'y': r2['y'] + r2['height'] / 2, 'id': 2}]
        n2 = page.evaluate('window.__hits.length')
        cdp.send('Input.dispatchTouchEvent', {'type': 'touchStart', 'touchPoints': pts})
        cdp.send('Input.dispatchTouchEvent', {'type': 'touchEnd', 'touchPoints': []})
        page.wait_for_timeout(150)
        check(f'{label}: two-finger multitouch triggers both pads', page.evaluate('window.__hits.length') - n2 == 2, page.evaluate('window.__hits.length') - n2)
    # record a loop at 120 bpm, 1 bar, by keyboard/tap during the loop
    page.evaluate("""() => { const S = window.BeatApp; S.pattern.layers = []; S.pattern.bpm = 120; S.pattern.bars = 1; }""")
    page.select_option('#barsSel', '1')
    (page.tap if touch else page.click)('#recBtn')
    page.wait_for_timeout(2150)  # count-in is one bar = 2 s at 120 bpm
    for _ in range(3):
        if touch:
            page.tap('.pad[data-i="12"]')
        else:
            page.keyboard.press('z')
        page.wait_for_timeout(500)
    page.wait_for_timeout(700)
    layers = page.evaluate('window.BeatApp.pattern.layers.map(l => l.events.length)')
    ev = page.evaluate('BeatCore.allEvents(window.BeatApp.pattern).length')
    check(f'{label}: recording captured hits after the count-in', ev >= 3, {'events': ev, 'layers': layers})
    # loop playback repeats recorded hits
    h0 = page.evaluate('window.__hits.length')
    page.wait_for_timeout(2100)
    h1 = page.evaluate('window.__hits.length')
    check(f'{label}: the loop replays the recorded hits', h1 - h0 >= 3, h1 - h0)
    # overdub second pass then undo
    if touch:
        page.tap('.pad[data-i="8"]')
    else:
        page.keyboard.press('a')
    page.wait_for_timeout(2100)
    before = page.evaluate('BeatCore.allEvents(window.BeatApp.pattern).length')
    (page.tap if touch else page.click)('#undoBtn')
    after = page.evaluate('BeatCore.allEvents(window.BeatApp.pattern).length')
    check(f'{label}: undo removes the last overdub layer', after < before and after >= 3, {'before': before, 'after': after})
    (page.tap if touch else page.click)('#playBtn')  # stop
    # grid
    if not mobile:
        pass
    else:
        page.tap('.views [data-view="grid"]')
    page.wait_for_timeout(200)
    cells_on = page.evaluate("document.querySelectorAll('.gc.on').length")
    check(f'{label}: grid shows the recorded kicks', cells_on >= 3, cells_on)
    cell = page.locator('.gc[data-pad="9"][data-s="4"]')
    (cell.tap if touch else cell.click)()
    has = page.evaluate('BeatCore.gridHas(window.BeatApp.pattern, 9, 4)')
    check(f'{label}: tapping a grid cell adds a snare at step 5', has)
    page.screenshot(path=f'{OUT}/{label}-grid.png')
    if mobile:
        page.tap('.views [data-view="pads"]')
    # share round trip
    code = page.evaluate('BeatCore.encodeShare(window.BeatApp.pattern)')
    p2 = ctx.new_page()
    p2.on('pageerror', lambda e: results['errors'].append(f'{label} share page: {e}'))
    p2.goto(BASE + '#b=' + code)
    same = p2.evaluate("() => JSON.stringify(BeatCore.allEvents(window.BeatApp.pattern).map(e => [e.t, e.pad]).sort())") == page.evaluate("() => JSON.stringify(BeatCore.allEvents(BeatCore.decodeShare(BeatCore.encodeShare(window.BeatApp.pattern))).map(e => [e.t, e.pad]).sort())")
    check(f'{label}: share link opens the same beat', same, len(code))
    p2.close()
    # WAV export
    with page.expect_download(timeout=20000) as dl:
        (page.tap if touch else page.click)('#menuBtn')
        (page.tap if touch else page.click)('#mWav')
    path = f'{OUT}/{label}-export.wav'
    dl.value.save_as(path)
    data = open(path, 'rb').read()
    ok = data[:4] == b'RIFF' and data[8:12] == b'WAVE'
    ch, sr = struct.unpack('<HI', data[22:28]) if ok else (0, 0)
    pcm = memoryview(data)[44:].cast('h') if ok else []
    peak = max((abs(x) for x in pcm), default=0)
    check(f'{label}: exported WAV is valid, has sound and does not clip', ok and peak > 1000 and peak < 32767, {'channels': ch, 'rate': sr, 'seconds': round(len(pcm) / max(1, ch) / max(1, sr), 2), 'peak': peak})
    # kit switch + melodic mode
    (page.tap if touch else page.click)('#kitBtn')
    (page.tap if touch else page.click)('[data-kit="trap"]')
    page.wait_for_function("window.BeatApp.pattern.kit === 'trap' && document.querySelector('#sheet').hidden", timeout=20000)
    check(f'{label}: kit picker switches to 808 / Trap', page.evaluate("document.querySelector('#kitName').textContent") == '808 / Trap')
    (page.tap if touch else page.click)('.views [data-mode="keys"]')
    page.wait_for_function("window.BeatEngine && window.BeatApp.engine.instLoaded('keys')", timeout=20000)
    n3 = page.evaluate('window.__hits.length')
    (page.tap if touch else page.click)('.pad[data-i="12"]')
    page.wait_for_timeout(100)
    lbls = page.evaluate("[...document.querySelectorAll('.pad .lbl')].map(x => x.textContent)")
    check(f'{label}: keys mode plays a note and labels pads with scale notes', page.evaluate('window.__hits.length') - n3 == 1 and lbls[12].startswith('A'), lbls)
    page.screenshot(path=f'{OUT}/{label}-keys.png')
    (page.tap if touch else page.click)('.views [data-mode="drums"]')
    # pad edit sheet
    if touch:
        box = page.locator('.pad[data-i="9"]').bounding_box()
        page.mouse.move(box['x'] + 30, box['y'] + 30)
        cdp = ctx.new_cdp_session(page)
        cdp.send('Input.dispatchTouchEvent', {'type': 'touchStart', 'touchPoints': [{'x': box['x'] + 30, 'y': box['y'] + 30}]})
        page.wait_for_timeout(700)
        cdp.send('Input.dispatchTouchEvent', {'type': 'touchEnd', 'touchPoints': []})
    else:
        page.click('.pad[data-i="9"]', button='right')
    page.wait_for_timeout(200)
    check(f'{label}: holding a pad opens its edit sheet', not page.evaluate("document.querySelector('#sheet').hidden"), page.evaluate("document.querySelector('#sheetTitle').textContent"))
    page.screenshot(path=f'{OUT}/{label}-padedit.png')
    page.evaluate("document.querySelector('[data-close]').click()")
    (page.tap if touch else page.click)('#menuBtn')
    (page.tap if touch else page.click)('#mAbout')
    page.screenshot(path=f'{OUT}/{label}-about.png')
    page.evaluate("document.querySelector('[data-close]').click()")
    # overflow
    ov = page.evaluate('[document.documentElement.scrollWidth, document.documentElement.clientWidth, document.documentElement.scrollHeight, document.documentElement.clientHeight]')
    check(f'{label}: no page overflow', ov[0] <= ov[1] and ov[2] <= ov[3], ov)
    b.close()


with sync_playwright() as p:
    run(p, 'phone', {'width': 390, 'height': 844}, True, True)
    run(p, 'desktop', {'width': 1440, 'height': 900}, False, False)
    run_land = True
    if run_land:
        b = p.chromium.launch()
        c = b.new_context(viewport={'width': 844, 'height': 390}, has_touch=True, is_mobile=True, device_scale_factor=2)
        pg = c.new_page(); pg.add_init_script(INSTR); pg.on('pageerror', lambda e: results['errors'].append(f'landscape: {e}'))
        pg.on('request', lambda r: results['requests'].append(r.url))
        pg.goto(BASE); pg.tap('#startBtn'); pg.wait_for_selector('#splash', state='hidden', timeout=20000)
        pg.wait_for_timeout(300)
        l0 = pg.evaluate('window.__hits.length')
        for i in (12, 9, 3):
            pg.tap(f'.pad[data-i="{i}"]')
        pg.wait_for_timeout(150)
        check('landscape: three pad taps start three sample voices', pg.evaluate('window.__hits.length') - l0 == 3, pg.evaluate('window.__hits.length') - l0)
        pg.screenshot(path=f'{OUT}/landscape-pads.png')
        ov = pg.evaluate('[document.documentElement.scrollWidth, document.documentElement.clientWidth, document.documentElement.scrollHeight, document.documentElement.clientHeight]')
        check('landscape: no page overflow', ov[0] <= ov[1] and ov[2] <= ov[3], ov)
        b.close()

foreign = sorted({u for u in results['requests'] if not u.startswith(BASE) and not u.startswith('data:') and not u.startswith('blob:')})
check('only same-origin requests', not foreign, foreign[:5])
check('no page or console errors', not results['errors'], results['errors'][:8])
results['passed'] = all(c['ok'] for c in results['checks'])
results['requests'] = len(results['requests'])
json.dump(results, open(f'{OUT}/browser-check.json', 'w'), indent=1)
print('ALL PASS' if results['passed'] else 'SOME FAILED')
srv.shutdown()
