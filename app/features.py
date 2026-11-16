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
    "update_check": True, "update_check_minutes": 30, "ai_model": "llama3.2:3b",
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
        bat = os.path.join(N.ROOT, "Start NOMAD.bat")
        # start alleen als de SSD er is (stationsletter kan veranderen: dan gewoon niets)
        with open(f, "w", encoding="utf-8") as h:
            h.write(f'@echo off\r\nif exist "{bat}" start "NOMAD" /min cmd /c ""{bat}" --no-browser"\r\n')
    elif os.path.exists(f):
        os.remove(f)


# ───────── gebruikersdata ─────────

USER_FILE = None
USER_LOCK = threading.Lock()
DEFAULT_USER = {"favorites": [], "notes": {}, "pins": [], "checklist": [
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
        for k in ("favorites", "notes", "pins", "checklist"):
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

    for f in glob.glob(os.path.join(dl, "oud", "*")):
        add(f, "old")
    for f in glob.glob(os.path.join(dl, "*.part")):
        add(f, "partial")
    for pat in ("*.zip", "*.tar.gz", "*.log"):
        for f in glob.glob(os.path.join(dl, pat)):
            add(f, "installer")
    if os.path.isdir(os.path.join(N.GEO_DIR, "photon_data")):
        for f in glob.glob(os.path.join(dl, "photon-db-*.tar.bz2")):
            add(f, "archive")
    # dubbele .zim (oudere datum van dezelfde collectie)
    seen = {}
    for f in sorted(glob.glob(os.path.join(N.LIB_DIR, "*.zim"))):
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

KIWIX = "https://download.kiwix.org/zim/"
CATALOG = [
    # id, map, prefix, categorie, titel
    ("wikipedia_en_all_maxi", "wikipedia", "encyclopedia", "Wikipedia (English, with images)"),
    ("wikipedia_en_all_nopic", "wikipedia", "encyclopedia", "Wikipedia (English, no images)"),
    ("wikipedia_nl_all_maxi", "wikipedia", "encyclopedia", "Wikipedia (Nederlands)"),
    ("wiktionary_en_all_maxi", "wiktionary", "dictionary", "Wiktionary (English)"),
    ("gutenberg_en_all", "gutenberg", "books", "Project Gutenberg (~70k books)"),
    ("wikibooks_en_all_maxi", "wikibooks", "learning", "Wikibooks"),
    ("wikiversity_en_all_maxi", "wikiversity", "learning", "Wikiversity"),
    ("ifixit_en_all", "ifixit", "repair", "iFixit repair guides"),
    ("mdwiki_en_all_maxi", "other", "medical", "WikiMed / mdwiki (medical)"),
    ("wikivoyage_en_all_maxi", "wikivoyage", "travel", "Wikivoyage travel guide"),
    ("electronics.stackexchange.com_en_all", "stack_exchange", "q&a", "Electronics Stack Exchange"),
    ("diy.stackexchange.com_en_all", "stack_exchange", "q&a", "DIY / Home Improvement SE"),
    ("cooking.stackexchange.com_en_all", "stack_exchange", "q&a", "Cooking Stack Exchange"),
    ("gardening.stackexchange.com_en_all", "stack_exchange", "q&a", "Gardening Stack Exchange"),
    ("outdoors.stackexchange.com_en_all", "stack_exchange", "q&a", "Outdoors Stack Exchange"),
    ("phet_en_all", "phet", "learning", "PhET science simulations"),
]
CAT_CACHE = {"t": 0, "items": None}
LISTINGS = {}
SIZE_RE = r'href="(%s_(\d{4}-\d{2})\.zim)"[^>]*>[^<]*</a>\s*([\d-]+ [\d:]+)?\s*([\d.]+[KMGT]?)'


def _get(url, timeout=20):
    req = urllib.request.Request(url, headers={"User-Agent": "NOMAD/" + N.VERSION})
    with urllib.request.urlopen(req, timeout=timeout) as r:
        return r.read().decode("utf-8", "replace")


def _size_bytes(s):
    if not s:
        return 0
    mult = {"K": 1 << 10, "M": 1 << 20, "G": 1 << 30, "T": 1 << 40}
    return int(float(s[:-1]) * mult[s[-1]]) if s[-1] in mult else int(float(s))


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


def catalog(force=False):
    if CAT_CACHE["items"] is not None and not force and time.time() - CAT_CACHE["t"] < 3600:
        return CAT_CACHE["items"]
    if not N.is_online():
        return {"online": False, "items": []}
    installed = {b.prefix: b.date for b in N.BOOKS.values()}
    items = []
    for prefix, d, cat, title in CATALOG:
        try:
            if d not in LISTINGS:
                LISTINGS[d] = _get(KIWIX + d + "/")
            hits = re.findall(SIZE_RE % re.escape(prefix), LISTINGS[d])
        except Exception:
            hits = []
        if not hits:
            continue
        name, dt, _, size = max(hits, key=lambda h: h[1])
        items.append({"id": "zim:" + prefix, "kind": "library", "cat": cat, "title": title, "file": name,
                      "date": dt, "size": _size_bytes(size), "url": KIWIX + d + "/" + name,
                      "installed": installed.get(prefix), "target": os.path.join(N.LIB_DIR, name)})
    url, size, d = _latest_protomaps()
    world = N.map_file("world")
    if url:
        items.append({"id": "map:world", "kind": "map", "cat": "map", "title": "World map (Protomaps / OpenStreetMap)",
                      "file": "world.pmtiles", "date": d, "size": size, "url": url,
                      "installed": "yes" if world else None,
                      "target": os.path.join(N.MAP_DIR, "basis", "world.pmtiles")})
    items.append({"id": "geo:photon", "kind": "geo", "cat": "search", "title": "Address search database (Photon, planet)",
                  "file": "photon-db-planet-1.0-latest.tar.bz2", "date": "weekly", "size": 66 << 30,
                  "url": "https://download1.graphhopper.com/public/photon-db-planet-1.0-latest.tar.bz2",
                  "installed": "yes" if os.path.isdir(os.path.join(N.GEO_DIR, "photon_data")) else None,
                  "target": os.path.join(N.DL_DIR, "photon-db-planet-1.0-latest.tar.bz2")})
    items.append({"id": "torrent:terrain", "kind": "torrent", "cat": "map", "title": "Elevation / 3D terrain (JAXA, torrent only)",
                  "file": "terrain.pmtiles", "date": "2025", "size": int(90.9 * (1 << 30)),
                  "url": "https://techidiots.net/downloads/open-base-map-torrents/pmtiles/jaxa_terrarium0-11/JAXA_AW3D30_2025_Terrarium_z0-Z11_cubic_webp_pmtiles.torrent",
                  "installed": "yes" if N.map_file("terrain") else None})
    res = {"online": True, "items": items}
    CAT_CACHE.update(t=time.time(), items=res)
    return res


def start_download(item_id):
    cat = CAT_CACHE["items"] or catalog()
    item = next((i for i in cat.get("items", []) if i["id"] == item_id), None)
    if not item or item["kind"] == "torrent":
        return {"error": "not downloadable"}
    jobs = N.STATE["jobs"]
    if item_id in jobs and jobs[item_id]["status"] == "bezig":
        return {"ok": True}
    free = N.shutil.disk_usage(N.ROOT).free
    part = os.path.join(N.DL_DIR, os.path.basename(item["target"]) + ".part")
    have = os.path.getsize(part) if os.path.exists(part) else 0
    if item["size"] and item["size"] - have > free:
        return {"error": "not enough free space"}
    job = {"status": "bezig", "title": item["title"], "done": 0, "total": item["size"], "msg": ""}
    jobs[item_id] = job

    def work():
        try:
            N.download(job, item["url"], item["target"])
            if item["kind"] == "library":
                N.scan_library()
            elif item["kind"] == "geo":
                job["msg"] = "extracting…"
                subprocess.run(["tar", "-xjf", item["target"], "-C", N.GEO_DIR], check=True)
                job["msg"] = "extracted — restart NOMAD"
            job["status"] = "klaar"
            CAT_CACHE["t"] = 0
        except Exception as e:
            job["status"] = "fout"
            job["msg"] = str(e)

    threading.Thread(target=work, daemon=True).start()
    return {"ok": True}


def cancel_download(item_id):
    j = N.STATE["jobs"].get(item_id)
    if j:
        j["cancel"] = True
    return {"ok": True}
