"""
PROJECT NOMAD — persoonlijke offline kennis- en wereldserver.

Alles staat op de SSD:  NOMAD\\app (deze code), NOMAD\\data (inhoud),
NOMAD\\tools (python, ollama, java, photon), NOMAD\\ai (modellen).

Start via NOMAD.exe. Opties:
    --lan          ook bereikbaar op je netwerk (iPad/telefoon)
    --port 8090    andere poort
    --no-browser   geen browser openen
"""
import argparse
import glob
import json
import os
import re
import shutil
import socket
import subprocess
import sys
import threading
import time
import urllib.error
import urllib.request
import webbrowser
from datetime import datetime
from html import unescape
from http.server import BaseHTTPRequestHandler, ThreadingHTTPServer
from urllib.parse import parse_qs, quote, unquote, urlparse

VERSION = "0.5.0"

APP = os.path.dirname(os.path.abspath(__file__))
ROOT = os.path.dirname(APP)
WEB = os.path.join(APP, "web")
DATA = os.path.join(ROOT, "data")
LIB_DIR = os.path.join(DATA, "bibliotheek")
MAP_DIR = os.path.join(DATA, "kaart")
GEO_DIR = os.path.join(DATA, "zoeken")
TOOLS = os.path.join(ROOT, "tools")
AI_DIR = os.path.join(ROOT, "ai", "modellen")
DL_DIR = os.path.join(ROOT, "downloads")
CONFIG_FILE = os.path.join(APP, "config.json")

DEFAULT_CONFIG = {
    "port": 8090,
    "lang": "en",
    "accent": "green",
    "theme": "dark",
    "font_scale": 1.0,
    "update_check": True,
    "ai_model": "llama3.2:3b",
    "ollama_port": 11434,
    "photon_port": 2322,
    "photon_args": ["serve", "-data-dir", "{data}", "-listen-port", "{port}"],
    "photon_args_fallback": ["-data-dir", "{data}", "-listen-port", "{port}"],
    "update_check_minutes": 30,
    "kiwix_base": "https://download.kiwix.org/zim/",
    "protomaps_base": "https://build.protomaps.com/",
}


def load_config():
    cfg = dict(DEFAULT_CONFIG)
    try:
        with open(CONFIG_FILE, encoding="utf-8") as f:
            cfg.update(json.load(f))
    except FileNotFoundError:
        save_json(CONFIG_FILE, cfg)
    except Exception as e:
        print("config.json kon niet gelezen worden:", e)
    return cfg


def save_json(path, obj):
    tmp = path + ".tmp"
    with open(tmp, "w", encoding="utf-8") as f:
        json.dump(obj, f, indent=2, ensure_ascii=False)
    os.replace(tmp, path)


CFG = load_config()

sys.path.insert(0, APP)
import features  # noqa: E402

try:
    from libzim.reader import Archive
    from libzim.search import Query, Searcher
    from libzim.suggestion import SuggestionSearcher
    HAVE_ZIM = True
except ImportError:
    HAVE_ZIM = False
    print("! libzim ontbreekt — draai eerst 'Setup NOMAD.bat'. Bibliotheek staat uit.")


# ───────────────────────────── bibliotheek ─────────────────────────────

DATE_RE = re.compile(r"_(\d{4}-\d{2})$")


class Book:
    def __init__(self, path):
        self.path = path
        self.file = os.path.basename(path)
        stem = self.file[:-4]
        m = DATE_RE.search(stem)
        self.date = m.group(1) if m else ""
        self.prefix = stem[: m.start()] if m else stem
        self.id = self.prefix
        self.archive = Archive(path)
        self.lock = threading.Lock()
        self.title = self.meta("Title") or self.prefix
        self.description = self.meta("Description")
        self.language = self.meta("Language")
        self.size = os.path.getsize(path)

    def meta(self, key):
        try:
            return bytes(self.archive.get_metadata(key)).decode("utf-8", "replace")
        except Exception:
            return ""

    def main_path(self):
        try:
            e = self.archive.main_entry
            for _ in range(10):
                if not e.is_redirect:
                    break
                e = e.get_redirect_entry()
            return e.path
        except Exception:
            return ""

    def info(self):
        a = self.archive
        return {
            "id": self.id, "title": self.title, "file": self.file, "date": self.date,
            "description": self.description, "language": self.language,
            "articles": a.article_count, "size": self.size, "main": self.main_path(),
            "fulltext": a.has_fulltext_index, "kind": kind_of(self.prefix),
        }


def kind_of(prefix):
    p = prefix.lower()
    for key, kind in (("wikipedia", "encyclopedie"), ("gutenberg", "boeken"), ("ifixit", "reparatie"),
                      ("stackexchange", "vraag & antwoord"), ("stack", "vraag & antwoord"),
                      ("wikibooks", "leerboeken"), ("wikiversity", "leren"), ("libretexts", "leerboeken"),
                      ("mdwiki", "medisch"), ("wikivoyage", "reizen"), ("wiktionary", "woordenboek"),
                      ("khan", "leren"), ("phet", "simulaties"), ("ted", "video")):
        if key in p:
            return kind
    return "overig"


BOOKS = {}
BOOKS_LOCK = threading.Lock()


def scan_library():
    found = {}
    if HAVE_ZIM and os.path.isdir(LIB_DIR):
        for path in sorted(glob.glob(os.path.join(LIB_DIR, "*.zim"))):
            try:
                b = Book(path)
                old = found.get(b.id)
                if old is None or b.date > old.date:
                    found[b.id] = b
            except Exception as e:
                print("! kan niet openen:", os.path.basename(path), "-", e)
    with BOOKS_LOCK:
        BOOKS.clear()
        BOOKS.update(found)
    print(f"Bibliotheek: {len(found)} collectie(s)")


def book_order(b):
    order = ["encyclopedie", "leerboeken", "leren", "boeken", "reparatie", "medisch", "reizen"]
    k = kind_of(b.prefix)
    return (order.index(k) if k in order else 99, b.title.lower())


def wikipedia_book():
    for b in BOOKS.values():
        if b.prefix.startswith("wikipedia_"):
            return b
    return None


def resolve(book, path):
    a = book.archive
    if not a.has_entry_by_path(path):
        return None
    e = a.get_entry_by_path(path)
    for _ in range(10):
        if not e.is_redirect:
            break
        e = e.get_redirect_entry()
    return e


def suggest(book, q, n=8):
    out = []
    with book.lock:
        for r in SuggestionSearcher(book.archive).suggest(q).get_results(0, n):
            p = getattr(r, "path", r)
            try:
                t = book.archive.get_entry_by_path(p).title
            except Exception:
                t = p
            out.append({"book": book.id, "path": p, "title": t})
    return out


def fulltext(book, q, start=0, n=25):
    if not book.archive.has_fulltext_index:
        return 0, []
    out = []
    with book.lock:
        s = Searcher(book.archive).search(Query().set_query(q))
        total = s.get_estimated_matches()
        for r in s.get_results(start, n):
            p = getattr(r, "path", r)
            try:
                t = book.archive.get_entry_by_path(p).title
            except Exception:
                t = p
            out.append({"book": book.id, "path": p, "title": t})
    return total, out


TAG_RE = re.compile(r"<(script|style|table|sup|figure|nav|header|footer)[^>]*>.*?</\1>", re.S | re.I)


def plain_text(book, path, limit=2200):
    with book.lock:
        e = resolve(book, path)
        if not e:
            return ""
        html = bytes(e.get_item().content).decode("utf-8", "replace")
    html = TAG_RE.sub(" ", html)
    paras = re.findall(r"<p[^>]*>(.*?)</p>", html, re.S | re.I)
    text = " ".join(re.sub(r"<[^>]+>", "", p) for p in paras)
    text = re.sub(r"\[\d+\]", "", unescape(text))
    text = re.sub(r"\s+", " ", text).strip()
    return text[:limit]


# ───────────────────────────── kaarten ─────────────────────────────

MAP_LAYERS = {
    "world": os.path.join(MAP_DIR, "basis"),
    "terrain": os.path.join(MAP_DIR, "hoogte"),
    "satellite": os.path.join(MAP_DIR, "satelliet"),
}


def map_file(layer):
    d = MAP_LAYERS.get(layer)
    if not d or not os.path.isdir(d):
        return None
    pref = os.path.join(d, layer + ".pmtiles")
    if os.path.isfile(pref):
        return pref
    files = sorted(glob.glob(os.path.join(d, "*.pmtiles")), key=os.path.getsize, reverse=True)
    return files[0] if files else None


# ───────────────────────────── diensten (AI, adres zoeken) ─────────────────────────────

PROCS = {}
STATE = {"online": False, "ai": "uit", "geo": "uit", "updates": [], "last_check": None, "jobs": {}}


def port_open(port):
    with socket.socket() as s:
        s.settimeout(0.3)
        return s.connect_ex(("127.0.0.1", port)) == 0


def find_exe(*parts):
    p = os.path.join(TOOLS, *parts)
    return p if os.path.exists(p) else None


def start_ollama():
    exe = find_exe("ollama", "ollama.exe") or find_exe("ollama", "ollama")
    port = CFG["ollama_port"]
    if port_open(port):
        STATE["ai"] = "aan"
        return
    if not exe:
        STATE["ai"] = "niet geïnstalleerd"
        return
    env = dict(os.environ, OLLAMA_MODELS=AI_DIR, OLLAMA_HOST=f"127.0.0.1:{port}")
    try:
        PROCS["ollama"] = subprocess.Popen([exe, "serve"], env=env, stdout=subprocess.DEVNULL,
                                           stderr=subprocess.DEVNULL, creationflags=getattr(subprocess, "CREATE_NO_WINDOW", 0))
        for _ in range(40):
            if port_open(port):
                STATE["ai"] = "aan"
                return
            time.sleep(0.25)
        STATE["ai"] = "start niet"
    except Exception as e:
        STATE["ai"] = f"fout: {e}"


def photon_paths():
    java = find_exe("java", "bin", "java.exe") or find_exe("java", "bin", "java")
    if not java:
        cand = glob.glob(os.path.join(TOOLS, "java", "*", "bin", "java.exe"))
        java = cand[0] if cand else None
    jars = sorted(glob.glob(os.path.join(TOOLS, "photon", "photon*.jar")))
    data = None
    for d in (os.path.join(GEO_DIR, "photon_data"), GEO_DIR):
        if os.path.isdir(d) and any(os.scandir(d)) and (os.path.isdir(os.path.join(d, "node_1")) or
                                                        os.path.isdir(os.path.join(d, "photon_data")) or
                                                        d.endswith("photon_data")):
            data = d
            break
    return java, (jars[-1] if jars else None), data


def start_photon():
    port = CFG["photon_port"]
    if port_open(port):
        STATE["geo"] = "aan"
        return
    java, jar, data = photon_paths()
    if not (java and jar):
        STATE["geo"] = "niet geïnstalleerd"
        return
    if not data:
        STATE["geo"] = "geen database"
        return
    datadir = os.path.dirname(data) if data.endswith("photon_data") else data
    for key in ("photon_args", "photon_args_fallback"):
        args = [a.replace("{data}", datadir).replace("{port}", str(port)) for a in CFG[key]]
        log = open(os.path.join(DL_DIR if os.path.isdir(DL_DIR) else ROOT, "photon.log"), "w")
        try:
            p = subprocess.Popen([java, "-Xmx4g", "-jar", jar] + args, cwd=GEO_DIR, stdout=log, stderr=log,
                                 creationflags=getattr(subprocess, "CREATE_NO_WINDOW", 0))
        except Exception as e:
            STATE["geo"] = f"fout: {e}"
            return
        for _ in range(240):  # photon heeft even nodig om de database te openen
            if p.poll() is not None:
                break
            if port_open(port):
                PROCS["photon"] = p
                STATE["geo"] = "aan"
                return
            time.sleep(0.5)
        if p.poll() is None:
            PROCS["photon"] = p
            STATE["geo"] = "opstarten"
            return
    STATE["geo"] = "start niet (zie downloads\\photon.log)"


def stop_services():
    for p in PROCS.values():
        try:
            p.terminate()
        except Exception:
            pass


def http_json(url, data=None, timeout=10):
    req = urllib.request.Request(url, data=json.dumps(data).encode() if data is not None else None,
                                 headers={"Content-Type": "application/json", "User-Agent": "NOMAD/" + VERSION})
    with urllib.request.urlopen(req, timeout=timeout) as r:
        return json.loads(r.read().decode("utf-8"))


def ai_models():
    try:
        return [m["name"] for m in http_json(f"http://127.0.0.1:{CFG['ollama_port']}/api/tags", timeout=3).get("models", [])]
    except Exception:
        return []


# ───────────────────────────── updates ─────────────────────────────

KIWIX_DIRS = [("wikipedia_", "wikipedia"), ("gutenberg_", "gutenberg"), ("ifixit_", "ifixit"),
              ("wikibooks_", "wikibooks"), ("wikiversity_", "wikiversity"), ("wikivoyage_", "wikivoyage"),
              ("wiktionary_", "wiktionary"), ("libretexts", "libretexts"), ("mdwiki_", "other"),
              ("phet_", "phet"), ("freecodecamp", "freecodecamp"), ("ted_", "ted")]


def kiwix_dir(prefix):
    for start, d in KIWIX_DIRS:
        if prefix.startswith(start):
            return d
    if "stackexchange" in prefix or "stackoverflow" in prefix:
        return "stack_exchange"
    return "other"


def is_online():
    try:
        socket.create_connection(("download.kiwix.org", 443), timeout=3).close()
        return True
    except OSError:
        return False


LISTING_CACHE = {}


def kiwix_listing(d):
    if d in LISTING_CACHE and time.time() - LISTING_CACHE[d][0] < 3600:
        return LISTING_CACHE[d][1]
    req = urllib.request.Request(CFG["kiwix_base"] + d + "/", headers={"User-Agent": "NOMAD/" + VERSION})
    with urllib.request.urlopen(req, timeout=20) as r:
        html = r.read().decode("utf-8", "replace")
    names = sorted(set(re.findall(r'href="([^"/]+\.zim)"', html)))
    LISTING_CACHE[d] = (time.time(), names)
    return names


def check_updates():
    online = is_online()
    STATE["online"] = online
    if not online:
        return
    found = []
    for b in list(BOOKS.values()):
        if not b.date:
            continue
        try:
            names = kiwix_listing(kiwix_dir(b.prefix))
        except Exception:
            continue
        newer = []
        for n in names:
            m = re.fullmatch(re.escape(b.prefix) + r"_(\d{4}-\d{2})\.zim", n)
            if m and m.group(1) > b.date:
                newer.append((m.group(1), n))
        if newer:
            date, name = max(newer)
            found.append({"id": "zim:" + b.id, "type": "bibliotheek", "title": b.title,
                          "current": b.date, "latest": date, "file": name,
                          "url": CFG["kiwix_base"] + kiwix_dir(b.prefix) + "/" + name})
    # app (via GitHub)
    try:
        sha = json.loads(urllib.request.urlopen(urllib.request.Request(
            "https://api.github.com/repos/mikeey77/nomad/commits/main",
            headers={"User-Agent": "NOMAD/" + VERSION}), timeout=10).read())["sha"]
        stamp = os.path.join(APP, ".commit")
        cur = open(stamp).read().strip() if os.path.exists(stamp) else ""
        if sha != cur:
            found.append({"id": "app", "type": "app", "title": "NOMAD-app",
                          "current": VERSION + (" (" + cur[:7] + ")" if cur else ""), "latest": "nieuwe versie " + sha[:7]})
    except Exception:
        pass
    # AI-model
    if STATE["ai"] == "aan" and ai_models():
        found.append({"id": "ai", "type": "ai", "title": "AI-model " + CFG["ai_model"],
                      "current": "geïnstalleerd", "latest": "controleren & bijwerken"})
    STATE["updates"] = found
    STATE["last_check"] = datetime.now().strftime("%d-%m %H:%M")


def update_loop():
    while True:
        try:
            if CFG.get("update_check", True):
                check_updates()
            else:
                STATE["online"] = is_online()
        except Exception as e:
            print("update-check fout:", e)
        time.sleep(max(5, CFG["update_check_minutes"]) * 60)


def download(job, url, target, retries=50):
    """Download met hervatten: overleeft netwerkstoringen en herstarts (.part blijft staan)."""
    os.makedirs(DL_DIR, exist_ok=True)
    part = os.path.join(DL_DIR, os.path.basename(target) + ".part")
    for attempt in range(retries):
        have = os.path.getsize(part) if os.path.exists(part) else 0
        req = urllib.request.Request(url, headers={"User-Agent": "NOMAD/" + VERSION, "Range": f"bytes={have}-"})
        try:
            with urllib.request.urlopen(req, timeout=60) as r:
                if r.status == 200:
                    have = 0
                job.update(total=have + int(r.headers.get("Content-Length") or 0), done=have)
                t0, d0 = time.time(), have
                with open(part, "ab" if have else "wb") as f:
                    while True:
                        if job.get("cancel"):
                            raise InterruptedError("cancelled")
                        chunk = r.read(1 << 20)
                        if not chunk:
                            break
                        f.write(chunk)
                        job["done"] += len(chunk)
                        dt = time.time() - t0
                        if dt > 2:
                            job["speed"] = (job["done"] - d0) / dt
                            t0, d0 = time.time(), job["done"]
            break
        except urllib.error.HTTPError as e:
            if e.code == 416:  # al compleet
                break
            if attempt == retries - 1:
                raise
        except InterruptedError:
            raise
        except Exception:
            if attempt == retries - 1:
                raise
            job["msg"] = f"connection lost, retrying ({attempt + 1})…"
            time.sleep(min(60, 5 * (attempt + 1)))
    job["msg"] = ""
    os.replace(part, target)


def run_update(uid):
    upd = next((u for u in STATE["updates"] if u["id"] == uid), None)
    if not upd or uid in STATE["jobs"] and STATE["jobs"][uid]["status"] == "bezig":
        return
    job = {"status": "bezig", "title": upd["title"], "done": 0, "total": 0, "msg": ""}
    STATE["jobs"][uid] = job

    def work():
        try:
            if upd["type"] == "bibliotheek":
                target = os.path.join(LIB_DIR, upd["file"])
                download(job, upd["url"], target)
                old = BOOKS.get(uid[4:])
                scan_library()
                if old and os.path.exists(old.path) and old.path != target:
                    oud = os.path.join(DL_DIR, "oud")
                    os.makedirs(oud, exist_ok=True)
                    try:
                        old.archive = None
                        shutil.move(old.path, os.path.join(oud, old.file))
                        job["msg"] = f"Oude versie verplaatst naar downloads\\oud\\{old.file}"
                    except Exception:
                        job["msg"] = "Oude versie staat nog in de bibliotheek; je kunt hem verwijderen."
            elif upd["type"] == "app":
                sys.path.insert(0, APP)
                import update
                update.main()
                job["msg"] = "Bijgewerkt — sluit NOMAD en start opnieuw."
            elif upd["type"] == "ai":
                req = urllib.request.Request(f"http://127.0.0.1:{CFG['ollama_port']}/api/pull",
                                             data=json.dumps({"model": CFG["ai_model"]}).encode(),
                                             headers={"Content-Type": "application/json"})
                with urllib.request.urlopen(req, timeout=3600) as r:
                    for line in r:
                        try:
                            m = json.loads(line)
                            job["msg"] = m.get("status", "")
                            if m.get("total"):
                                job["total"], job["done"] = m["total"], m.get("completed", 0)
                        except Exception:
                            pass
            job["status"] = "klaar"
            STATE["updates"] = [u for u in STATE["updates"] if u["id"] != uid]
        except Exception as e:
            job["status"] = "fout"
            job["msg"] = str(e)

    threading.Thread(target=work, daemon=True).start()


# ───────────────────────────── HTTP ─────────────────────────────

INJECT = (f'<link rel="stylesheet" href="/web/article.css?v={VERSION}">'
          f'<script src="/web/article.js?v={VERSION}" defer></script>').encode()

MIME = {".js": "application/javascript; charset=utf-8", ".css": "text/css; charset=utf-8",
        ".html": "text/html; charset=utf-8", ".json": "application/json", ".png": "image/png",
        ".pbf": "application/x-protobuf", ".svg": "image/svg+xml", ".woff2": "font/woff2", ".webmanifest": "application/manifest+json"}


class Handler(BaseHTTPRequestHandler):
    server_version = "NOMAD/" + VERSION
    protocol_version = "HTTP/1.1"

    def log_message(self, *a):
        pass

    def send(self, code, body, ctype="text/html; charset=utf-8", cache=False, extra=None):
        if isinstance(body, str):
            body = body.encode("utf-8")
        self.send_response(code)
        self.send_header("Content-Type", ctype)
        self.send_header("Content-Length", str(len(body)))
        self.send_header("Cache-Control", "public, max-age=86400" if cache else "no-store")
        for k, v in (extra or {}).items():
            self.send_header(k, v)
        self.end_headers()
        if self.command != "HEAD":
            self.wfile.write(body)

    def json(self, obj, code=200):
        self.send(code, json.dumps(obj, ensure_ascii=False), "application/json; charset=utf-8")

    def body_json(self):
        n = int(self.headers.get("Content-Length") or 0)
        return json.loads(self.rfile.read(n) or b"{}")

    # ---- routing ----
    def do_HEAD(self):
        self.do_GET()

    def do_GET(self):
        u = urlparse(self.path)
        p, qs = unquote(u.path), parse_qs(u.query)
        q = lambda k, d="": qs.get(k, [d])[0]
        try:
            if p in ("/", "/index.html"):
                with open(os.path.join(WEB, "index.html"), encoding="utf-8") as f:
                    html = f.read()
                # versie achter eigen js/css: na een update nooit meer oude bestanden uit de browsercache
                html = re.sub(r'(/web/(?!vendor/)[\w./-]+\.(?:js|css))"', r'\1?v=' + VERSION + '"', html)
                return self.send(200, html)
            if p == "/manifest.webmanifest":
                return self.static(os.path.join(WEB, "manifest.webmanifest"))
            if p.startswith("/web/"):
                long = p.startswith(("/web/vendor/", "/web/assets/")) or p.endswith(".png")
                return self.static(os.path.join(WEB, p[5:]), cache=long)
            if p.startswith("/kaart/"):
                f = map_file(p[7:].split("/")[0].replace(".pmtiles", ""))
                return self.ranged(f) if f else self.send(404, "geen kaartbestand")
            if p == "/api/status":
                return self.api_status()
            if p == "/api/library":
                with BOOKS_LOCK:
                    return self.json(sorted([b.info() for b in BOOKS.values()],
                                            key=lambda x: book_order(BOOKS[x["id"]])))
            if p == "/api/suggest":
                return self.api_suggest(q("q"), q("book"))
            if p == "/api/search":
                return self.api_search(q("q"), q("book"), int(q("start", "0")))
            if p == "/api/random":
                return self.api_random(q("book"))
            if p == "/api/geocode":
                return self.api_geocode(q("q"), q("lat"), q("lon"))
            if p == "/api/settings":
                return self.json(features.get_settings())
            if p == "/api/user":
                return self.json(features.load_user())
            if p == "/api/cleanup":
                return self.json(features.cleanup_items())
            if p == "/api/catalog":
                return self.json(features.catalog(q("force") == "1"))
            if p.startswith("/api/icon/"):
                data = features.icon(p[10:])
                return self.send(200, data, "image/png", cache=True) if data else self.send(404, "")
            if p == "/api/updates":
                return self.json({"online": STATE["online"], "last_check": STATE["last_check"],
                                  "updates": STATE["updates"], "jobs": STATE["jobs"]})
            if p.startswith("/lib/"):
                parts = p[5:].split("/", 1)
                return self.content(parts[0], parts[1] if len(parts) > 1 else "")
            self.send(404, "Niet gevonden")
        except (BrokenPipeError, ConnectionResetError):
            pass
        except Exception as e:
            try:
                self.send(500, f"Fout: {e}", "text/plain; charset=utf-8")
            except Exception:
                pass

    def do_POST(self):
        p = urlparse(self.path).path
        try:
            if p == "/api/chat":
                return self.api_chat(self.body_json())
            if p == "/api/updates/check":
                threading.Thread(target=check_updates, daemon=True).start()
                return self.json({"ok": True})
            if p == "/api/updates/run":
                run_update(self.body_json().get("id"))
                return self.json({"ok": True})
            if p == "/api/settings":
                return self.json(features.set_settings(self.body_json()))
            if p == "/api/user":
                return self.json(features.save_user(self.body_json()))
            if p == "/api/cleanup":
                return self.json(features.cleanup(self.body_json().get("paths", [])))
            if p == "/api/download":
                return self.json(features.enqueue(self.body_json().get("id")))
            if p == "/api/download/cancel":
                return self.json(features.cancel(self.body_json().get("id")))
            if p == "/api/remove":
                return self.json(features.remove(self.body_json().get("id")))
            if p == "/api/ai/use":
                return self.json(features.use_model(self.body_json().get("model")))
            if p == "/api/shutdown" and self.client_address[0] == "127.0.0.1":
                self.json({"ok": True})
                threading.Thread(target=lambda: (time.sleep(0.3), stop_services(), os._exit(0)), daemon=True).start()
                return
            if p == "/api/rescan":
                scan_library()
                return self.json({"ok": True, "books": len(BOOKS)})
            self.send(404, "Niet gevonden")
        except (BrokenPipeError, ConnectionResetError):
            pass

    # ---- helpers ----
    def static(self, full, cache=False):
        full = os.path.normpath(full)
        if not full.startswith(WEB) or not os.path.isfile(full):
            return self.send(404, "Niet gevonden")
        ext = os.path.splitext(full)[1].lower()
        with open(full, "rb") as f:
            self.send(200, f.read(), MIME.get(ext, "application/octet-stream"), cache=cache)

    def ranged(self, path):
        size = os.path.getsize(path)
        rng = self.headers.get("Range")
        start, end = 0, size - 1
        if rng:
            m = re.match(r"bytes=(\d*)-(\d*)", rng)
            if m:
                if m.group(1):
                    start = int(m.group(1))
                    end = int(m.group(2)) if m.group(2) else size - 1
                else:
                    start = max(0, size - int(m.group(2)))
            end = min(end, size - 1)
            if start > end:
                self.send_response(416)
                self.send_header("Content-Range", f"bytes */{size}")
                self.send_header("Content-Length", "0")
                self.end_headers()
                return
        length = end - start + 1
        self.send_response(206 if rng else 200)
        self.send_header("Content-Type", "application/octet-stream")
        self.send_header("Accept-Ranges", "bytes")
        self.send_header("Content-Length", str(length))
        self.send_header("Cache-Control", "public, max-age=3600")
        if rng:
            self.send_header("Content-Range", f"bytes {start}-{end}/{size}")
        self.end_headers()
        if self.command == "HEAD":
            return
        with open(path, "rb") as f:
            f.seek(start)
            left = length
            while left > 0:
                chunk = f.read(min(1 << 20, left))
                if not chunk:
                    break
                self.wfile.write(chunk)
                left -= len(chunk)

    def content(self, bid, path):
        b = BOOKS.get(bid)
        if not b:
            return self.send(404, "Collectie niet gevonden")
        if not path:
            path = b.main_path()
            self.send_response(302)
            self.send_header("Location", f"/lib/{quote(bid)}/{quote(path)}")
            self.send_header("Content-Length", "0")
            self.end_headers()
            return
        with b.lock:
            e = resolve(b, path)
            if e is None:
                return self.send(404, f"<p style='font-family:sans-serif'>Niet gevonden: {path}</p>")
            if e.path != path:
                self.send_response(302)
                self.send_header("Location", f"/lib/{quote(bid)}/{quote(e.path)}")
                self.send_header("Content-Length", "0")
                self.end_headers()
                return
            item = e.get_item()
            data, mime = bytes(item.content), item.mimetype or "application/octet-stream"
        if mime.startswith("text/html"):
            i = data.lower().rfind(b"</head>")
            data = data[:i] + INJECT + data[i:] if i != -1 else INJECT + data
            return self.send(200, data, "text/html; charset=utf-8", cache=True)
        self.send(200, data, mime, cache=True)

    def api_status(self):
        try:
            du = shutil.disk_usage(ROOT)
            disk = {"total": du.total, "used": du.used, "free": du.free}
        except Exception:
            disk = {}
        maps = {}
        for layer in MAP_LAYERS:
            f = map_file(layer)
            maps[layer] = {"present": bool(f), "size": os.path.getsize(f) if f else 0}
        lib_size = sum(b.size for b in BOOKS.values())
        self.json({
            "version": VERSION, "online": STATE["online"], "disk": disk, "lan_url": STATE.get("lan_url"),
            "library": {"books": len(BOOKS), "size": lib_size,
                        "articles": sum(b.archive.article_count for b in BOOKS.values()),
                        "zim": HAVE_ZIM},
            "maps": maps,
            "geo": STATE["geo"],
            "ai": {"state": STATE["ai"], "model": CFG["ai_model"], "models": ai_models() if STATE["ai"] == "aan" else []},
            "updates": len(STATE["updates"]),
        })

    def api_suggest(self, q, bid):
        q = q.strip()
        if not q:
            return self.json([])
        books = [BOOKS[bid]] if bid in BOOKS else sorted(BOOKS.values(), key=book_order)
        out = []
        for b in books:
            try:
                out += suggest(b, q, 10 if bid else 5)
            except Exception:
                pass
        for r in out:
            r["bookTitle"] = BOOKS[r["book"]].title
        self.json(out[:40])

    def api_search(self, q, bid, start):
        q = q.strip()
        books = [BOOKS[bid]] if bid in BOOKS else sorted(BOOKS.values(), key=book_order)
        total, res = 0, []
        for b in books:
            try:
                t, r = fulltext(b, q, start, 25 if bid else 10)
                total += t
                res += r
            except Exception:
                pass
        for r in res:
            r["bookTitle"] = BOOKS[r["book"]].title
        self.json({"total": total, "results": res})

    def api_random(self, bid):
        b = BOOKS.get(bid) or wikipedia_book() or next(iter(BOOKS.values()), None)
        if not b:
            return self.json({})
        with b.lock:
            for _ in range(25):
                e = b.archive.get_random_entry()
                while e.is_redirect:
                    e = e.get_redirect_entry()
                try:
                    if e.get_item().mimetype.startswith("text/html"):
                        return self.json({"book": b.id, "path": e.path, "title": e.title})
                except Exception:
                    pass
        self.json({"book": b.id, "path": b.main_path()})

    def api_geocode(self, q, lat, lon):
        port = CFG["photon_port"]
        if not port_open(port):
            return self.json({"error": "Adres zoeken staat uit (" + STATE["geo"] + ")", "features": []})
        if q:
            url = f"http://127.0.0.1:{port}/api?q={quote(q)}&limit=8"
            if lat and lon:
                url += f"&lat={lat}&lon={lon}"
        else:
            url = f"http://127.0.0.1:{port}/reverse?lat={lat}&lon={lon}"
        try:
            self.json(http_json(url, timeout=10))
        except Exception as e:
            self.json({"error": str(e), "features": []})

    def api_chat(self, body):
        port = CFG["ollama_port"]
        if not port_open(port):
            return self.json({"error": "AI staat uit (" + STATE["ai"] + "). Start de setup via NOMAD.exe (tray → Run setup)."}, 503)
        msgs = body.get("messages", [])[-12:]
        sources = []
        system = ("Je bent NOMAD, een behulpzame offline assistent. Antwoord in de taal van de gebruiker, "
                  "kort en duidelijk.")
        wb = wikipedia_book()
        if body.get("wiki") and wb and msgs:
            question = msgs[-1].get("content", "")
            _, hits = fulltext(wb, question, 0, 4)
            if not hits:
                hits = suggest(wb, question, 3)
            ctx = []
            for h in hits[:3]:
                t = plain_text(wb, h["path"])
                if t:
                    sources.append({"book": wb.id, "path": h["path"], "title": h["title"]})
                    ctx.append(f"### {h['title']}\n{t}")
            if ctx:
                system += ("\n\nGebruik de volgende Wikipedia-fragmenten als bron. Als het antwoord er niet in "
                           "staat, zeg dat eerlijk.\n\n" + "\n\n".join(ctx))
        payload = {"model": body.get("model") or CFG["ai_model"], "stream": True,
                   "messages": [{"role": "system", "content": system}] + msgs}
        req = urllib.request.Request(f"http://127.0.0.1:{port}/api/chat", data=json.dumps(payload).encode(),
                                     headers={"Content-Type": "application/json"})
        self.send_response(200)
        self.send_header("Content-Type", "application/x-ndjson; charset=utf-8")
        self.send_header("Cache-Control", "no-store")
        self.send_header("Connection", "close")
        self.end_headers()
        self.close_connection = True
        self.wfile.write((json.dumps({"sources": sources}) + "\n").encode())
        self.wfile.flush()
        try:
            with urllib.request.urlopen(req, timeout=600) as r:
                for line in r:
                    try:
                        m = json.loads(line)
                    except Exception:
                        continue
                    piece = (m.get("message") or {}).get("content", "")
                    if piece:
                        self.wfile.write((json.dumps({"t": piece}) + "\n").encode())
                        self.wfile.flush()
                    if m.get("error"):
                        self.wfile.write((json.dumps({"error": m["error"]}) + "\n").encode())
        except urllib.error.HTTPError as e:
            msg = e.read().decode("utf-8", "replace")
            if "not found" in msg:
                msg = f"Model '{payload['model']}' is nog niet gedownload. Start de setup via NOMAD.exe (tray → Run setup)."
            self.wfile.write((json.dumps({"error": msg}) + "\n").encode())
        except Exception as e:
            self.wfile.write((json.dumps({"error": str(e)}) + "\n").encode())


def lan_ip():
    try:
        s = socket.socket(socket.AF_INET, socket.SOCK_DGRAM)
        s.connect(("10.255.255.255", 1))
        ip = s.getsockname()[0]
        s.close()
        return ip
    except Exception:
        return None


def main():
    features.init(sys.modules[__name__])
    ap = argparse.ArgumentParser(description="PROJECT NOMAD")
    ap.add_argument("--port", type=int, default=CFG["port"])
    ap.add_argument("--local", action="store_true", help="alleen op deze pc (niet op je netwerk)")
    ap.add_argument("--no-browser", action="store_true")
    ap.add_argument("--no-services", action="store_true", help="AI en adres zoeken niet starten")
    a = ap.parse_args()

    print(f"\n  PROJECT NOMAD v{VERSION}\n  {ROOT}\n")
    for d in (LIB_DIR, MAP_DIR, GEO_DIR, AI_DIR, DL_DIR):
        os.makedirs(d, exist_ok=True)
    scan_library()
    if not a.no_services:
        threading.Thread(target=start_ollama, daemon=True).start()
        threading.Thread(target=start_photon, daemon=True).start()
    threading.Thread(target=update_loop, daemon=True).start()

    srv = ThreadingHTTPServer(("127.0.0.1" if a.local else "0.0.0.0", a.port), Handler)
    srv.daemon_threads = True
    url = f"http://localhost:{a.port}/"
    print(f"  NOMAD draait op {url}")
    STATE["lan_url"] = None
    if not a.local and lan_ip():
        STATE["lan_url"] = f"http://{lan_ip()}:{a.port}/"
        print(f"  Op je telefoon/iPad (zelfde wifi):  {STATE['lan_url']}")
    print("  Stoppen: sluit dit venster of Ctrl+C\n")
    if not a.no_browser:
        threading.Timer(1.0, lambda: webbrowser.open(url)).start()
    try:
        srv.serve_forever()
    except KeyboardInterrupt:
        pass
    finally:
        stop_services()


if __name__ == "__main__":
    main()
