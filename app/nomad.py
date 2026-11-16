"""
PROJECT NOMAD — persoonlijke offline kennis- en wereldserver.

Alles staat op de SSD:  NOMAD\\app (deze code), NOMAD\\data (inhoud),
NOMAD\\tools (python, ollama, java, photon), NOMAD\\ai (models).

Start via NOMAD.exe. Opties:
    --lan          ook bereikbaar op je netwerk (iPad/telefoon)
    --port 8090    andere poort
    --no-browser   geen browser openen
"""
import argparse
import mimetypes
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

VERSION = "0.11.0"

APP = os.path.dirname(os.path.abspath(__file__))
ROOT = os.path.dirname(APP)
WEB = os.path.join(APP, "web")
DATA = os.path.join(ROOT, "data")
TOOLS = os.path.join(ROOT, "tools")
DL_DIR = os.path.join(ROOT, "downloads")

# ── v0.11: English folder names. Old (Dutch) folders are renamed on start; if a folder
#    is in use (e.g. a browser is still downloading into it) it is retried next start
#    and the old folder keeps working in the meantime.
LEGACY_DIRS = [  # (old, new) relative to ROOT — order matters (parents first)
    ("data/kaart", "data/maps"),
    ("data/maps/basis", "data/maps/world"),
    ("data/maps/hoogte", "data/maps/terrain"),
    ("data/maps/satelliet", "data/maps/satellite"),
    ("data/bibliotheek", "data/library"),
    ("data/zoeken", "data/search"),
    ("ai/modellen", "ai/models"),
    ("downloads/oud", "downloads/old"),
]
README_TEXT = {
    "data/library": "Put .zim files here (Wikipedia, Gutenberg, iFixit, Stack Exchange...). NOMAD picks them up within ~30 seconds.",
    "data/maps/world": "The Protomaps world map goes here: one .pmtiles file (~120 GB), named world.pmtiles.",
    "data/maps/terrain": "The elevation map goes here (JAXA Terrarium z0-11, ~91 GB, torrent). Rename the .pmtiles file to terrain.pmtiles.",
    "data/maps/satellite": "The satellite layer goes here (satellite.pmtiles).",
    "data/search": "Address search database (Photon). Filled by setup from downloads\\photon-db-*.tar.bz2.",
    "ai/models": "The local AI (Ollama) keeps its models here. Filled by setup / Downloads > AI models.",
    "tools": "Offline programs: portable Python, Ollama, Java, Photon, GraphHopper. Filled by setup.",
    "downloads": "Temporary downloads (.part files resume automatically). Safe to empty when nothing is downloading.",
}


def _merge_move(src, dst):
    """Move src into dst. Returns True when src is gone afterwards."""
    if not os.path.exists(dst):
        try:
            os.makedirs(os.path.dirname(dst), exist_ok=True)
            os.rename(src, dst)
            return True
        except OSError:
            return False
    ok = True
    for name in os.listdir(src):
        a, b = os.path.join(src, name), os.path.join(dst, name)
        if name == "_WAT_HOORT_HIER.txt":
            try:
                os.remove(a)
            except OSError:
                ok = False
            continue
        if os.path.isdir(a) and os.path.isdir(b):
            ok = _merge_move(a, b) and ok
        elif not os.path.exists(b):
            try:
                os.rename(a, b)
            except OSError:
                ok = False
        else:
            ok = False
    if ok:
        try:
            os.rmdir(src)
        except OSError:
            ok = False
    return ok


def _busy(port):
    try:
        with socket.create_connection(("127.0.0.1", port), timeout=0.3):
            return True
    except OSError:
        return False


def migrate_folders():
    for old, new in LEGACY_DIRS:
        a, b = os.path.join(ROOT, *old.split("/")), os.path.join(ROOT, *new.split("/"))
        # never move folders from under a running AI / address server; retried next start
        if (old == "ai/modellen" and _busy(11434)) or (old == "data/zoeken" and _busy(2322)):
            continue
        if os.path.isdir(a):
            if not _merge_move(a, b):
                print(f"! Could not rename {old} -> {new} yet (in use?). Will retry next start.")
    for rel, text in README_TEXT.items():
        d = os.path.join(ROOT, *rel.split("/"))
        if os.path.isdir(d):
            for junk in ("_WAT_HOORT_HIER.txt",):
                try:
                    os.remove(os.path.join(d, junk))
                except OSError:
                    pass
            f = os.path.join(d, "README.txt")
            if not os.path.exists(f):
                try:
                    with open(f, "w", encoding="utf-8") as fh:
                        fh.write(text + "\n")
                except OSError:
                    pass


def legacy(new_rel):
    """Old Dutch folder for an English one, if it still exists (rename failed)."""
    for old, new in LEGACY_DIRS:
        if new == new_rel:
            a = os.path.join(ROOT, *old.split("/"))
            if os.path.isdir(a):
                return a
            # parent may still have the old name (data/kaart/basis)
            for o2, n2 in LEGACY_DIRS:
                if old.startswith(n2 + "/"):
                    a2 = os.path.join(ROOT, *(o2 + old[len(n2):]).split("/"))
                    if os.path.isdir(a2):
                        return a2
    return None


try:
    migrate_folders()
except Exception as _e:  # never block startup
    print("! folder migration:", _e)

LIB_DIR = os.path.join(DATA, "library")
MAP_DIR = os.path.join(DATA, "maps")
GEO_DIR = legacy("data/search") or os.path.join(DATA, "search")
AI_DIR = legacy("ai/models") or os.path.join(ROOT, "ai", "models")
LIB_DIRS = [d for d in (LIB_DIR, legacy("data/library")) if d]


def lib_zims():
    out = []
    for d in LIB_DIRS:
        out += glob.glob(os.path.join(d, "*.zim"))
    return sorted(out)
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
import extra  # noqa: E402

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
    if HAVE_ZIM:
        for path in lib_zims():
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



# ───────────────────────────── snelle AI (v0.11) ─────────────────────────────
THINK_MODELS = ("qwen3", "deepseek-r1", "gpt-oss", "magistral", "phi4-reasoning", "qwq", "cogito")
STOP = set("""a an the is are was were be been of to in on at for and or but with by from as it its this that these those what which who whom
how why when where do does did can could should would will shall may might i you he she we they me my your our their there here
about into than then so if not no yes please tell explain give show make use also just very much many more most some any all
de het een en of in op aan voor met van te is zijn was waren wordt worden hoe wat wie waarom wanneer waar welk welke dat die dit deze
er hier daar ik je jij u hij zij we wij ze mijn jouw ons onze hun kan kun kunt moet mag wil zou zal ook nog maar dan als niet geen wel
heel veel meer meest over naar bij uit om door tot""".split())
_RAG_CACHE = {}


def supports_think(model):
    return any(k in (model or "") for k in THINK_MODELS)


def keywords(q, n=6):
    words = re.findall(r"[\w'-]{2,}", q.lower())
    out = [w for w in words if w not in STOP and not w.isdigit() or (w.isdigit() and len(w) == 4)]
    seen, res = set(), []
    for w in out:
        if w not in seen:
            seen.add(w)
            res.append(w)
    return res[:n] or words[:n]


def _search_book(bk, kw, per):
    key = (bk.id, " ".join(kw), per)
    if key in _RAG_CACHE:
        return _RAG_CACHE[key]
    hits = []
    try:
        _, hits = fulltext(bk, " ".join(kw), 0, per)
        if not hits and kw:
            hits = suggest(bk, " ".join(kw[:3]), per)
    except Exception:
        hits = []
    hits = hits[:per]
    if len(_RAG_CACHE) > 300:
        _RAG_CACHE.clear()
    _RAG_CACHE[key] = hits
    return hits


def rag_search(question, emit, deep=False):
    """Search all books in parallel with a time budget; report progress via emit()."""
    from concurrent.futures import ThreadPoolExecutor, wait, FIRST_COMPLETED
    kw = keywords(question)
    budget = 12.0 if deep else 4.0
    per, limit, chars = (3, 8, 1800) if deep else (2, 5, 1300)
    books = sorted(BOOKS.values(), key=book_order)
    emit({"status": "search", "kw": kw, "books": len(books)})
    hits, t0 = [], time.time()
    pool = ThreadPoolExecutor(max_workers=min(8, max(1, len(books))))
    futs = {pool.submit(_search_book, bk, kw, per): bk for bk in books}
    pending = set(futs)
    while pending and time.time() - t0 < budget:
        done, pending = wait(pending, timeout=max(0.05, budget - (time.time() - t0)), return_when=FIRST_COMPLETED)
        for f in done:
            bk = futs[f]
            h = f.result() or []
            hits += h
            emit({"status": "book", "book": bk.title, "n": len(h)})
    if pending:
        emit({"status": "timeout", "skipped": [futs[f].title for f in pending]})
    pool.shutdown(wait=False, cancel_futures=True)
    order = {bk.id: i for i, bk in enumerate(books)}
    hits.sort(key=lambda h: order.get(h["book"], 99))
    sources, ctx = [], []
    for h in hits[:limit]:
        bk = BOOKS.get(h["book"])
        if not bk:
            continue
        try:
            txt = plain_text(bk, h["path"], chars)
        except Exception:
            txt = ""
        if txt:
            src = {"book": bk.id, "path": h["path"], "title": h["title"], "bookTitle": bk.title}
            sources.append(src)
            ctx.append(f"### {h['title']} ({bk.title})\n{txt}")
            emit({"source": src})
    try:
        notes = features.load_user().get("notes", {})
        for key, note in notes.items():
            if any(w in note.lower() for w in kw if len(w) > 3):
                ctx.append(f"### My note on {key}\n{note[:600]}")
    except Exception:
        pass
    emit({"status": "found", "n": len(sources), "ms": int((time.time() - t0) * 1000)})
    return sources, ctx


def copy_mobile():
    """Keep NOMAD-mobile.html (phone reader, no server needed) next to NOMAD.exe up to date."""
    src = os.path.join(APP, "mobile", "NOMAD-mobile.html")
    dst = os.path.join(ROOT, "NOMAD-mobile.html")
    try:
        if os.path.isfile(src) and (not os.path.isfile(dst) or os.path.getsize(dst) != os.path.getsize(src)
                                    or open(dst, "rb").read() != open(src, "rb").read()):
            shutil.copyfile(src, dst)
    except OSError:
        pass


def warm_model():
    """Load the AI model into memory in the background so the first answer starts fast."""
    port = CFG["ollama_port"]
    for _ in range(60):
        if port_open(port):
            break
        time.sleep(1)
    else:
        return
    try:
        payload = {"model": CFG["ai_model"], "prompt": "", "keep_alive": "30m"}
        req = urllib.request.Request(f"http://127.0.0.1:{port}/api/generate", data=json.dumps(payload).encode(),
                                     headers={"Content-Type": "application/json"})
        urllib.request.urlopen(req, timeout=300).read()
        STATE["ai_warm"] = True
    except Exception:
        pass

# ───────────────────────────── kaarten ─────────────────────────────

MAP_LAYERS = {
    "world": os.path.join(MAP_DIR, "world"),
    "terrain": os.path.join(MAP_DIR, "terrain"),
    "satellite": os.path.join(MAP_DIR, "satellite"),
}


def map_file(layer):
    d = MAP_LAYERS.get(layer)
    if not d:
        return None
    for dd in (d, legacy("data/maps/" + layer)):
        if not dd or not os.path.isdir(dd):
            continue
        pref = os.path.join(dd, layer + ".pmtiles")
        if os.path.isfile(pref):
            return pref
        files = sorted(glob.glob(os.path.join(dd, "*.pmtiles")), key=os.path.getsize, reverse=True)
        if files:
            return files[0]
    return None


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
    # AI-model
    if STATE["ai"] == "aan" and ai_models():
        found.append({"id": "ai", "type": "ai", "title": "AI-model " + CFG["ai_model"],
                      "current": "geïnstalleerd", "latest": "controleren & bijwerken"})
    STATE["updates"] = found
    STATE["last_check"] = datetime.now().strftime("%d-%m %H:%M")


def app_update_loop():
    """Werkt de app op de achtergrond bij. Klaar = banner in de UI met 'Herstart'."""
    import update
    STATE["app_update"] = {"status": "none"}
    if not CFG.get("app_update", True) or os.path.isdir(os.path.join(ROOT, ".git")):
        return  # uitgeschakeld, of een ontwikkel-clone
    time.sleep(3)
    while True:
        try:
            l = update.latest()
            if l and l[0] != update.current():
                STATE["app_update"] = {"status": "downloading", "msg": l[1]}
                update.apply(l[0])
                STATE["app_update"] = {"status": "ready", "msg": l[1], "sha": l[0][:7]}
        except Exception as e:
            STATE["app_update"] = {"status": "error", "msg": str(e)}
        time.sleep(30 * 60)


def data_signature():
    sig = []
    for f in lib_zims():
        try:
            st = os.stat(f)
            sig.append((os.path.basename(f), st.st_size, int(st.st_mtime)))
        except OSError:
            pass
    for layer in MAP_LAYERS:
        f = map_file(layer)
        sig.append((layer, os.path.getsize(f) if f else 0))
    sig.append(("photon", os.path.isdir(os.path.join(GEO_DIR, "photon_data"))))
    return tuple(sorted(sig, key=str))


def watch_loop():
    """Herkent bestanden die je zelf in de mappen zet (pas als ze klaar zijn met kopiëren)."""
    STATE["data_version"] = 0
    last = data_signature()
    pending = None
    while True:
        time.sleep(15)
        try:
            sig = data_signature()
            if sig == last:
                pending = None
                continue
            if sig != pending:  # nog aan het veranderen: wachten tot het stabiel is
                pending = sig
                continue
            before = set(BOOKS)
            scan_library()
            new = [BOOKS[k].title for k in BOOKS if k not in before]
            STATE["data_version"] += 1
            STATE["data_msg"] = ", ".join(new) if new else "data"
            if os.path.isdir(os.path.join(GEO_DIR, "photon_data")) and STATE["geo"] != "aan":
                threading.Thread(target=start_photon, daemon=True).start()
            last, pending = sig, None
        except Exception as e:
            print("watcher:", e)


def update_loop():
    time.sleep(20)
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
                    oud = os.path.join(DL_DIR, "old")
                    os.makedirs(oud, exist_ok=True)
                    try:
                        old.archive = None
                        shutil.move(old.path, os.path.join(oud, old.file))
                        job["msg"] = f"Oude versie verplaatst naar downloads\\old\\{old.file}"
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
            if p in ("/mobile", "/NOMAD-mobile.html"):
                with open(os.path.join(APP, "mobile", "NOMAD-mobile.html"), "rb") as f:
                    return self.send(200, f.read(), extra={"Content-Disposition": 'attachment; filename="NOMAD-mobile.html"'})
            if p.startswith("/web/"):
                long = p.startswith(("/web/vendor/", "/web/assets/")) or p.endswith(".png")
                return self.static(os.path.join(WEB, p[5:]), cache=long)
            if p.startswith("/kaart/"):
                layer = p[7:].split("/")[0].replace(".pmtiles", "")
                f = map_file(layer)
                if f:
                    return self.ranged(f)
                if layer == "world" and STATE.get("online") and extra.preview_url():
                    return extra.proxy_range(self, extra.preview_url())
                return self.send(404, "geen kaartbestand")
            if p == "/api/fs/list":
                return self.json(extra.fs_list(q("path")))
            if p == "/api/fs/read":
                return self.json(extra.fs_read(q("path")))
            if p == "/api/fs/raw":
                full, _ = extra.safe(q("path"))
                return self.ranged(full, mimetypes.guess_type(full)[0])
            if p == "/api/route":
                try:
                    return self.json(extra.route(q("from"), q("to"), q("mode", "car")))
                except Exception as e:
                    return self.json({"error": str(e)})
            if p == "/api/fact":
                return self.json(extra.fact())
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
            if p == "/api/bundles":
                return self.json(features.bundles())
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
                b = self.body_json()
                return self.json(features.enqueue_many(b["ids"]) if "ids" in b else features.enqueue(b.get("id")))
            if p == "/api/download/cancel":
                return self.json(features.cancel(self.body_json().get("id")))
            if p == "/api/remove":
                return self.json(features.remove(self.body_json().get("id")))
            if p == "/api/ai/use":
                return self.json(features.use_model(self.body_json().get("model")))
            if p == "/api/stt":
                ln = int(self.headers.get("Content-Length") or 0)
                return self.json(extra.stt(self.rfile.read(ln)))
            if p == "/api/translate":
                return extra.translate_stream(self, self.body_json())
            if p == "/api/fs/write":
                b = self.body_json()
                return self.json(extra.fs_write(b["path"], b["content"]))
            if p == "/api/fs/mkdir":
                return self.json(extra.fs_mkdir(self.body_json()["path"]))
            if p == "/api/fs/rename":
                b = self.body_json()
                return self.json(extra.fs_rename(b["path"], b["name"]))
            if p == "/api/fs/delete":
                return self.json(extra.fs_delete(self.body_json()["path"]))
            if p == "/api/fs/upload":
                qs = parse_qs(urlparse(self.path).query)
                return self.json(extra.fs_upload(qs.get("path", [""])[0], qs.get("name", [""])[0], self.rfile, int(self.headers.get("Content-Length") or 0)))
            if p == "/api/restart":
                self.json({"ok": True})
                threading.Thread(target=lambda: (time.sleep(0.4), stop_services(), os._exit(3)), daemon=True).start()
                return
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

    def ranged(self, path, ctype=None):
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
        self.send_header("Content-Type", ctype or "application/octet-stream")
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
        if not maps["world"]["present"] and STATE.get("online"):
            maps["world"]["preview"] = True
        lib_size = sum(b.size for b in BOOKS.values())
        self.json({
            "version": VERSION, "online": STATE["online"], "disk": disk, "lan_url": STATE.get("lan_url"),
            "app_update": STATE.get("app_update"), "data_version": STATE.get("data_version", 0), "data_msg": STATE.get("data_msg", ""),
            "launcher": bool(os.environ.get("NOMAD_LAUNCHER")),
            "library": {"books": len(BOOKS), "size": lib_size,
                        "articles": sum(b.archive.article_count for b in BOOKS.values()),
                        "zim": HAVE_ZIM},
            "maps": maps,
            "stt": bool(extra.whisper_installed()), "geo": STATE["geo"], "route": {"state": extra.ROUTE["state"], "region": extra.ROUTE.get("region")},
            "ai": {"state": STATE["ai"], "warm": STATE.get("ai_warm", False), "think": supports_think(CFG["ai_model"]), "model": CFG["ai_model"], "models": ai_models() if STATE["ai"] == "aan" else []},
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
            return self.json({"error": "AI is off (" + STATE["ai"] + "). Run setup via NOMAD.exe (tray → Run setup)."}, 503)
        msgs = body.get("messages", [])[-12:]
        model = body.get("model") or CFG["ai_model"]
        think = bool(body.get("think"))
        # headers first: the browser shows progress right away instead of waiting for the search
        self.send_response(200)
        self.send_header("Content-Type", "application/x-ndjson; charset=utf-8")
        self.send_header("Cache-Control", "no-store")
        self.send_header("Connection", "close")
        self.end_headers()
        self.close_connection = True

        def emit(obj):
            try:
                self.wfile.write((json.dumps(obj) + "\n").encode())
                self.wfile.flush()
            except Exception:
                pass

        system = ("You are NOMAD, a helpful offline assistant. Answer in the user's language, "
                  "clearly and to the point.")
        if think and not supports_think(model):
            system += " Think step by step before you answer, then give a clear final answer."
        sources, ctx = [], []
        if body.get("wiki") and BOOKS and msgs:
            question = msgs[-1].get("content", "")
            sources, ctx = rag_search(question, emit, deep=think)
        if ctx:
            system += ("\n\nUse the following excerpts from the user's offline library as your source. "
                       "Mention which source you used. If the answer is not in them, say so honestly.\n\n" + "\n\n".join(ctx))
        emit({"sources": sources})
        emit({"status": "answer"})
        payload = {"model": model, "stream": True, "keep_alive": "30m",
                   "options": {"num_ctx": 8192 if think else 4096},
                   "messages": [{"role": "system", "content": system}] + msgs}
        if supports_think(model):
            payload["think"] = think
        req = urllib.request.Request(f"http://127.0.0.1:{port}/api/chat", data=json.dumps(payload).encode(),
                                     headers={"Content-Type": "application/json"})
        try:
            with urllib.request.urlopen(req, timeout=900) as r:
                for line in r:
                    try:
                        m = json.loads(line)
                    except Exception:
                        continue
                    msg = m.get("message") or {}
                    if msg.get("thinking"):
                        emit({"th": msg["thinking"]})
                    if msg.get("content"):
                        emit({"t": msg["content"]})
                    if m.get("error"):
                        emit({"error": m["error"]})
                    if m.get("done"):
                        tok, dur = m.get("eval_count") or 0, (m.get("eval_duration") or 0) / 1e9
                        emit({"done": True, "tps": round(tok / dur, 1) if dur else None})
        except urllib.error.HTTPError as e:
            msg = e.read().decode("utf-8", "replace")
            if "not found" in msg:
                msg = f"Model '{model}' is not downloaded yet. Get it via Downloads → AI models."
            emit({"error": msg})
        except Exception as e:
            emit({"error": str(e)})


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
    extra.init(sys.modules[__name__])
    ap = argparse.ArgumentParser(description="PROJECT NOMAD")
    ap.add_argument("--port", type=int, default=CFG["port"])
    ap.add_argument("--local", action="store_true", help="alleen op deze pc (niet op je netwerk)")
    ap.add_argument("--no-browser", action="store_true")
    ap.add_argument("--no-services", action="store_true", help="AI en adres zoeken niet starten")
    a = ap.parse_args()

    print(f"\n  PROJECT NOMAD v{VERSION}\n  {ROOT}\n")
    for d in [LIB_DIR, GEO_DIR, AI_DIR, DL_DIR] + list(MAP_LAYERS.values()):
        if d == LIB_DIR and len(LIB_DIRS) > 1:
            continue
        if not any(d == MAP_LAYERS[k] and legacy("data/maps/" + k) for k in MAP_LAYERS):
            os.makedirs(d, exist_ok=True)
    migrate_folders()  # README.txt in fresh folders
    copy_mobile()
    scan_library()
    if not a.no_services:
        threading.Thread(target=lambda: (start_ollama(), warm_model()), daemon=True).start()
        threading.Thread(target=start_photon, daemon=True).start()
        threading.Thread(target=extra.start_route, daemon=True).start()
    threading.Thread(target=update_loop, daemon=True).start()
    threading.Thread(target=app_update_loop, daemon=True).start()
    threading.Thread(target=watch_loop, daemon=True).start()

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
