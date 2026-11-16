"""
NOMAD-updater: haalt de nieuwste app-code van GitHub.
Alleen de app wordt bijgewerkt — data, tools, AI-modellen en je config blijven staan.
NOMAD roept dit op de achtergrond aan; los draaien kan ook: python app/update.py
"""
import io
import json
import os
import shutil
import sys
import urllib.request
import zipfile

APP = os.path.dirname(os.path.abspath(__file__))
ROOT = os.path.dirname(APP)
STAMP = os.path.join(APP, ".commit")
CFG = os.path.join(APP, "config.json")

REPO = "mikeey77/nomad"
BRANCH = "main"
UPDATABLE = ("app/", "LINKS.txt", "README.md", ".gitignore")
KEEP = ("app/config.json", "app/.commit")


def get(url, timeout=8):
    headers = {"User-Agent": "NOMAD-updater", "Accept": "application/vnd.github+json"}
    try:
        with open(CFG, encoding="utf-8") as f:
            tok = json.load(f).get("github_token")
        if tok:
            headers["Authorization"] = "Bearer " + tok
    except Exception:
        pass
    with urllib.request.urlopen(urllib.request.Request(url, headers=headers), timeout=timeout) as r:
        return r.read()


def current():
    return open(STAMP).read().strip() if os.path.exists(STAMP) else ""


def latest():
    """Nieuwste commit + commitbericht, of None als offline."""
    try:
        c = json.loads(get(f"https://api.github.com/repos/{REPO}/commits/{BRANCH}"))
        return c["sha"], c["commit"]["message"].split("\n")[0]
    except Exception:
        return None


def apply(sha):
    data = get(f"https://api.github.com/repos/{REPO}/zipball/{sha}", timeout=180)
    z = zipfile.ZipFile(io.BytesIO(data))
    n = 0
    for info in z.infolist():
        if info.is_dir():
            continue
        rel = info.filename.split("/", 1)[1] if "/" in info.filename else ""
        if not rel or rel in KEEP or not rel.startswith(UPDATABLE):
            continue
        dest = os.path.join(ROOT, *rel.split("/"))
        os.makedirs(os.path.dirname(dest), exist_ok=True)
        tmp = dest + ".new"
        with z.open(info) as src, open(tmp, "wb") as out:
            shutil.copyfileobj(src, out)
        os.replace(tmp, dest)
        n += 1
    with open(STAMP, "w") as f:
        f.write(sha)
    return n


def main():
    l = latest()
    if not l:
        print("  Update: geen verbinding met GitHub.")
        return
    if l[0] == current():
        print("  Update: NOMAD is up-to-date.")
        return
    print(f"  Update: {l[1]} ({l[0][:7]})…")
    print(f"  Update: klaar ({apply(l[0])} bestanden).")


if __name__ == "__main__":
    main()
    sys.exit(0)
