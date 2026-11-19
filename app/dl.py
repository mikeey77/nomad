"""NOMAD v0.23 — robust multi-mirror downloader for big files.

* The file is split in small pieces (32 MB) that are handed out IN ORDER to 4 workers, so all writes happen
  near the end of the file. (The old version reserved the whole file and wrote at e.g. 0 / 13 / 26 / 39 GB at
  the same time; Windows then has to zero-fill everything before each write — for Wikipedia that stalled for
  minutes and the connections timed out.)
* Kiwix files come from several mirrors at once (read from the .meta4 file); a mirror that misbehaves is
  dropped and its pieces go to the others.
* Every worker keeps one HTTP connection open (keep-alive) instead of reconnecting per piece.
* Progress is saved (which pieces are done), so it resumes after a restart, crash or network loss.
"""
import http.client
import json
import os
import re
import ssl
import sys
import threading
import time
import urllib.request
import xml.etree.ElementTree as ET
from urllib.parse import urlsplit

N = sys.modules.get("__main__")
if not hasattr(N, "DL_DIR"):
    import nomad as N  # noqa: F811

PIECE = 32 << 20
CONNS = 4
UA = {"User-Agent": "NOMAD-downloader"}
_CTX = ssl.create_default_context()


def mirrors_for(url, total):
    """Mirror URLs for a file (Kiwix: from the .meta4 metalink, best first). Always includes the original."""
    out = []
    if "download.kiwix.org" in url:
        try:
            req = urllib.request.Request(re.sub(r"^https?://[^/]+", "https://download.kiwix.org", url) + ".meta4", headers=UA)
            with urllib.request.urlopen(req, timeout=20) as r:
                root = ET.fromstring(r.read())
            urls = []
            for el in root.iter():
                if el.tag.endswith("}url") or el.tag == "url":
                    pr = int(el.get("priority") or 999)
                    if el.text and el.text.startswith("https://"):
                        urls.append((pr, el.text.strip()))
            out = [u for _, u in sorted(urls)][:8]
        except Exception:
            pass
    if url not in out:
        out.append(url)
    return out


class Mirror:
    def __init__(self, url):
        self.url = url
        self.fails = 0
        self.bytes = 0
        self.secs = 0.001
        self.dead = False

    @property
    def speed(self):
        return self.bytes / self.secs


class Conn:
    """One keep-alive HTTP(S) connection that follows redirects."""
    def __init__(self):
        self.c = None
        self.host = None

    def get(self, url, start, end, depth=0):
        u = urlsplit(url)
        key = (u.scheme, u.netloc)
        if self.c is None or self.host != key:
            self.close()
            cls = http.client.HTTPSConnection if u.scheme == "https" else http.client.HTTPConnection
            self.c = cls(u.netloc, timeout=45, **({"context": _CTX} if u.scheme == "https" else {}))
            self.host = key
        path = u.path + ("?" + u.query if u.query else "")
        try:
            self.c.request("GET", path, headers={**UA, "Range": f"bytes={start}-{end}", "Connection": "keep-alive"})
            r = self.c.getresponse()
        except Exception:
            self.close()
            raise
        if r.status in (301, 302, 303, 307, 308) and depth < 5:
            loc = r.getheader("Location")
            r.read()
            if not loc:
                raise IOError("redirect without location")
            if loc.startswith("/"):
                loc = f"{u.scheme}://{u.netloc}{loc}"
            return self.get(loc, start, end, depth + 1)
        return r

    def close(self):
        try:
            if self.c:
                self.c.close()
        except Exception:
            pass
        self.c = None


def _load_state(seg, total):
    try:
        with open(seg, encoding="utf-8") as f:
            st = json.load(f)
    except Exception:
        return set()
    if st.get("total") != total:
        return set()
    if "segs" in st:                       # v0.19-0.22 format: convert finished byte ranges to pieces
        done = set()
        for a, b, got, *_ in st["segs"]:
            for i in range(a // PIECE, (a + got) // PIECE + 1):
                if i * PIECE >= a and min(total, (i + 1) * PIECE) <= a + got:
                    done.add(i)
        return done
    if st.get("piece") != PIECE:
        return set()
    done = set()
    for a, b in st.get("done", []):
        done.update(range(a, b + 1))
    return done


def _save_state(seg, total, done):
    ranges, run = [], None
    for i in sorted(done):
        if run and i == run[1] + 1:
            run[1] = i
        else:
            run = [i, i]
            ranges.append(run)
    tmp = seg + ".tmp"
    with open(tmp, "w", encoding="utf-8") as f:
        json.dump({"total": total, "piece": PIECE, "done": ranges, "t": int(time.time())}, f)
    os.replace(tmp, seg)


def download_pieces(job, url, part, seg, total):
    n = -(-total // PIECE)
    done = _load_state(seg, total) if os.path.exists(part) else set()
    if not os.path.exists(part):
        open(part, "wb").close()
    todo = [i for i in range(n) if i not in done]
    job.update(total=total, done=sum(min(PIECE, total - i * PIECE) for i in done), msg="finding mirrors…")
    ms = [Mirror(u) for u in mirrors_for(url, total)]
    job["mirrors"] = len(ms)
    lock = threading.Lock()
    nxt = {"i": 0}
    failed = {}                 # piece -> attempts
    err = {"last": ""}

    def take():
        with lock:
            # retry pieces that failed first (they hold back the "frontier"), then new ones in order
            for p in sorted(failed):
                if failed[p] >= 0 and p not in done and p not in busy:
                    busy.add(p)
                    return p
            while nxt["i"] < len(todo):
                p = todo[nxt["i"]]
                nxt["i"] += 1
                if p not in done:
                    busy.add(p)
                    return p
        return None
    busy = set()

    def pick_mirror(k):
        alive = [m for m in ms if not m.dead]
        if not alive:                      # everything failed: give them all another chance
            for m in ms:
                m.dead, m.fails = False, 0
            alive = ms
        if len(alive) > 1:                 # spread the workers, but prefer fast mirrors
            alive = sorted(alive, key=lambda m: -m.speed if m.bytes > 50 << 20 else -1e18)
        return alive[k % len(alive)]

    def worker(k):
        conn, m = Conn(), None
        while not job.get("cancel"):
            p = take()
            if p is None:
                break
            a, b = p * PIECE, min(total, (p + 1) * PIECE) - 1
            ok = False
            for attempt in range(12):
                if job.get("cancel"):
                    break
                if m is None or m.dead:
                    m = pick_mirror(k + attempt)
                t0, got = time.time(), 0
                try:
                    r = conn.get(m.url, a, b)
                    if r.status != 206:
                        r.read(0)
                        conn.close()
                        raise IOError(f"HTTP {r.status} from {urlsplit(m.url).netloc}")
                    cr = r.getheader("Content-Range") or ""
                    if not cr.startswith(f"bytes {a}-") or not cr.endswith(f"/{total}"):
                        conn.close()
                        raise IOError("mirror has a different version of the file")
                    buf = bytearray()
                    while True:
                        if job.get("cancel"):
                            raise InterruptedError()
                        c = r.read(1 << 20)
                        if not c:
                            break
                        buf += c
                        got += len(c)
                        with lock:
                            job["done"] += len(c)
                    if len(buf) != b - a + 1:
                        raise IOError("piece cut off")
                    with lock:
                        with open(part, "r+b") as f:
                            f.seek(a)
                            f.write(buf)
                        done.add(p)
                        busy.discard(p)
                        failed.pop(p, None)
                    m.bytes += got
                    m.secs += time.time() - t0
                    m.fails = max(0, m.fails - 1)
                    ok = True
                    break
                except InterruptedError:
                    with lock:
                        job["done"] -= got
                    break
                except Exception as e:
                    with lock:
                        job["done"] -= got
                    conn.close()
                    m.fails += 1
                    err["last"] = str(e)[:120]
                    if m.fails >= 3 and sum(1 for x in ms if not x.dead) > 1:
                        m.dead = True             # let the other mirrors take over
                    m = None
                    job["msg"] = f"connection problem, retrying… ({err['last'][:50]})"
                    time.sleep(min(30, 2 * (attempt + 1)))
            if not ok:
                with lock:
                    busy.discard(p)
                    if not job.get("cancel"):
                        failed[p] = failed.get(p, 0) + 1
                        if failed[p] > 3:
                            failed[p] = -1        # give up on this piece for this round
        conn.close()

    threads = [threading.Thread(target=worker, args=(k,), daemon=True) for k in range(CONNS)]
    for t in threads:
        t.start()
    t0, d0, last_save = time.time(), job["done"], 0
    while any(t.is_alive() for t in threads):
        time.sleep(1)
        now = time.time()
        if now - t0 >= 2:
            job["speed"] = max(0, (job["done"] - d0) / (now - t0))
            t0, d0 = now, job["done"]
            alive = sum(1 for m in ms if not m.dead)
            if job["speed"] > 0 and job.get("msg", "").startswith(("connection", "finding")):
                job["msg"] = ""
            job["mirrors"] = alive
        if now - last_save > 3:
            with lock:
                _save_state(seg, total, done)
            last_save = now
    with lock:
        _save_state(seg, total, done)
    if job.get("cancel"):
        raise InterruptedError("cancelled")
    if len(done) < n:
        raise IOError(f"{n - len(done)} parts missing ({err['last'] or 'network'}) — will continue where it stopped")
    if os.path.getsize(part) != total:
        with open(part, "r+b") as f:
            f.truncate(total)
    os.remove(seg)
