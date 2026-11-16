"""NOMAD v0.8: bestandsbeheer, route plannen (GraphHopper), online kaartvoorbeeld, feitje van de dag."""
import json
import os
import re
import shutil
import subprocess
import threading
import time
import urllib.parse
import urllib.request

N = None


def init(nomad_module):
    global N
    N = nomad_module


# ───────── bestandsbeheer ─────────
PROTECTED = ("app", "tools")          # niet verwijderen/hernoemen vanuit de app
TEXT_EXT = {".txt", ".md", ".json", ".csv", ".log", ".ini", ".cfg", ".yml", ".yaml", ".xml", ".html", ".css", ".js", ".py", ".bat", ".ps1", ".gpx", ".geojson"}


def safe(rel):
    rel = (rel or "").replace("\\", "/").strip("/")
    full = os.path.normpath(os.path.join(N.ROOT, rel))
    if full != N.ROOT and not full.startswith(N.ROOT + os.sep):
        raise PermissionError("outside NOMAD")
    return full, rel


def protected(rel):
    top = rel.split("/")[0] if rel else ""
    return top in PROTECTED or rel == ""


def fs_list(rel):
    full, rel = safe(rel)
    items = []
    with os.scandir(full) as it:
        for e in it:
            try:
                st = e.stat()
                items.append({"name": e.name, "dir": e.is_dir(), "size": 0 if e.is_dir() else st.st_size,
                              "mtime": int(st.st_mtime), "ext": os.path.splitext(e.name)[1].lower()})
            except OSError:
                pass
    items.sort(key=lambda x: (not x["dir"], x["name"].lower()))
    return {"path": rel, "items": items, "protected": protected(rel)}


def fs_read(rel):
    full, rel = safe(rel)
    if os.path.getsize(full) > 2 << 20:
        return {"error": "file too large to edit (max 2 MB)"}
    with open(full, "rb") as f:
        raw = f.read()
    try:
        return {"path": rel, "content": raw.decode("utf-8")}
    except UnicodeDecodeError:
        return {"error": "not a text file"}


def fs_write(rel, content):
    full, rel = safe(rel)
    if rel.startswith("tools/"):
        return {"error": "protected folder"}
    tmp = full + ".tmp"
    with open(tmp, "w", encoding="utf-8", newline="") as f:
        f.write(content)
    os.replace(tmp, full)
    return {"ok": True}


def fs_mkdir(rel):
    full, rel = safe(rel)
    os.makedirs(full, exist_ok=True)
    return {"ok": True}


def fs_rename(rel, new_name):
    full, rel = safe(rel)
    if protected(rel) or "/" in new_name or "\\" in new_name or not new_name.strip():
        return {"error": "not allowed"}
    dest = os.path.join(os.path.dirname(full), new_name.strip())
    if os.path.exists(dest):
        return {"error": "name already exists"}
    os.rename(full, dest)
    return {"ok": True}


def fs_delete(rel):
    full, rel = safe(rel)
    if protected(rel) or rel.split("/")[0] in ("data", "ai", "downloads") and rel.count("/") == 0:
        return {"error": "not allowed"}
    if os.path.isdir(full):
        shutil.rmtree(full)
    else:
        os.remove(full)
    return {"ok": True}


def fs_upload(rel_dir, name, stream, length):
    full, rel = safe(rel_dir)
    if "/" in name or "\\" in name:
        return {"error": "bad name"}
    dest = os.path.join(full, name)
    left = length
    with open(dest + ".part", "wb") as f:
        while left > 0:
            chunk = stream.read(min(1 << 20, left))
            if not chunk:
                break
            f.write(chunk)
            left -= len(chunk)
    os.replace(dest + ".part", dest)
    return {"ok": True}


# ───────── online kaartvoorbeeld ─────────
PREVIEW = {"url": None, "t": 0}


def preview_url():
    if PREVIEW["url"] and time.time() - PREVIEW["t"] < 6 * 3600:
        return PREVIEW["url"]
    from datetime import date, timedelta
    for i in range(0, 14):
        d = (date.today() - timedelta(days=i)).strftime("%Y%m%d")
        u = f"https://build.protomaps.com/{d}.pmtiles"
        try:
            req = urllib.request.Request(u, headers={"User-Agent": "NOMAD", "Range": "bytes=0-1"})
            with urllib.request.urlopen(req, timeout=8):
                PREVIEW.update(url=u, t=time.time())
                return u
        except Exception:
            continue
    return None


def proxy_range(handler, url):
    rng = handler.headers.get("Range") or "bytes=0-"
    req = urllib.request.Request(url, headers={"User-Agent": "NOMAD", "Range": rng})
    with urllib.request.urlopen(req, timeout=30) as r:
        data = r.read()
        handler.send_response(r.status)
        for h in ("Content-Range", "Content-Type"):
            if r.headers.get(h):
                handler.send_header(h, r.headers.get(h))
        handler.send_header("Content-Length", str(len(data)))
        handler.send_header("Accept-Ranges", "bytes")
        handler.end_headers()
        handler.wfile.write(data)


# ───────── route plannen (GraphHopper) ─────────
REGIONS = [
    ("netherlands", "Netherlands", "europe/netherlands", 1.4),
    ("belgium", "Belgium", "europe/belgium", 0.65),
    ("luxembourg", "Luxembourg", "europe/luxembourg", 0.05),
    ("germany", "Germany", "europe/germany", 4.4),
    ("france", "France", "europe/france", 4.6),
    ("great-britain", "Great Britain", "europe/great-britain", 2.0),
    ("spain", "Spain", "europe/spain", 1.4),
    ("italy", "Italy", "europe/italy", 2.0),
    ("norway", "Norway", "europe/norway", 1.3),
    ("sweden", "Sweden", "europe/sweden", 0.75),
]
ROUTE = {"state": "uit", "region": None, "proc": None}
ENCODED = ["car_access", "car_average_speed", "bike_access", "bike_priority", "bike_average_speed",
           "foot_access", "foot_priority", "foot_average_speed", "road_class", "road_environment", "max_speed",
           "roundabout", "road_access", "hike_rating", "mtb_rating", "average_slope", "ferry_speed"]


def route_dir():
    return os.path.join(N.DATA, "route")


def route_items():
    out = []
    installed = installed_region()
    for rid, name, path, gb in REGIONS:
        pbf = os.path.join(route_dir(), rid + ".osm.pbf")
        out.append({"id": "route:" + rid, "kind": "route", "cat": "routing", "title": f"Route planning · {name}",
                    "summary": f"Car, bike and walking routes in {name}. Downloads OpenStreetMap data, then builds the route network once (takes a while, then instant).",
                    "file": rid + ".osm.pbf", "date": "daily", "size": int(gb * 1.6 * (1 << 30)),
                    "url": f"https://download.geofabrik.de/{path}-latest.osm.pbf", "installed": os.path.exists(pbf),
                    "active": installed == rid, "target": pbf})
    return out


def installed_region():
    d = route_dir()
    if not os.path.isdir(d):
        return None
    pbfs = sorted([f for f in os.listdir(d) if f.endswith(".osm.pbf")], key=lambda f: os.path.getmtime(os.path.join(d, f)))
    return pbfs[-1][:-8] if pbfs else None


def gh_jar():
    d = os.path.join(N.TOOLS, "graphhopper")
    jars = sorted(f for f in os.listdir(d) if f.endswith(".jar")) if os.path.isdir(d) else []
    return os.path.join(d, jars[-1]) if jars else None


def ensure_jar(job=None):
    if gh_jar():
        return gh_jar()
    d = os.path.join(N.TOOLS, "graphhopper")
    os.makedirs(d, exist_ok=True)
    rel = json.loads(urllib.request.urlopen(urllib.request.Request(
        "https://api.github.com/repos/graphhopper/graphhopper/releases/latest", headers={"User-Agent": "NOMAD"}), timeout=20).read())
    asset = next(a for a in rel["assets"] if re.match(r"graphhopper-web-[\d.]+\.jar$", a["name"]))
    if job:
        job["msg"] = "downloading route engine…"
    N.download(job or {}, asset["browser_download_url"], os.path.join(d, asset["name"]))
    return gh_jar()


def write_config(region, encoded):
    d = route_dir()
    cfg = os.path.join(d, "gh-config.yml")
    pbf = os.path.join(d, region + ".osm.pbf").replace("\\", "/")
    graph = os.path.join(d, "graph-" + region).replace("\\", "/")
    with open(cfg, "w", encoding="utf-8") as f:
        f.write(f"""graphhopper:
  datareader.file: {pbf}
  graph.location: {graph}
  profiles:
    - name: car
      custom_model_files: [car.json]
    - name: bike
      custom_model_files: [bike.json]
    - name: foot
      custom_model_files: [foot.json]
  profiles_ch:
    - profile: car
  graph.encoded_values: {", ".join(encoded)}
  import.osm.ignored_highways: ""
  prepare.min_network_size: 200
server:
  application_connectors:
    - type: http
      port: {N.CFG.get("route_port", 8989)}
      bind_host: localhost
  admin_connectors:
    - type: http
      port: {N.CFG.get("route_port", 8989) + 1}
      bind_host: localhost
""")
    return cfg


def start_route():
    port = N.CFG.get("route_port", 8989)
    if N.port_open(port):
        ROUTE["state"] = "aan"
        return
    region = installed_region()
    java = N.photon_paths()[0]
    jar = gh_jar()
    if not region:
        ROUTE["state"] = "geen data"
        return
    if not (java and jar):
        ROUTE["state"] = "niet geïnstalleerd"
        return
    ROUTE.update(region=region, state="opstarten")
    encoded = list(ENCODED)
    log_path = os.path.join(N.DL_DIR, "route.log")
    for attempt in range(8):
        cfg = write_config(region, encoded)
        log = open(log_path, "w")
        p = subprocess.Popen([java, "-Xmx" + N.CFG.get("route_heap", "6g"), "-jar", jar, "server", cfg], cwd=route_dir(),
                             stdout=log, stderr=log, creationflags=getattr(subprocess, "CREATE_NO_WINDOW", 0))
        ROUTE["proc"] = p
        N.PROCS["route"] = p
        while p.poll() is None:
            if N.port_open(port):
                ROUTE["state"] = "aan"
                return
            time.sleep(2)
            ROUTE["state"] = "bouwen"  # eerste keer: netwerk wordt opgebouwd
        txt = open(log_path, encoding="utf-8", errors="replace").read()
        m = re.findall(r"[Ee]ncoded value[s]? ['\"]?([a-z_]+)['\"]? (?:not found|is missing|missing)", txt) or \
            re.findall(r"Cannot find encoded value '([a-z_]+)'", txt) or re.findall(r"No encoded value found for '([a-z_]+)'", txt)
        bad = re.findall(r"[Uu]nknown encoded value[s]?:? ['\"]?([a-z_]+)", txt)
        changed = False
        for v in m:
            if v not in encoded:
                encoded.append(v)
                changed = True
        for v in bad:
            if v in encoded:
                encoded.remove(v)
                changed = True
        if not changed:
            break
    ROUTE["state"] = "start niet"


def route(frm, to, mode):
    port = N.CFG.get("route_port", 8989)
    q = urllib.parse.urlencode([("point", frm), ("point", to), ("profile", mode), ("points_encoded", "false"),
                                ("instructions", "true"), ("locale", "nl" if N.CFG.get("lang") == "nl" else "en")])
    with urllib.request.urlopen(f"http://127.0.0.1:{port}/route?{q}", timeout=30) as r:
        return json.loads(r.read())


# ───────── feitje van de dag ─────────
def fact():
    b = N.wikipedia_book() or next(iter(N.BOOKS.values()), None)
    if not b:
        return {}
    for _ in range(8):
        with b.lock:
            e = b.archive.get_random_entry()
            while e.is_redirect:
                e = e.get_redirect_entry()
            try:
                if not e.get_item().mimetype.startswith("text/html"):
                    continue
            except Exception:
                continue
        txt = N.plain_text(b, e.path, 400)
        if len(txt) > 80:
            first = re.split(r"(?<=[.!?])\s", txt)[0][:260]
            return {"book": b.id, "path": e.path, "title": e.title, "text": first}
    return {}


# ───────── spraak naar tekst (Whisper, offline) ─────────
WHISPER = {"model": None, "size": None, "lock": threading.Lock()}
WHISPER_SIZES = [("tiny", "Whisper Tiny", "Fastest, basic accuracy", 0.08), ("base", "Whisper Base", "Fast, good for clear speech (recommended)", 0.15),
                 ("small", "Whisper Small", "More accurate, slower on CPU", 0.5)]


def whisper_dir():
    return os.path.join(N.ROOT, "ai", "whisper")


def whisper_installed(size=None):
    d = whisper_dir()
    if not os.path.isdir(d):
        return [] if size is None else False
    have = [s for s, *_ in WHISPER_SIZES if os.path.isdir(os.path.join(d, f"models--Systran--faster-whisper-{s}"))]
    return have if size is None else size in have


def install_whisper(job, size):
    import sys as _s
    job["msg"] = "installing speech engine (faster-whisper)…"
    r = subprocess.run([_s.executable, "-m", "pip", "install", "--quiet", "faster-whisper"], capture_output=True, text=True,
                       creationflags=getattr(subprocess, "CREATE_NO_WINDOW", 0))
    if r.returncode != 0:
        raise RuntimeError("pip: " + (r.stderr or r.stdout)[-300:])
    job["msg"] = f"downloading Whisper {size} model…"
    from faster_whisper import WhisperModel
    os.makedirs(whisper_dir(), exist_ok=True)
    WhisperModel(size, device="cpu", compute_type="int8", download_root=whisper_dir())
    N.CFG["whisper"] = size
    N.save_json(N.CONFIG_FILE, N.CFG)


def stt(audio_bytes):
    have = whisper_installed()
    if not have:
        return {"error": "Speech recognition is not installed (Downloads → AI models → Whisper)."}
    size = N.CFG.get("whisper") if N.CFG.get("whisper") in have else have[-1]
    import tempfile
    with WHISPER["lock"]:
        if WHISPER["model"] is None or WHISPER["size"] != size:
            from faster_whisper import WhisperModel
            WHISPER["model"] = WhisperModel(size, device="cpu", compute_type="int8", download_root=whisper_dir())
            WHISPER["size"] = size
        with tempfile.NamedTemporaryFile(suffix=".webm", delete=False) as f:
            f.write(audio_bytes)
            path = f.name
        try:
            segs, info = WHISPER["model"].transcribe(path, beam_size=1, vad_filter=True)
            text = " ".join(s.text.strip() for s in segs).strip()
        finally:
            os.remove(path)
    return {"text": text, "lang": info.language}


# ───────── vertalen (lokale AI) ─────────
LANGNAMES = {"en": "English", "nl": "Dutch", "de": "German", "fr": "French", "es": "Spanish", "it": "Italian", "pt": "Portuguese",
             "pl": "Polish", "tr": "Turkish", "ar": "Arabic", "uk": "Ukrainian", "ru": "Russian", "zh": "Chinese", "ja": "Japanese"}


def translate_stream(handler, body):
    port = N.CFG["ollama_port"]
    if not N.port_open(port):
        return handler.json({"error": "AI is off — translation uses the local AI model."}, 503)
    src, dst, text = body.get("from", "auto"), body.get("to", "en"), body.get("text", "")
    system = ("You are a professional translator. Translate the user's text " +
              ("" if src == "auto" else f"from {LANGNAMES.get(src, src)} ") + f"into {LANGNAMES.get(dst, dst)}. "
              "Keep the meaning, tone and formatting. Output ONLY the translation, no explanations, no quotes.")
    model = N.CFG.get("translate_model") or N.CFG["ai_model"]
    payload = {"model": model, "stream": True, "options": {"temperature": 0.2},
               "messages": [{"role": "system", "content": system}, {"role": "user", "content": text}]}
    if "qwen3" in model:
        payload["think"] = False
    req = urllib.request.Request(f"http://127.0.0.1:{port}/api/chat", data=json.dumps(payload).encode(),
                                 headers={"Content-Type": "application/json"})
    handler.send_response(200)
    handler.send_header("Content-Type", "application/x-ndjson; charset=utf-8")
    handler.send_header("Cache-Control", "no-store")
    handler.send_header("Connection", "close")
    handler.end_headers()
    handler.close_connection = True
    try:
        with urllib.request.urlopen(req, timeout=600) as r:
            for line in r:
                try:
                    m = json.loads(line)
                except Exception:
                    continue
                piece = (m.get("message") or {}).get("content", "")
                if piece:
                    handler.wfile.write((json.dumps({"t": piece}) + "\n").encode())
                    handler.wfile.flush()
    except Exception as e:
        handler.wfile.write((json.dumps({"error": str(e)}) + "\n").encode())
