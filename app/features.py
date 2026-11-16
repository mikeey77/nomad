"""Extra NOMAD-functies: instellingen, favorieten/notities/pins, opruimen, autostart, downloadcatalogus."""
import glob
import json
import os
import re
import subprocess
import sys
import threading
import time
import urllib.request
from datetime import date, timedelta

N = None  # wordt gezet door init(): verwijzing naar de nomad-module


def init(nomad_module):
    global N
    N = nomad_module


# ───────── instellingen ─────────

SETTING_KEYS = {
    "lang": "en", "accent": "green", "theme": "dark", "font_scale": 1.0,
    "update_check": True, "update_check_minutes": 30, "ai_model": "llama3.2:3b", "map_style": "color",
}


def get_settings():
    s = {k: N.CFG.get(k, v) for k, v in SETTING_KEYS.items()}
    s["autostart"] = autostart_enabled()
    s["autostart_supported"] = sys.platform.startswith("win")
    return s


def set_settings(new):
    changed = False
    for k, default in SETTING_KEYS.items():
        if k in new:
            v = new[k]
            if isinstance(default, bool):
                v = bool(v)
            elif isinstance(default, float):
                v = max(0.8, min(1.6, float(v)))
            elif isinstance(default, int):
                v = max(5, int(v))
            N.CFG[k] = v
            changed = True
    if "autostart" in new:
        set_autostart(bool(new["autostart"]))
    if changed:
        N.save_json(N.CONFIG_FILE, N.CFG)
    return get_settings()


# ───────── autostart (Windows) ─────────

def _startup_file():
    appdata = os.environ.get("APPDATA")
    if not appdata:
        return None
    return os.path.join(appdata, "Microsoft", "Windows", "Start Menu", "Programs", "Startup", "NOMAD-autostart.cmd")


def autostart_enabled():
    f = _startup_file()
    return bool(f and os.path.exists(f))


def set_autostart(on):
    f = _startup_file()
    if not f:
        return
    if on:
        exe = os.path.join(N.ROOT, "NOMAD.exe")
        # start alleen als de SSD er is (stationsletter kan veranderen: dan gewoon niets)
        with open(f, "w", encoding="utf-8") as h:
            h.write(f'@echo off\r\nif exist "{exe}" start "" "{exe}"\r\n')
    elif os.path.exists(f):
        os.remove(f)


# ───────── gebruikersdata ─────────

USER_FILE = None
USER_LOCK = threading.Lock()
DEFAULT_USER = {"favorites": [], "notes": {}, "pins": [], "chats": [], "saved": [], "checklist": [
    {"t": t, "done": False} for t in [
        "Water (3 L per person per day, 3 days)", "Non-perishable food for 3 days", "First aid kit",
        "Flashlight + spare batteries", "Power bank (charged)", "Battery / crank radio", "Cash",
        "Copies of important documents", "Medication for a week", "Warm clothing + blanket"]]}


def user_file():
    return os.path.join(N.DATA, "nomad-user.json")


def load_user():
    try:
        with open(user_file(), encoding="utf-8") as f:
            u = json.load(f)
    except Exception:
        u = {}
    for k, v in DEFAULT_USER.items():
        u.setdefault(k, json.loads(json.dumps(v)))
    return u


def save_user(patch):
    with USER_LOCK:
        u = load_user()
        for k in ("favorites", "notes", "pins", "checklist", "chats", "saved"):
            if k in patch:
                u[k] = patch[k]
        N.save_json(user_file(), u)
        return u


# ───────── opslag opruimen ─────────

def cleanup_items():
    dl = N.DL_DIR
    items = []

    def add(path, kind):
        try:
            items.append({"path": os.path.relpath(path, N.ROOT), "size": os.path.getsize(path), "kind": kind})
        except OSError:
            pass

    for f in glob.glob(os.path.join(dl, "old", "*")):
        add(f, "old")
    active = {os.path.basename(j.get("target", "")) + ".part" for j in N.STATE["jobs"].values()
              if j.get("status") in ("bezig", "wachtrij")}
    for f in glob.glob(os.path.join(dl, "*.part")):
        if os.path.basename(f) not in active and time.time() - os.path.getmtime(f) > 600:
            add(f, "partial")
    for pat in ("*.zip", "*.tar.gz", "*.log"):
        for f in glob.glob(os.path.join(dl, pat)):
            add(f, "installer")
    if os.path.isdir(os.path.join(N.GEO_DIR, "photon_data")):
        for f in glob.glob(os.path.join(dl, "photon-db-*.tar.bz2")):
            add(f, "archive")
    # dubbele .zim (oudere datum van dezelfde collectie)
    seen = {}
    for f in N.lib_zims():
        m = re.match(r"(.+)_(\d{4}-\d{2})\.zim$", os.path.basename(f))
        if m:
            seen.setdefault(m.group(1), []).append(f)
    for files in seen.values():
        for f in sorted(files)[:-1]:
            add(f, "old")
    return items


def cleanup(paths):
    allowed = {i["path"] for i in cleanup_items()}
    freed, done = 0, []
    for p in paths:
        if p not in allowed:
            continue
        full = os.path.join(N.ROOT, p)
        try:
            size = os.path.getsize(full)
            os.remove(full)
            freed += size
            done.append(p)
        except OSError:
            pass
    if any(p.startswith("data") for p in done):
        N.scan_library()
    return {"freed": freed, "removed": done}


# ───────── downloadcatalogus ─────────
import xml.etree.ElementTree as ET
from collections import deque

OPDS = "https://library.kiwix.org/catalog/v2/entries?count=-1"
NS = {"a": "http://www.w3.org/2005/Atom"}
CAT_CACHE = {"t": 0, "items": None}
QUEUE = deque()
QUEUE_LOCK = threading.Lock()
WORKER = {"running": False}

AI_MODELS = [
    ("gemma3:1b", "Gemma 3 1B", "Tiny & fast — basic answers", 0.8),
    ("llama3.2:1b", "Llama 3.2 1B", "Tiny & fast", 1.3),
    ("qwen3:1.7b", "Qwen 3 1.7B", "Small, good reasoning", 1.4),
    ("llama3.2:3b", "Llama 3.2 3B", "Default — good balance on CPU", 2.0),
    ("qwen3:4b", "Qwen 3 4B", "Smart for its size, multilingual (NL)", 2.5),
    ("phi4-mini", "Phi-4 mini 3.8B", "Strong at math & logic", 2.5),
    ("gemma3:4b", "Gemma 3 4B", "Multilingual · also recognises photos", 3.3),
    ("qwen2.5-coder:3b", "Qwen 2.5 Coder 3B", "Programming help", 1.9),
    ("mistral:7b", "Mistral 7B", "Larger, slower on CPU", 4.1),
    ("qwen3:8b", "Qwen 3 8B", "Best quality, needs 16 GB RAM", 5.2),
    ("deepseek-r1:7b", "DeepSeek R1 7B", "Thinks step by step (slow)", 4.7),
    ("moondream", "Moondream 2", "Vision · fast photo recognition on CPU", 1.7),
    ("qwen2.5vl:3b", "Qwen 2.5 VL 3B", "Vision · best at plants, objects & reading text in photos", 3.2),
    ("llava:7b", "LLaVA 7B", "Vision · describe photos (slow on CPU)", 4.7),
]


def _get(url, timeout=30):
    req = urllib.request.Request(url, headers={"User-Agent": "NOMAD/" + N.VERSION})
    with urllib.request.urlopen(req, timeout=timeout) as r:
        return r.read()


def _cache_file():
    return os.path.join(N.DL_DIR, "kiwix-catalog.json")


def kiwix_entries(force=False):
    """Alle Kiwix-collecties (±3600). Online opgehaald, offline uit cache."""
    if CAT_CACHE["items"] is not None and not force and time.time() - CAT_CACHE["t"] < 6 * 3600:
        return CAT_CACHE["items"]
    items = None
    if N.is_online():
        try:
            root = ET.fromstring(_get(OPDS, 120))
            items = []
            for e in root.findall("a:entry", NS):
                g = lambda k: (e.findtext("a:" + k, "", NS) or "").strip()
                acq = next((l for l in e.findall("a:link", NS) if l.get("type") == "application/x-zim"), None)
                if acq is None:
                    continue
                url = acq.get("href", "").replace(".meta4", "")
                file = url.rsplit("/", 1)[-1]
                m = re.match(r"(.+)_(\d{4}-\d{2})\.zim$", file)
                tags = g("tags")
                items.append({
                    "id": g("id").replace("urn:uuid:", ""), "title": g("title"), "summary": g("summary"),
                    "lang": g("language"), "name": g("name"), "flavour": g("flavour"), "cat": g("category") or "other",
                    "prefix": m.group(1) if m else file[:-4], "date": m.group(2) if m else g("updated")[:7],
                    "articles": int(g("articleCount") or 0), "size": int(acq.get("length") or 0),
                    "url": url, "file": file, "pictures": "_pictures:yes" in tags, "videos": "_videos:yes" in tags,
                })
            N.save_json(_cache_file(), items)
        except Exception as ex:
            print("catalogus ophalen mislukt:", ex)
            items = None
    if items is None:
        try:
            with open(_cache_file(), encoding="utf-8") as f:
                items = json.load(f)
        except Exception:
            items = []
    CAT_CACHE.update(t=time.time(), items=items)
    return items


def icon(uuid):
    """Pictogram van een collectie, één keer online ophalen en daarna lokaal bewaren."""
    if not re.fullmatch(r"[0-9a-f-]{36}", uuid or ""):
        return None
    d = os.path.join(N.DL_DIR, "icons")
    f = os.path.join(d, uuid + ".png")
    if os.path.exists(f):
        return open(f, "rb").read()
    if not N.STATE.get("online"):
        return None
    try:
        data = _get(f"https://library.kiwix.org/catalog/v2/illustration/{uuid}/?size=48", 10)
        os.makedirs(d, exist_ok=True)
        open(f, "wb").write(data)
        return data
    except Exception:
        return None


def _latest_protomaps():
    for i in range(0, 21):
        d = (date.today() - timedelta(days=i)).strftime("%Y%m%d")
        url = f"https://build.protomaps.com/{d}.pmtiles"
        try:
            req = urllib.request.Request(url, method="HEAD", headers={"User-Agent": "NOMAD"})
            with urllib.request.urlopen(req, timeout=8) as r:
                return url, int(r.headers.get("Content-Length") or 0), d
        except Exception:
            continue
    return None, 0, None


def extras():
    """Kaarten, adres zoeken en AI-modellen."""
    out = []
    online = N.is_online()
    url, size, d = _latest_protomaps() if online else (None, 125 << 30, None)
    out.append({"id": "map:world", "kind": "map", "cat": "maps", "title": "World map", "summary":
                "All streets, buildings and place names on Earth (OpenStreetMap via Protomaps).",
                "file": "world.pmtiles", "date": d or "", "size": size, "url": url,
                "installed": bool(N.map_file("world")), "target": os.path.join(N.MAP_DIR, "world", "world.pmtiles")})
    out.append({"id": "torrent:terrain", "kind": "torrent", "cat": "maps", "title": "Elevation & 3D terrain",
                "summary": "JAXA AW3D30 terrain (zoom 0-11). Only available as torrent: open it in qBittorrent, save to data\\maps\\terrain and rename to terrain.pmtiles.",
                "file": "terrain.pmtiles", "date": "2025", "size": int(90.9 * (1 << 30)),
                "url": "https://techidiots.net/downloads/open-base-map-torrents/pmtiles/jaxa_terrarium0-11/JAXA_AW3D30_2025_Terrarium_z0-Z11_cubic_webp_pmtiles.torrent",
                "installed": bool(N.map_file("terrain"))})
    out.append({"id": "geo:photon", "kind": "geo", "cat": "search", "title": "Address search (worldwide)",
                "summary": "Photon geocoder database: search any address or place on Earth. Unpacks and starts automatically.",
                "file": "photon-db-planet-1.0-latest.tar.bz2", "date": "weekly", "size": 66 << 30,
                "url": "https://download1.graphhopper.com/public/photon-db-planet-1.0-latest.tar.bz2",
                "installed": os.path.isdir(os.path.join(N.GEO_DIR, "photon_data")),
                "target": os.path.join(N.DL_DIR, "photon-db-planet-1.0-latest.tar.bz2")})
    import extra
    out += extra.route_items()
    have = set(N.ai_models()) if N.STATE.get("ai") == "aan" else set()
    for size, title, summ, gb in extra.WHISPER_SIZES:
        out.append({"id": "stt:" + size, "kind": "stt", "cat": "ai", "title": title + " · speech to text", "summary": summ + ". Talk instead of typing — works offline.",
                    "file": size, "date": "", "size": int(gb * (1 << 30)), "installed": extra.whisper_installed(size)})
    import fast
    out += fast.mt_items()
    for mid, title, summ, gb in AI_MODELS:
        out.append({"id": "ai:" + mid, "kind": "ai", "cat": "ai", "title": title, "summary": summ, "file": mid,
                    "date": "", "size": int(gb * (1 << 30)), "installed": mid in have or (mid + ":latest") in have,
                    "active": N.CFG.get("ai_model") == mid})
    return out


def catalog(force=False):
    items = kiwix_entries(force)
    inst = {b.prefix: b.date for b in N.BOOKS.values()}
    for i in items:
        i["installed"] = inst.get(i["prefix"])
    return {"online": N.STATE.get("online") or N.is_online(), "zim": items, "extras": extras(),
            "free": N.shutil.disk_usage(N.ROOT).free}


# ── wachtrij: downloads één voor één, de rest staat "in wachtrij" ──
def enqueue(item_id):
    jobs = N.STATE["jobs"]
    if item_id in jobs and jobs[item_id]["status"] in ("bezig", "wachtrij"):
        return {"ok": True}
    item = _find(item_id)
    if not item:
        return {"error": "unknown item"}
    if item.get("kind") == "torrent":
        return {"error": "torrent only"}
    free = N.shutil.disk_usage(N.ROOT).free
    if item.get("size") and item["size"] > free and item.get("kind") not in ("ai", "stt", "mt"):
        return {"error": "not enough free space"}
    jobs[item_id] = {"status": "wachtrij", "title": item["title"], "done": 0, "total": item.get("size", 0), "msg": "", "target": item.get("target", "")}
    with QUEUE_LOCK:
        QUEUE.append((item_id, item))
        if not WORKER["running"]:
            WORKER["running"] = True
            threading.Thread(target=_worker, daemon=True).start()
    return {"ok": True}


def _find(item_id):
    if item_id.startswith("zim:"):
        uid = item_id[4:]
        it = next((i for i in kiwix_entries() if i["id"] == uid), None)
        if it:
            return dict(it, kind="zim", target=os.path.join(N.LIB_DIR, it["file"]))
        return None
    return next((i for i in extras() if i["id"] == item_id), None)


def _worker():
    while True:
        with QUEUE_LOCK:
            if not QUEUE:
                WORKER["running"] = False
                return
            item_id, item = QUEUE.popleft()
        job = N.STATE["jobs"][item_id]
        if job.get("cancel"):
            job["status"] = "fout"
            job["msg"] = ""
            continue
        job["status"] = "bezig"
        try:
            kind = item["kind"]
            if kind == "ai":
                _pull_model(job, item["file"])
            elif kind == "mt":
                import fast
                fast.install_mt(job, item["file"])
            elif kind == "stt":
                import extra
                extra.install_whisper(job, item["file"])
            else:
                N.download(job, item["url"], item["target"])
                if kind == "zim":
                    old = [(b.path, b.file) for b in N.BOOKS.values() if b.prefix == item["prefix"] and b.file != item["file"]]
                    N.scan_library()
                    import gc
                    gc.collect()
                    for path, file in old:  # oude versie opzij zetten
                        oud = os.path.join(N.DL_DIR, "old")
                        os.makedirs(oud, exist_ok=True)
                        try:
                            os.replace(path, os.path.join(oud, file))
                        except OSError:
                            pass
                    N.scan_library()
                elif kind == "route":
                    import extra
                    extra.ensure_jar(job)
                    job["msg"] = "building route network (first time: 10-60 min)…"
                    port = N.CFG.get("route_port", 8989)
                    if N.port_open(port) and extra.ROUTE.get("proc"):
                        extra.ROUTE["proc"].terminate()
                        time.sleep(3)
                    threading.Thread(target=extra.start_route, daemon=True).start()
                elif kind == "geo":
                    job["msg"] = "unpacking… (can take an hour)"
                    subprocess.run(["tar", "-xjf", item["target"], "-C", N.GEO_DIR], check=True)
                    job["msg"] = "starting address search…"
                    threading.Thread(target=N.start_photon, daemon=True).start()
            job["status"] = "klaar"
            job["msg"] = ""
            CAT_CACHE["t"] = 0 if kind != "zim" else CAT_CACHE["t"]
        except Exception as e:
            job["status"] = "fout"
            job["msg"] = str(e)


def _pull_model(job, model):
    if N.STATE.get("ai") != "aan":
        N.start_ollama()
    req = urllib.request.Request(f"http://127.0.0.1:{N.CFG['ollama_port']}/api/pull",
                                 data=json.dumps({"model": model}).encode(), headers={"Content-Type": "application/json"})
    with urllib.request.urlopen(req, timeout=7200) as r:
        for line in r:
            if job.get("cancel"):
                raise RuntimeError("cancelled")
            try:
                m = json.loads(line)
            except Exception:
                continue
            if m.get("error"):
                raise RuntimeError(m["error"])
            job["msg"] = m.get("status", "")
            if m.get("total"):
                job["total"], job["done"] = m["total"], m.get("completed", 0)


def cancel(item_id):
    j = N.STATE["jobs"].get(item_id)
    if j:
        j["cancel"] = True
        if j["status"] == "wachtrij":
            j["status"] = "fout"
    return {"ok": True}


def remove(item_id):
    """Verwijdert een geïnstalleerde collectie of een AI-model (na bevestiging in de UI)."""
    if item_id.startswith("zim:"):
        it = _find(item_id)
        if not it:
            return {"error": "unknown"}
        paths = [b.path for b in N.BOOKS.values() if b.prefix == it["prefix"]]
        with N.BOOKS_LOCK:
            for k in [k for k, b in N.BOOKS.items() if b.prefix == it["prefix"]]:
                N.BOOKS.pop(k)
        import gc
        gc.collect()
        for p in paths:
            try:
                os.remove(p)
            except OSError as e:
                N.scan_library()
                return {"error": str(e)}
        N.scan_library()
        return {"ok": True}
    if item_id.startswith("ai:"):
        try:
            req = urllib.request.Request(f"http://127.0.0.1:{N.CFG['ollama_port']}/api/delete", method="DELETE",
                                         data=json.dumps({"model": item_id[3:]}).encode(), headers={"Content-Type": "application/json"})
            urllib.request.urlopen(req, timeout=30)
            return {"ok": True}
        except Exception as e:
            return {"error": str(e)}
    if item_id.startswith("mt:"):
        import fast
        return fast.remove_mt(item_id[3:])
    return {"error": "not removable"}


def use_model(model):
    N.CFG["ai_model"] = model
    N.save_json(N.CONFIG_FILE, N.CFG)
    return {"ok": True}


# ───────── bundels ─────────
BUNDLES = [
    {"id": "survival", "icon": "shield", "title": "Survival Essentials",
     "desc": "First aid, medicine, water, food, shelter, energy and repair — the core of an offline survival library.",
     "items": ["mdwiki_en_all_maxi", "wikipedia_en_medicine_maxi", "zimgit-medicine_en", "zimgit-water_en", "zimgit-food-preparation_en",
               "zimgit-post-disaster_en", "outdoors.stackexchange.com_en_all", "appropedia_en_all_maxi", "energypedia_en_all_maxi",
               "ifixit_en_all", "wikivoyage_en_all_maxi"]},
    {"id": "survival_xl", "icon": "archive", "title": "Survivor Library",
     "desc": "205 GB of historical how-to books: farming, blacksmithing, medicine, building, chemistry — rebuild-civilisation knowledge.",
     "items": ["survivorlibrary.com_en_all"]},
    {"id": "knowledge", "icon": "globe", "title": "World Knowledge",
     "desc": "Complete English Wikipedia with images, plus dictionary, quotes and source texts.",
     "items": ["wikipedia_en_all_maxi", "wiktionary_en_all_nopic", "wikiquote_en_all_maxi", "wikisource_en_all_nopic"]},
    {"id": "nederlands", "icon": "flag", "title": "Nederlands",
     "desc": "Nederlandse Wikipedia met afbeeldingen en Nederlandstalige boeken van Project Gutenberg.",
     "items": ["wikipedia_nl_all_maxi", "gutenberg_nl_all"]},
    {"id": "learning", "icon": "cap", "title": "Learning Lite",
     "desc": "Textbooks for maths, physics, chemistry, biology, engineering and medicine, plus interactive science simulations.",
     "items": ["libretexts.org_en_math", "libretexts.org_en_phys", "libretexts.org_en_chem", "libretexts.org_en_bio",
               "libretexts.org_en_eng", "libretexts.org_en_med", "phet_en_all", "wikibooks_en_all_maxi", "wikiversity_en_all_maxi"]},
    {"id": "school", "icon": "video", "title": "Video School",
     "desc": "Khan Academy (full US curriculum with videos) and CrashCourse — a complete school offline.",
     "items": ["khanacademy_en_all", "crashcourse_en_all"]},
    {"id": "maker", "icon": "wrench", "title": "Maker & Repair",
     "desc": "Repair guides and expert Q&A for electronics, DIY, gardening and cooking.",
     "items": ["ifixit_en_all", "electronics.stackexchange.com_en_all", "diy.stackexchange.com_en_all",
               "gardening.stackexchange.com_en_all", "cooking.stackexchange.com_en_all", "appropedia_en_all_maxi"]},
    {"id": "books", "icon": "book", "title": "Library of Books",
     "desc": "Project Gutenberg: ~70,000 free classic books, readable offline.",
     "items": ["gutenberg_en_all"]},
    {"id": "inspire", "icon": "play", "title": "Talks & Space",
     "desc": "Every TED talk as video, plus NASA's Astronomy Picture of the Day archive.",
     "items": ["ted_mul_all", "apod.nasa.gov_en_all"]},
    {"id": "coding", "icon": "code", "title": "Programming",
     "desc": "All of Stack Overflow plus documentation for Python, JavaScript, web, C/C++, Rust, Git, Docker and Godot.",
     "items": ["stackoverflow.com_en_all", "devdocs_en_python", "devdocs_en_javascript", "devdocs_en_html", "devdocs_en_css",
               "devdocs_en_node", "devdocs_en_react", "devdocs_en_git", "devdocs_en_bash", "devdocs_en_c", "devdocs_en_cpp",
               "devdocs_en_rust", "devdocs_en_docker", "devdocs_en_godot", "freecodecamp_en_all"]},
    {"id": "health", "icon": "heart", "title": "Health & Medicine",
     "desc": "Medical encyclopedias, medicine textbooks and practical medical library for when no doctor is available.",
     "items": ["mdwiki_en_all_maxi", "wikipedia_en_medicine_maxi", "libretexts.org_en_med", "zimgit-medicine_en"]},
    {"id": "homestead", "icon": "leaf", "title": "Homestead & Farming",
     "desc": "Grow food, preserve it, generate energy and build things yourself.",
     "items": ["gardening.stackexchange.com_en_all", "zimgit-food-preparation_en", "zimgit-water_en", "appropedia_en_all_maxi",
               "energypedia_en_all_maxi", "cooking.stackexchange.com_en_all", "outdoors.stackexchange.com_en_all"]},
    {"id": "kids", "icon": "play", "title": "Kids",
     "desc": "Child-friendly encyclopedia, picture books and interactive science simulations.",
     "items": ["vikidia_en_all_maxi", "wikipedia_en_100", "booksdash_en_all", "phet_en_all"]},
    {"id": "science", "icon": "globe", "title": "Science & Space",
     "desc": "Physics, chemistry and biology textbooks, simulations and NASA's astronomy archive.",
     "items": ["libretexts.org_en_phys", "libretexts.org_en_chem", "libretexts.org_en_bio", "phet_en_all", "apod.nasa.gov_en_all", "ted_mul_science"]},
    {"id": "travel", "icon": "compass", "title": "Travel",
     "desc": "Travel guides for every country and city, in English and Dutch.",
     "items": ["wikivoyage_en_all_maxi", "wikivoyage_nl_all_maxi", "wikivoyage_de_all_maxi"]},
    {"id": "navigation", "icon": "map", "title": "World Navigation",
     "desc": "World map, worldwide address search and 3D elevation.",
     "items": ["map:world", "geo:photon", "torrent:terrain"]},
    {"id": "routes_nl", "icon": "compass", "title": "Route Planning Benelux",
     "desc": "Turn-by-turn car, bike and walking directions for the Netherlands, Belgium and Luxembourg.",
     "items": ["route:netherlands"]},
    {"id": "ai", "icon": "cpu", "title": "AI Brains",
     "desc": "Two local AI models: a fast default and a smarter multilingual one (speaks Dutch well).",
     "items": ["ai:llama3.2:3b", "ai:qwen3:4b"]},
]


def bundles():
    zims = {i["prefix"]: i for i in kiwix_entries()}
    inst = {b.prefix: b.date for b in N.BOOKS.values()}
    ext = {i["id"]: i for i in extras()}
    out = []
    for b in BUNDLES:
        items = []
        for p in b["items"]:
            if ":" in p and p.split(":")[0] in ("map", "geo", "torrent", "ai", "route"):
                e = ext.get(p)
                if e:
                    items.append({"id": p, "title": e["title"], "size": e["size"], "installed": bool(e["installed"]), "kind": e["kind"]})
            else:
                z = zims.get(p)
                if z:
                    items.append({"id": "zim:" + z["id"], "title": z["title"] + (" (" + z["flavour"] + ")" if z.get("flavour") else ""),
                                  "size": z["size"], "installed": bool(inst.get(p)), "kind": "zim", "summary": z["summary"]})
        if items:
            total = sum(i["size"] for i in items)
            need = sum(i["size"] for i in items if not i["installed"])
            out.append(dict(b, items=items, total=total, need=need, complete=need == 0))
    du = N.shutil.disk_usage(N.ROOT)
    nomad = sum(b.size for b in N.BOOKS.values()) + sum(os.path.getsize(f) for f in [N.map_file(l) for l in N.MAP_LAYERS] if f)
    return {"bundles": out, "disk": {"total": du.total, "used": du.used, "free": du.free, "nomad": nomad},
            "queued": sum(max(0, j.get("total", 0) - j.get("done", 0)) for j in N.STATE["jobs"].values() if j["status"] in ("bezig", "wachtrij"))}


def enqueue_many(ids):
    res = {"ok": [], "errors": []}
    for i in ids:
        r = enqueue(i)
        (res["ok"] if r.get("ok") else res["errors"]).append(i if r.get("ok") else f"{i}: {r.get('error')}")
    return res
