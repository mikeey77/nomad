"""NOMAD v0.13: GPX tracks, backups of your own data, photo → text (for translating signs/menus),
article images, and small performance helpers."""
import datetime as _dt
import glob
import json
import math
import os
import re
import threading
import time
import urllib.request
import xml.etree.ElementTree as ET
from collections import OrderedDict
from urllib.parse import unquote, urljoin

import sys as _sys

# use the running server module (nomad.py runs as __main__), not a second copy of it
N = _sys.modules['__main__'] if hasattr(_sys.modules.get('__main__'), 'STATE') else __import__('nomad')
import features


# ───────── small LRU cache for search/suggest results ─────────
class LRU:
    def __init__(self, n=400):
        self.n, self.d, self.lock = n, OrderedDict(), threading.Lock()

    def get(self, k):
        with self.lock:
            if k in self.d:
                self.d.move_to_end(k)
                return self.d[k]
        return None

    def put(self, k, v):
        with self.lock:
            self.d[k] = v
            self.d.move_to_end(k)
            while len(self.d) > self.n:
                self.d.popitem(last=False)

    def clear(self):
        with self.lock:
            self.d.clear()


SEARCH_CACHE = LRU()


# ───────── re-usable file handles for map tiles (no open() per tile; closed after 60 s idle) ─────────
_FH = {}
_FH_LOCK = threading.Lock()


def read_range(path, start, length):
    with _FH_LOCK:
        ent = _FH.get(path)
        if ent is None:
            ent = _FH[path] = [open(path, "rb"), threading.Lock(), time.time()]
        ent[2] = time.time()
        now = ent[2]
        for k in [k for k, v in _FH.items() if now - v[2] > 60 and k != path]:
            try:
                _FH.pop(k)[0].close()
            except Exception:
                pass
    with ent[1]:
        ent[0].seek(start)
        return ent[0].read(length)


def close_handles():
    with _FH_LOCK:
        for v in _FH.values():
            try:
                v[0].close()
            except Exception:
                pass
        _FH.clear()


# ───────── article image (for "did you know" on Home) ─────────
IMG_RE = re.compile(r"<img[^>]+src=[\"']([^\"']+)[\"'][^>]*>", re.I)


def first_image(book, path):
    try:
        with book.lock:
            e = N.resolve(book, path)
            html = bytes(e.get_item().content).decode("utf-8", "replace")
        for m in IMG_RE.finditer(html):
            tag, src = m.group(0), m.group(1)
            if src.startswith(("data:", "http")) or re.search(r"(icon|logo|flag|svg|\.gif)", src, re.I):
                continue
            w = re.search(r"width=[\"']?(\d+)", tag)
            if w and int(w.group(1)) < 120:
                continue
            full = unquote(urljoin("http://z/" + path, src)[len("http://z/"):])
            return f"/lib/{book.id}/{full}"
    except Exception:
        pass
    return None


# ───────── photo → text (read signs, menus, labels) ─────────
def ocr(image_b64):
    import fast
    vm = fast.vision_model()
    if not vm:
        return {"error": "No photo model installed. Download Qwen 2.5 VL 3B (best for text) or Moondream 2 in Downloads → AI models."}
    payload = {"model": vm, "stream": False, "keep_alive": "30m", "options": {"temperature": 0},
               "messages": [{"role": "user", "images": [image_b64.split(",", 1)[-1]],
                             "content": "Transcribe all readable text in this image exactly as written, line by line, "
                                        "in its original language. Output only the text, nothing else."}]}
    req = urllib.request.Request(f"http://127.0.0.1:{N.CFG['ollama_port']}/api/chat", data=json.dumps(payload).encode(),
                                 headers={"Content-Type": "application/json"})
    with urllib.request.urlopen(req, timeout=600) as r:
        txt = (json.loads(r.read()).get("message") or {}).get("content", "").strip()
    txt = re.sub(r"^```\w*\n?|```$", "", txt).strip()
    return {"text": txt, "model": vm}


# ───────── GPX tracks ─────────
def tracks_dir():
    d = os.path.join(N.DATA, "tracks")
    os.makedirs(d, exist_ok=True)
    return d


def _hav(a, b):
    r = 6371000
    p1, p2 = math.radians(a[1]), math.radians(b[1])
    dp, dl = p2 - p1, math.radians(b[0] - a[0])
    h = math.sin(dp / 2) ** 2 + math.cos(p1) * math.cos(p2) * math.sin(dl / 2) ** 2
    return 2 * r * math.asin(math.sqrt(h))


def parse_gpx(text):
    root = ET.fromstring(text)
    tag = lambda el: el.tag.split("}")[-1]
    lines, points, name = [], [], None
    for el in root.iter():
        t = tag(el)
        if t == "name" and name is None and el.text:
            name = el.text.strip()
        if t in ("trkseg", "rte"):
            seg = [[float(p.get("lon")), float(p.get("lat"))] + ([float(c.text)] if (c := next((c for c in p if tag(c) == "ele"), None)) is not None and c.text else [])
                   for p in el if tag(p) in ("trkpt", "rtept")]
            if len(seg) > 1:
                lines.append(seg)
        if t == "wpt":
            nm = next((c.text for c in el if tag(c) == "name"), "") or ""
            points.append({"lon": float(el.get("lon")), "lat": float(el.get("lat")), "name": nm})
    dist = sum(_hav(s[i], s[i + 1]) for s in lines for i in range(len(s) - 1))
    up = sum(max(0, s[i + 1][2] - s[i][2]) for s in lines for i in range(len(s) - 1) if len(s[i]) > 2 and len(s[i + 1]) > 2)
    allc = [c for s in lines for c in s] + [[p["lon"], p["lat"]] for p in points]
    bbox = [min(c[0] for c in allc), min(c[1] for c in allc), max(c[0] for c in allc), max(c[1] for c in allc)] if allc else None
    return {"name": name, "lines": [[c[:2] for c in s] for s in lines], "points": points,
            "km": round(dist / 1000, 2), "climb": round(up), "bbox": bbox}


def tracks():
    out = []
    for f in sorted(glob.glob(os.path.join(tracks_dir(), "*.gpx")), key=os.path.getmtime, reverse=True):
        try:
            with open(f, encoding="utf-8", errors="replace") as fh:
                t = parse_gpx(fh.read())
            t["file"] = os.path.basename(f)
            t["name"] = t["name"] or t["file"][:-4]
            out.append(t)
        except Exception as e:
            out.append({"file": os.path.basename(f), "name": os.path.basename(f), "error": str(e), "lines": [], "points": []})
    return out


def safe_name(n):
    n = re.sub(r"[^\w\- .]+", "_", n).strip(" .")[:80] or "track"
    return n if n.lower().endswith(".gpx") else n + ".gpx"


def track_save(name, text):
    parse_gpx(text)  # validate
    p = os.path.join(tracks_dir(), safe_name(name))
    with open(p, "w", encoding="utf-8") as f:
        f.write(text)
    return {"ok": True, "file": os.path.basename(p)}


def track_delete(name):
    p = os.path.join(tracks_dir(), safe_name(name))
    if os.path.isfile(p):
        os.remove(p)
    return {"ok": True}


# ───────── backups of your own data (favorites, notes, pins, chats, checklist, settings) ─────────
def backup_dir():
    d = os.path.join(N.DATA, "backups")
    os.makedirs(d, exist_ok=True)
    return d


def export_all():
    return {"nomad_backup": 1, "version": N.VERSION, "date": _dt.datetime.now().isoformat(timespec="seconds"),
            "user": features.load_user(), "settings": features.get_settings()}


def restore(data, mode="merge"):
    if not isinstance(data, dict):
        return {"error": "not a NOMAD backup"}
    user = data.get("user") if "nomad_backup" in data else data
    if not isinstance(user, dict):
        return {"error": "not a NOMAD backup"}
    snapshot()  # keep a copy of the current state first
    cur = features.load_user()
    if mode == "replace":
        new = {k: user.get(k, cur[k]) for k in ("favorites", "readlater", "notes", "pins", "checklist", "chats", "saved", "inventory", "videos", "ui")}
    else:
        def merge_list(a, b, key):
            seen = {key(x) for x in a}
            return a + [x for x in b if key(x) not in seen]
        j = lambda x: json.dumps(x, sort_keys=True)
        new = {
            "favorites": merge_list(cur["favorites"], user.get("favorites", []), lambda x: (x.get("book"), x.get("path")) if isinstance(x, dict) else j(x)),
            "readlater": merge_list(cur["readlater"], user.get("readlater", []), lambda x: (x.get("book"), x.get("path")) if isinstance(x, dict) else j(x)),
            "notes": {**user.get("notes", {}), **cur["notes"]},
            "inventory": cur.get("inventory") or user.get("inventory"),
            "pins": merge_list(cur["pins"], user.get("pins", []), j),
            "checklist": merge_list(cur["checklist"], user.get("checklist", []), lambda x: x.get("t") if isinstance(x, dict) else j(x)),
            "chats": merge_list(cur["chats"], user.get("chats", []), lambda x: x.get("id") if isinstance(x, dict) else j(x)),
            "saved": merge_list(cur["saved"], user.get("saved", []), lambda x: (x.get("q"), x.get("a")) if isinstance(x, dict) else j(x)),
        }
    features.save_user(new)
    if isinstance(data.get("settings"), dict) and mode == "replace":
        features.set_settings({k: v for k, v in data["settings"].items() if k in features.SETTING_KEYS and k != "autostart"})
    return {"ok": True, "counts": {k: len(v) for k, v in new.items()}}


def snapshot():
    p = os.path.join(backup_dir(), "nomad-backup-" + _dt.datetime.now().strftime("%Y-%m-%d") + ".json")
    N.save_json(p, export_all())
    files = sorted(glob.glob(os.path.join(backup_dir(), "nomad-backup-*.json")))
    for old in files[:-14]:  # keep two weeks
        try:
            os.remove(old)
        except OSError:
            pass
    return p


def backups():
    return [{"file": os.path.basename(f), "size": os.path.getsize(f), "date": os.path.getmtime(f)}
            for f in sorted(glob.glob(os.path.join(backup_dir(), "nomad-backup-*.json")), reverse=True)]


def backup_loop():
    while True:
        try:
            today = os.path.join(backup_dir(), "nomad-backup-" + _dt.datetime.now().strftime("%Y-%m-%d") + ".json")
            if not os.path.isfile(today) and os.path.isfile(features.user_file()):
                snapshot()
        except Exception as e:
            print("backup:", e)
        time.sleep(3600)


# ───────── sync with NOMAD Mobile through the SSD (no Wi-Fi, no cloud) ─────────
# Phone → PC: NOMAD Mobile saves "nomad-phone-*.json"; put it in NOMAD\data\inbox and it is merged here.
# PC → phone: NOMAD Mobile opens NOMAD\data\nomad-user.json directly.
def item_key(kind, x):
    if not isinstance(x, dict):
        return json.dumps(x, sort_keys=True)
    if kind in ("favorites", "readlater"):
        return f"{x.get('book')}/{x.get('path')}"
    if kind == "pins":
        return f"{round(float(x.get('lat', 0)), 5)},{round(float(x.get('lon', 0)), 5)}"
    return json.dumps(x, sort_keys=True)


def apply_phone(data):
    """Merge a phone export: removals first, then additions. Returns counts."""
    snapshot()
    cur = features.load_user()
    removed = data.get("removed") or {}
    added = data.get("user") or {}
    out = {"added": 0, "removed": 0}
    for kind in ("favorites", "readlater", "pins"):
        gone = set(removed.get(kind) or [])
        before = len(cur[kind])
        cur[kind] = [x for x in cur[kind] if item_key(kind, x) not in gone]
        out["removed"] += before - len(cur[kind])
        have = {item_key(kind, x) for x in cur[kind]}
        for x in added.get(kind) or []:
            k = item_key(kind, x)
            if k not in have and k not in gone:
                cur[kind].insert(0, x)
                have.add(k)
                out["added"] += 1
    for k, v in (added.get("notes") or {}).items():
        if v and cur["notes"].get(k) != v:
            cur["notes"][k] = v
            out["added"] += 1
    for k in removed.get("notes") or []:
        if cur["notes"].pop(k, None) is not None:
            out["removed"] += 1
    features.save_user({k: cur[k] for k in ("favorites", "readlater", "pins", "notes")})
    for t in data.get("tracks") or []:
        try:
            track_save(t.get("name", "phone-track"), t.get("gpx", ""))
            out["added"] += 1
        except Exception:
            pass
    return out


def inbox_dir():
    return os.path.join(N.DATA, "inbox")


def check_inbox():
    d = inbox_dir()
    os.makedirs(d, exist_ok=True)
    done = os.path.join(d, "done")
    results = []
    for f in sorted(glob.glob(os.path.join(d, "*.json"))):
        try:
            with open(f, encoding="utf-8") as fh:
                data = json.load(fh)
            if data.get("nomad_phone") or data.get("nomad_backup"):
                r = apply_phone(data) if data.get("nomad_phone") else restore(data, "merge")
                os.makedirs(done, exist_ok=True)
                os.replace(f, os.path.join(done, os.path.basename(f)))
                results.append({"file": os.path.basename(f), **(r if isinstance(r, dict) else {})})
        except Exception as e:
            print("inbox:", os.path.basename(f), e)
    if results:
        N.STATE["data_version"] = N.STATE.get("data_version", 0) + 1
        N.STATE["data_msg"] = "phone sync"
        N.STATE["sync_msg"] = results
    return results


def inbox_loop():
    while True:
        try:
            check_inbox()
        except Exception as e:
            print("inbox:", e)
        time.sleep(10)


# ───────── Windows: popup / auto-open when the NOMAD SSD is plugged in ─────────
# Windows no longer runs anything automatically from USB drives (security), so a tiny watcher
# runs on the PC itself (installed from Settings). It only watches for drives and asks first.
PLUG_PS1 = r"""# PROJECT NOMAD - watches for the NOMAD SSD and offers to open it. Remove via NOMAD Settings.
$mode = '__MODE__'
$rel  = '__REL__'
Add-Type -AssemblyName System.Windows.Forms
function Find-Nomad { foreach($d in [IO.DriveInfo]::GetDrives()){ try { if($d.IsReady){ $p = Join-Path $d.RootDirectory.FullName $rel; if(Test-Path $p){ return $p } } } catch {} } return $null }
$was = Find-Nomad
Register-CimIndicationEvent -ClassName Win32_VolumeChangeEvent -SourceIdentifier nomadvol | Out-Null
while($true){
  Wait-Event -SourceIdentifier nomadvol | Out-Null
  Remove-Event -SourceIdentifier nomadvol -ErrorAction SilentlyContinue
  Start-Sleep -Seconds 2
  Get-Event -SourceIdentifier nomadvol -ErrorAction SilentlyContinue | Remove-Event
  $now = Find-Nomad
  if($now -and -not $was -and -not (Get-Process NOMAD -ErrorAction SilentlyContinue)){
    if($mode -eq 'open'){ Start-Process $now }
    else {
      $f = New-Object Windows.Forms.Form -Property @{TopMost = $true; ShowInTaskbar = $false}
      $r = [Windows.Forms.MessageBox]::Show($f, "Your NOMAD SSD is connected.`n`nOpen PROJECT NOMAD now?", 'PROJECT NOMAD', 'YesNo', 'Information')
      $f.Dispose()
      if($r -eq 'Yes'){ Start-Process $now }
    }
  }
  $was = $now
}
"""


def _plug_paths():
    la, ad = os.environ.get("LOCALAPPDATA"), os.environ.get("APPDATA")
    if not la or not ad:
        return None, None
    return (os.path.join(la, "NOMAD", "nomad-plug.ps1"),
            os.path.join(ad, "Microsoft", "Windows", "Start Menu", "Programs", "Startup", "NOMAD-plug.vbs"))


def plug_mode():
    ps1, vbs = _plug_paths()
    if not ps1 or not os.path.isfile(vbs) or not os.path.isfile(ps1):
        return "off"
    try:
        with open(ps1, encoding="utf-8") as f:
            return "open" if "$mode = 'open'" in f.read() else "ask"
    except OSError:
        return "off"


def _stop_watcher():
    import subprocess
    subprocess.run(["powershell", "-NoProfile", "-Command",
                    "Get-CimInstance Win32_Process -Filter \"Name='powershell.exe'\" | Where-Object { $_.CommandLine -like '*nomad-plug.ps1*' } | "
                    "ForEach-Object { Stop-Process -Id $_.ProcessId -Force }"],
                   capture_output=True, creationflags=getattr(subprocess, "CREATE_NO_WINDOW", 0))


def set_plug_mode(mode):
    import subprocess
    import sys as s_
    if not s_.platform.startswith("win"):
        return "off"
    ps1, vbs = _plug_paths()
    _stop_watcher()
    if mode not in ("ask", "open"):
        for p in (ps1, vbs):
            try:
                os.remove(p)
            except OSError:
                pass
        return "off"
    drive, rest = os.path.splitdrive(N.ROOT)
    rel = os.path.join(rest.strip("\\/"), "NOMAD.exe") if rest.strip("\\/") else "NOMAD.exe"
    os.makedirs(os.path.dirname(ps1), exist_ok=True)
    with open(ps1, "w", encoding="utf-8-sig") as f:
        f.write(PLUG_PS1.replace("__MODE__", mode).replace("__REL__", rel.replace("'", "''")))
    with open(vbs, "w", encoding="utf-8") as f:
        f.write('CreateObject("WScript.Shell").Run "powershell.exe -NoProfile -ExecutionPolicy Bypass -WindowStyle Hidden -File ""' + ps1 + '""", 0, False\r\n')
    subprocess.Popen(["wscript.exe", vbs], creationflags=getattr(subprocess, "CREATE_NO_WINDOW", 0))
    return mode


def drive_branding():
    """NOMAD icon + name for the SSD in Explorer (autorun.inf; Windows ignores the 'open' part on USB, which is fine)."""
    import sys as s_
    if not s_.platform.startswith("win"):
        return
    drive, rest = os.path.splitdrive(N.ROOT)
    if not drive:
        return
    inf = drive + "\\autorun.inf"
    rel = (rest.strip("\\/") + "\\" if rest.strip("\\/") else "") + "NOMAD.exe"
    body = f"; PROJECT NOMAD\r\n[autorun]\r\nicon={rel},0\r\nlabel=NOMAD\r\n"
    try:
        if os.path.exists(inf):
            with open(inf, encoding="utf-8", errors="replace") as f:
                old = f.read()
            if "PROJECT NOMAD" not in old or old == body:
                return
            import ctypes
            ctypes.windll.kernel32.SetFileAttributesW(inf, 0x80)
        with open(inf, "w", encoding="utf-8") as f:
            f.write(body)
        import ctypes
        ctypes.windll.kernel32.SetFileAttributesW(inf, 0x02 | 0x04)  # hidden + system
    except Exception:
        pass
