"""NOMAD v0.21 — "My documents": your own PDFs, Word files, notes and e-books, searchable by the AI.

Drop files in NOMAD\\data\\documents (or upload them in the AI view). They are indexed in the background
(text only, stays on the SSD) and the AI uses the best matching passages as sources, with page numbers.
"""
import html
import json
import math
import os
import re
import subprocess
import sys
import threading
import time
import zipfile

N = sys.modules.get("__main__")
if not hasattr(N, "DATA"):
    import nomad as N  # noqa: F811

EXT = {".pdf", ".txt", ".md", ".docx", ".odt", ".html", ".htm", ".csv", ".epub", ".rtf", ".json", ".srt"}
STATE = {"state": "idle", "msg": "", "files": 0, "chunks": 0, "t": 0}
_LOCK = threading.Lock()
_INDEX = {"files": {}, "chunks": []}     # files: rel -> {mtime,size,pages,chunks,error}; chunks: [rel, page, text]
_DF = {}
CHUNK = 1100


def doc_dir():
    d = os.path.join(N.DATA, "documents")
    os.makedirs(d, exist_ok=True)
    readme = os.path.join(d, "README.txt")
    if not os.path.exists(readme):
        with open(readme, "w", encoding="utf-8") as f:
            f.write("My documents: put your own PDFs, Word files, notes and e-books here.\n"
                    "NOMAD indexes them automatically and the AI can answer questions about them.\n")
    return d


def _index_file():
    return os.path.join(N.DATA, "search", "documents-index.json")


def _words(s):
    return re.findall(r"[a-z0-9\u00c0-\u024f]{3,}", s.lower())


# ───────── text extraction ─────────
def _strip_xml(x):
    x = re.sub(r"</w:p>|</text:p>|<br\s*/?>|</p>|</div>|</h\d>|</li>", "\n", x)
    return html.unescape(re.sub(r"<[^>]+>", "", x))


def _pdf_pages(path):
    try:
        import pypdf
    except ImportError:
        if not N.is_online():
            raise RuntimeError("PDF reader not installed yet (needs internet once)")
        subprocess.run([sys.executable, "-m", "pip", "install", "--quiet", "pypdf"], capture_output=True, timeout=300,
                       creationflags=getattr(subprocess, "CREATE_NO_WINDOW", 0))
        import importlib
        importlib.invalidate_caches()
        import pypdf
    r = pypdf.PdfReader(path)
    for i, pg in enumerate(r.pages):
        try:
            yield i + 1, pg.extract_text() or ""
        except Exception:
            yield i + 1, ""


def extract(path):
    """Yield (page, text). Page is 0 when the format has no pages."""
    ext = os.path.splitext(path)[1].lower()
    if ext == ".pdf":
        yield from _pdf_pages(path)
    elif ext in (".docx", ".odt"):
        with zipfile.ZipFile(path) as z:
            yield 0, _strip_xml(z.read("word/document.xml" if ext == ".docx" else "content.xml").decode("utf-8", "replace"))
    elif ext == ".epub":
        with zipfile.ZipFile(path) as z:
            names = sorted(n for n in z.namelist() if n.lower().endswith((".xhtml", ".html", ".htm")))
            for i, n in enumerate(names):
                yield i + 1, _strip_xml(z.read(n).decode("utf-8", "replace"))
    elif ext in (".html", ".htm"):
        with open(path, encoding="utf-8", errors="replace") as f:
            t = f.read()
        yield 0, _strip_xml(re.sub(r"(?is)<(script|style)[^>]*>.*?</\1>", "", t))
    elif ext == ".rtf":
        with open(path, encoding="latin-1", errors="replace") as f:
            t = f.read()
        yield 0, re.sub(r"\\[a-z]+-?\d* ?|[{}]", "", t)
    else:
        with open(path, encoding="utf-8", errors="replace") as f:
            yield 0, f.read()


def _chunks(text):
    text = re.sub(r"[ \t]+", " ", text)
    text = re.sub(r"\n\s*\n+", "\n\n", text).strip()
    out, cur = [], ""
    for para in text.split("\n\n"):
        if len(cur) + len(para) > CHUNK and cur:
            out.append(cur.strip())
            cur = cur[-150:]                       # small overlap keeps sentences together
        cur += para + "\n\n"
        while len(cur) > CHUNK * 1.6:
            out.append(cur[:CHUNK].strip())
            cur = cur[CHUNK - 150:]
    if cur.strip():
        out.append(cur.strip())
    return [c for c in out if len(c) > 40]


# ───────── index ─────────
def _load():
    global _INDEX
    try:
        with open(_index_file(), encoding="utf-8") as f:
            _INDEX = json.load(f)
    except Exception:
        _INDEX = {"files": {}, "chunks": []}
    _rebuild_df()


def _save():
    os.makedirs(os.path.dirname(_index_file()), exist_ok=True)
    tmp = _index_file() + ".tmp"
    with open(tmp, "w", encoding="utf-8") as f:
        json.dump(_INDEX, f)
    os.replace(tmp, _index_file())


def _rebuild_df():
    global _DF
    df = {}
    for c in _INDEX["chunks"]:
        for w in set(_words(c[2])):
            df[w] = df.get(w, 0) + 1
    _DF = df
    STATE.update(files=len([f for f in _INDEX["files"].values() if not f.get("error")]), chunks=len(_INDEX["chunks"]))


def scan():
    """Index new/changed files, drop removed ones. Cheap when nothing changed."""
    if not _LOCK.acquire(blocking=False):
        return
    try:
        if not _INDEX["files"] and os.path.exists(_index_file()):
            _load()
        d = doc_dir()
        seen, changed = set(), False
        for root, dirs, files in os.walk(d):
            dirs[:] = [x for x in dirs if not x.startswith(".")]
            for fn in files:
                if os.path.splitext(fn)[1].lower() not in EXT or fn == "README.txt" or fn.endswith(".part"):
                    continue
                full = os.path.join(root, fn)
                rel = os.path.relpath(full, d).replace("\\", "/")
                seen.add(rel)
                st = os.stat(full)
                old = _INDEX["files"].get(rel)
                if old and old["mtime"] == int(st.st_mtime) and old["size"] == st.st_size and not (old.get("error") and "internet" in old["error"] and N.is_online()):
                    continue
                STATE.update(state="indexing", msg=fn)
                _INDEX["chunks"] = [c for c in _INDEX["chunks"] if c[0] != rel]
                info = {"mtime": int(st.st_mtime), "size": st.st_size, "pages": 0, "chunks": 0}
                try:
                    for page, txt in extract(full):
                        info["pages"] = max(info["pages"], page)
                        for c in _chunks(txt):
                            _INDEX["chunks"].append([rel, page, c])
                            info["chunks"] += 1
                    if not info["chunks"]:
                        info["error"] = "no text found (scanned PDF? use the photo button in the AI)"
                except Exception as e:
                    info["error"] = str(e)[:160]
                _INDEX["files"][rel] = info
                changed = True
        for rel in list(_INDEX["files"]):
            if rel not in seen:
                del _INDEX["files"][rel]
                _INDEX["chunks"] = [c for c in _INDEX["chunks"] if c[0] != rel]
                changed = True
        if changed:
            _rebuild_df()
            _save()
        else:
            STATE.update(files=len([f for f in _INDEX["files"].values() if not f.get("error")]), chunks=len(_INDEX["chunks"]))
    finally:
        STATE.update(state="idle", msg="", t=time.time())
        _LOCK.release()


def loop():
    time.sleep(20)
    while True:
        try:
            scan()
        except Exception as e:
            STATE.update(state="idle", msg=str(e)[:100])
        time.sleep(90)


def search(kw, limit=3):
    """Best matching passages (simple BM25-ish scoring on the keywords)."""
    kw = [w.lower() for w in kw if len(w) >= 3]
    if not kw or not _INDEX["chunks"]:
        return []
    n = len(_INDEX["chunks"])
    idf = {w: math.log(1 + n / (1 + sum(v for k, v in _DF.items() if k.startswith(w)) if len(w) >= 5 else 1 + _DF.get(w, 0))) for w in kw}
    scored = []
    for rel, page, txt in _INDEX["chunks"]:
        words = _words(txt)
        if not words:
            continue
        s, hit = 0.0, 0
        for w in kw:
            tf = sum(1 for x in words if x == w or (len(w) >= 5 and x.startswith(w)))
            if tf:
                hit += 1
                s += idf[w] * tf * 2.2 / (tf + 1.2 * (0.25 + 0.75 * len(words) / 180))
        if hit:
            scored.append((s * (1 + hit / len(kw)), rel, page, txt))
    scored.sort(reverse=True)
    out, per = [], {}
    for s, rel, page, txt in scored:
        if per.get(rel, 0) >= 2:
            continue
        per[rel] = per.get(rel, 0) + 1
        out.append({"rel": rel, "page": page, "text": txt, "score": round(s, 2)})
        if len(out) >= limit:
            break
    return out


def fs_rel(rel):
    """Path for the file manager / /api/fs/raw."""
    import extra
    base = extra.nomad_rel()
    return ((base + "/") if base else "") + "data/documents/" + rel


def listing():
    return {"state": STATE, "dir": fs_rel("").rstrip("/"),
            "files": sorted(({"name": k, "path": fs_rel(k), **v} for k, v in _INDEX["files"].items()), key=lambda x: x["name"].lower())}


def init():
    doc_dir()
    if os.path.exists(_index_file()):
        _load()
    threading.Thread(target=loop, daemon=True).start()
