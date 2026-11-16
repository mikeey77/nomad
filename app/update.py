"""
NOMAD-updater: haalt bij elke start (als er internet is) de nieuwste app-code van GitHub.
Alleen de app wordt bijgewerkt — data, tools, AI-modellen en je config blijven staan.
Faalt er iets of ben je offline, dan start NOMAD gewoon met de huidige versie.
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
# alleen deze paden mogen door een update overschreven worden
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


def main():
    try:
        sha = json.loads(get(f"https://api.github.com/repos/{REPO}/commits/{BRANCH}"))["sha"]
    except Exception:
        print("  Update: geen verbinding met GitHub — start met huidige versie.")
        return
    cur = open(STAMP).read().strip() if os.path.exists(STAMP) else ""
    if sha == cur:
        print("  Update: NOMAD is up-to-date.")
        return
    print(f"  Update: nieuwe versie gevonden ({sha[:7]}), downloaden…")
    try:
        data = get(f"https://api.github.com/repos/{REPO}/zipball/{sha}", timeout=120)
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
        print(f"  Update: klaar ({n} bestanden bijgewerkt).")
    except Exception as e:
        print("  Update mislukt, start met huidige versie:", e)


if __name__ == "__main__":
    main()
    sys.exit(0)
