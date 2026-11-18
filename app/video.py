"""NOMAD v0.17 — offline video library: your own video files plus downloads from the Internet Archive
(public-domain and Creative-Commons films: survival training, first aid, civil defence, farming, crafts…)."""
import json
import os
import re
import sys
import urllib.parse
import urllib.request

N = sys.modules['__main__'] if hasattr(sys.modules.get('__main__'), 'STATE') else __import__('nomad')

EXT = {".mp4", ".m4v", ".webm", ".mkv", ".mov", ".ogv", ".avi"}
UA = {"User-Agent": "PROJECT-NOMAD/1.0 (offline library)"}
TOPICS = ["survival", "first aid", "wilderness", "civil defense", "water purification", "gardening", "farming",
          "food preservation", "knots", "carpentry", "blacksmith", "radio", "fire", "shelter", "map reading", "emergency"]


def video_dir():
    d = os.path.join(N.DATA, "videos")
    os.makedirs(d, exist_ok=True)
    return d


def safe_rel(rel):
    root = video_dir()
    full = os.path.normpath(os.path.join(root, (rel or "").replace("\\", "/")))
    if not full.startswith(root + os.sep):
        raise PermissionError("outside videos")
    return full


def _side(full):
    base = os.path.splitext(full)[0]
    meta = {}
    if os.path.isfile(base + ".json"):
        try:
            with open(base + ".json", encoding="utf-8") as f:
                meta = json.load(f)
        except Exception:
            pass
    thumb = next((base + e for e in (".jpg", ".jpeg", ".png", ".webp") if os.path.isfile(base + e)), None)
    subs = [base + e for e in (".vtt", ".srt") if os.path.isfile(base + e)]
    return meta, thumb, subs


def videos():
    root = video_dir()
    out = []
    for dp, dn, fn in os.walk(root):
        dn[:] = [d for d in dn if not d.startswith(".")]
        for f in fn:
            if os.path.splitext(f)[1].lower() not in EXT or f.endswith(".part"):
                continue
            full = os.path.join(dp, f)
            rel = os.path.relpath(full, root).replace("\\", "/")
            meta, thumb, subs = _side(full)
            folder = os.path.dirname(rel)
            out.append({"rel": rel, "title": meta.get("title") or re.sub(r"[_.-]+", " ", os.path.splitext(f)[0]).strip(),
                        "desc": (meta.get("desc") or "")[:600], "source": meta.get("source", ""), "license": meta.get("license", ""),
                        "duration": meta.get("duration"), "size": os.path.getsize(full), "mtime": int(os.path.getmtime(full)),
                        "folder": folder or meta.get("topic", ""),
                        "thumb": ("/video/" + urllib.parse.quote(os.path.relpath(thumb, root).replace("\\", "/"))) if thumb else None,
                        "subs": ["/video/" + urllib.parse.quote(os.path.relpath(s, root).replace("\\", "/")) for s in subs]})
    out.sort(key=lambda v: -v["mtime"])
    return out


def _get(url, timeout=25):
    with urllib.request.urlopen(urllib.request.Request(url, headers=UA), timeout=timeout) as r:
        return json.loads(r.read())


def search(q, page=1):
    """Internet Archive: only films that are public domain or Creative Commons."""
    q = (q or "survival").strip()
    query = (f"({q}) AND mediatype:movies AND (licenseurl:*publicdomain* OR licenseurl:*creativecommons* "
             f"OR collection:prelinger OR collection:usgovernmentfilms OR collection:fedflix)")
    params = [("q", query), ("rows", "40"), ("page", str(page)), ("output", "json"), ("sort[]", "downloads desc")]
    params += [("fl[]", f) for f in ("identifier", "title", "description", "downloads", "licenseurl", "year", "runtime", "collection")]
    data = _get("https://archive.org/advancedsearch.php?" + urllib.parse.urlencode(params))
    have = {v.get("source", "") for v in (_side(os.path.join(video_dir(), x["rel"]))[0] for x in videos())}
    out = []
    for d in data.get("response", {}).get("docs", []):
        desc = d.get("description") or ""
        if isinstance(desc, list):
            desc = " ".join(desc)
        desc = re.sub(r"<[^>]+>", " ", desc)
        desc = re.sub(r"\s+", " ", desc).strip()
        out.append({"id": d["identifier"], "title": d.get("title") if isinstance(d.get("title"), str) else d["identifier"],
                    "desc": desc[:400], "year": d.get("year"), "runtime": d.get("runtime"), "downloads": d.get("downloads"),
                    "license": d.get("licenseurl") or "public domain (US government / Prelinger)",
                    "thumb": f"https://archive.org/services/img/{d['identifier']}",
                    "have": f"https://archive.org/details/{d['identifier']}" in have})
    return {"q": q, "results": out, "total": data.get("response", {}).get("numFound", 0)}


def resolve(ident):
    """Pick a good, not-too-large MP4 from an Internet Archive item."""
    meta = _get(f"https://archive.org/metadata/{urllib.parse.quote(ident)}")
    files = meta.get("files", [])
    vids = [f for f in files if f.get("name", "").lower().endswith((".mp4", ".m4v", ".webm", ".ogv"))]
    if not vids:
        raise RuntimeError("no playable video file in this item")

    def score(f):
        size = int(f.get("size") or 0)
        fmt = (f.get("format") or "").lower()
        pref = 0 if "h.264" in fmt or "mpeg4" in fmt else 1
        too_big = size > (1500 << 20)
        return (too_big, pref, -size if not too_big else size)
    best = sorted(vids, key=score)[0]
    md = meta.get("metadata", {})
    title = md.get("title") if isinstance(md.get("title"), str) else ident
    desc = md.get("description") or ""
    if isinstance(desc, list):
        desc = " ".join(desc)
    return {"url": f"https://archive.org/download/{urllib.parse.quote(ident)}/{urllib.parse.quote(best['name'])}",
            "size": int(best.get("size") or 0), "title": title, "desc": re.sub(r"\s+", " ", re.sub(r"<[^>]+>", " ", desc)).strip()[:1500],
            "license": md.get("licenseurl") or "public domain", "source": f"https://archive.org/details/{ident}",
            "thumb": f"https://archive.org/services/img/{ident}", "ext": os.path.splitext(best["name"])[1].lower(),
            "duration": best.get("length")}


def clean_name(t):
    t = re.sub(r'[\\/:*?"<>|]+', " ", t).strip()
    return re.sub(r"\s+", " ", t)[:90] or "video"


def queue_ia(ident, topic=""):
    import features
    info = resolve(ident)
    folder = clean_name(topic.title()) if topic else ""
    name = clean_name(info["title"])
    item = dict(info, id="video:" + ident, kind="video", title=info["title"],
                target=os.path.join(video_dir(), folder, name + info["ext"]))
    return features.enqueue(item["id"], item)


def queue_url(url, title=""):
    import features
    if not re.match(r"^https?://", url or ""):
        return {"error": "not a link"}
    ext = os.path.splitext(urllib.parse.urlparse(url).path)[1].lower()
    if ext not in EXT:
        return {"error": "Only direct links to video files (.mp4, .webm, …) can be downloaded."}
    name = clean_name(title or os.path.splitext(os.path.basename(urllib.parse.urlparse(url).path))[0])
    item = {"id": "video:" + url[-60:], "kind": "video", "title": name, "url": url, "size": 0, "source": url,
            "target": os.path.join(video_dir(), name + ext)}
    return features.enqueue(item["id"], item)


def fetch(job, item):
    os.makedirs(os.path.dirname(item["target"]), exist_ok=True)
    N.download(job, item["url"], item["target"])
    base = os.path.splitext(item["target"])[0]
    with open(base + ".json", "w", encoding="utf-8") as f:
        json.dump({k: item.get(k) for k in ("title", "desc", "license", "source", "duration")}, f, ensure_ascii=False, indent=1)
    if item.get("thumb"):
        try:
            with urllib.request.urlopen(urllib.request.Request(item["thumb"], headers=UA), timeout=30) as r, open(base + ".jpg", "wb") as f:
                f.write(r.read())
        except Exception:
            pass


def save_thumb(rel, data_url):
    import base64
    full = safe_rel(rel)
    base = os.path.splitext(full)[0]
    if any(os.path.isfile(base + e) for e in (".jpg", ".png", ".webp")):
        return {"ok": True}
    raw = base64.b64decode(data_url.split(",", 1)[-1])
    with open(base + ".jpg", "wb") as f:
        f.write(raw)
    return {"ok": True}


def delete(rel):
    full = safe_rel(rel)
    base = os.path.splitext(full)[0]
    for p in [full] + [base + e for e in (".json", ".jpg", ".jpeg", ".png", ".webp", ".vtt", ".srt")]:
        try:
            os.remove(p)
        except OSError:
            pass
    return {"ok": True}
