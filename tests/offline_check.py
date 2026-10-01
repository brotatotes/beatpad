"""Offline check: loads Beat Pad, lets the service worker cache it, goes offline, reloads and plays a pad. Usage: python3 tests/offline_check.py OUT.json"""
import functools, http.server, socketserver, threading, sys, json
from playwright.sync_api import sync_playwright
import os
ROOT=os.path.dirname(os.path.dirname(os.path.abspath(__file__)))
class Q(http.server.SimpleHTTPRequestHandler):
    def log_message(self,*a): pass
Q.extensions_map={**Q.extensions_map,'.js':'text/javascript','.webmanifest':'application/manifest+json','.ogg':'audio/ogg','.m4a':'audio/mp4','.woff2':'font/woff2'}
srv=socketserver.ThreadingTCPServer(('127.0.0.1',0),functools.partial(Q,directory=ROOT)); srv.daemon_threads=True
threading.Thread(target=srv.serve_forever,daemon=True).start()
BASE=f'http://127.0.0.1:{srv.server_address[1]}/'
out={'errors':[]}
with sync_playwright() as p:
    b=p.chromium.launch(args=['--autoplay-policy=no-user-gesture-required'])
    ctx=b.new_context(viewport={'width':390,'height':844},has_touch=True,is_mobile=True)
    pg=ctx.new_page(); pg.on('pageerror',lambda e:out['errors'].append(str(e)))
    pg.add_init_script("window.__hits=[];const o=AudioBufferSourceNode.prototype.start;AudioBufferSourceNode.prototype.start=function(){window.__hits.push(1);return o.apply(this,arguments)};")
    pg.goto(BASE); pg.tap('#startBtn'); pg.wait_for_selector('#splash',state='hidden',timeout=20000)
    pg.evaluate('navigator.serviceWorker.ready.then(()=>1)')
    pg.reload(); pg.wait_for_function('navigator.serviceWorker.controller !== null',timeout=15000)
    pg.tap('#startBtn'); pg.wait_for_selector('#splash',state='hidden',timeout=20000); pg.wait_for_timeout(500)
    out['cached']=pg.evaluate("caches.open('beatpad-v1').then(c=>c.keys()).then(k=>k.length)")
    ctx.set_offline(True)
    pg.reload(); pg.tap('#startBtn'); pg.wait_for_selector('#splash',state='hidden',timeout=20000); pg.wait_for_timeout(300)
    n0=pg.evaluate('window.__hits.length'); pg.tap('.pad >> nth=12'); pg.wait_for_timeout(200)
    out['offline_hits']=pg.evaluate('window.__hits.length')-n0
    out['offline_title']=pg.title()
    b.close()
out['ok']=out['offline_hits']>=1 and not out['errors']
print(json.dumps(out)); json.dump(out,open(sys.argv[1],'w'),indent=1)
