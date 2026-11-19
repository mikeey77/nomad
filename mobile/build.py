"""Builds NOMAD Mobile: one self-contained .html (no server needed).
Outputs: app/mobile/NOMAD-mobile.html (copied to the NOMAD folder by the app)
         docs/mobile/ (GitHub Pages version, installable + offline via service worker)
Run: python mobile/build.py"""
import base64, json, os, shutil
R = os.path.dirname(os.path.dirname(os.path.abspath(__file__)))
W = os.path.join(R, "app", "web")
rd = lambda *p: open(os.path.join(*p), encoding="utf-8").read()
b64 = lambda p: base64.b64encode(open(p, "rb").read()).decode()
js = lambda s: s.replace("</script", "<\\/script")

glyphs = {}
for rng in ("0-255", "256-511", "768-1023", "1024-1279", "8192-8447"):
    glyphs[rng] = b64(os.path.join(W, "assets", "fonts", "Noto Sans Regular", rng + ".pbf"))
sprites = {}
for n in ("dark", "dark@2x"):
    sprites[n + ".json"] = rd(W, "assets", "sprites", "v4", n + ".json")
    sprites[n + ".png"] = b64(os.path.join(W, "assets", "sprites", "v4", n + ".png"))

src = rd(R, "mobile", "src.html")
parts = {
    "/*MAPLIBRE_CSS*/": rd(W, "vendor", "maplibre-gl.css"),
    "/*INVITEMS*/": js(rd(W, "inv-items.js")),
    "/*FZSTD*/": js(rd(R, "mobile", "vendor", "fzstd.js")),
    "/*PMTILES*/": js(rd(W, "vendor", "pmtiles.js")),
    "/*BASEMAPS*/": js(rd(W, "vendor", "basemaps.js")),
    "/*MAPLIBRE*/": js(rd(W, "vendor", "maplibre-gl.js")),
    "/*FONTS*/": "".join(f'@font-face{{font-family:"{fam}";font-weight:100 900;font-display:swap;src:url(data:font/woff2;base64,{b64(os.path.join(W, "assets", "fonts", fn))}) format("woff2")}}'
                          for fam, fn in (("Inter", "inter-latin-wght-normal.woff2"), ("JetBrains Mono", "jetbrains-mono-latin-wght-normal.woff2"))),
    "/*ASSETS*/{}": json.dumps({"glyphs": glyphs, "sprites": sprites}),
}
for k, v in parts.items():
    assert k in src, k
    src = src.replace(k, v)

out = os.path.join(R, "app", "mobile")
os.makedirs(out, exist_ok=True)
open(os.path.join(out, "NOMAD-mobile.html"), "w", encoding="utf-8").write(src.replace("<!--MANIFEST-->", ""))

pages = os.path.join(R, "docs", "mobile")
os.makedirs(pages, exist_ok=True)
man = '<link rel="manifest" href="manifest.webmanifest"><link rel="apple-touch-icon" href="icon-192.png"><meta name="apple-mobile-web-app-capable" content="yes">'
open(os.path.join(pages, "index.html"), "w", encoding="utf-8").write(src.replace("<!--MANIFEST-->", man))
for f in ("icon-192.png", "icon-512.png"):
    shutil.copy(os.path.join(W, f), pages)
json.dump({"name": "NOMAD Mobile", "short_name": "NOMAD", "start_url": "./", "scope": "./", "display": "standalone",
           "background_color": "#05100b", "theme_color": "#05100b",
           "icons": [{"src": "icon-192.png", "sizes": "192x192", "type": "image/png"},
                     {"src": "icon-512.png", "sizes": "512x512", "type": "image/png"}]},
          open(os.path.join(pages, "manifest.webmanifest"), "w"), indent=1)
ver = str(int(os.path.getmtime(os.path.join(R, "mobile", "src.html"))))
open(os.path.join(pages, "sw.js"), "w").write(
    "const C='nomad-mobile-" + ver + "', F=['./','index.html','manifest.webmanifest','icon-192.png','icon-512.png'];\n"
    "self.addEventListener('install',e=>{e.waitUntil(caches.open(C).then(c=>c.addAll(F)));self.skipWaiting()});\n"
    "self.addEventListener('activate',e=>{e.waitUntil(caches.keys().then(k=>Promise.all(k.filter(x=>x!==C).map(x=>caches.delete(x)))));self.clients.claim()});\n"
    "self.addEventListener('fetch',e=>{if(e.request.method!=='GET')return;e.respondWith(fetch(e.request).then(r=>{const c=r.clone();caches.open(C).then(x=>x.put(e.request,c));return r}).catch(()=>caches.match(e.request,{ignoreSearch:true})))});\n")
print("built", os.path.getsize(os.path.join(out, "NOMAD-mobile.html")) // 1024, "KB")
