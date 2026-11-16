"""
NOMAD.exe — start PROJECT NOMAD met één dubbelklik.
- werkt de app bij vanaf GitHub (als er internet is)
- start de server onzichtbaar op de achtergrond
- opent NOMAD in een eigen app-venster (Edge/Chrome app-modus)
- tray-icoon onderin: openen, telefoon, herstarten, setup, afsluiten
Zet NOMAD.exe in de NOMAD-map op de SSD (naast de mappen app, data, tools).
"""
import ctypes
import os
import shutil
import socket
import subprocess
import sys
import threading
import time
import webbrowser

ROOT = os.path.dirname(sys.executable if getattr(sys, "frozen", False) else os.path.abspath(__file__))
if not os.path.isdir(os.path.join(ROOT, "app")) and os.path.isdir(os.path.join(os.path.dirname(ROOT), "app")):
    ROOT = os.path.dirname(ROOT)  # bij draaien vanuit de map launcher\
PY = os.path.join(ROOT, "tools", "python", "python.exe")
PORT = 8090
URL = f"http://localhost:{PORT}/"
NOWIN = 0x08000000  # CREATE_NO_WINDOW
SERVER = None


def msg(text, title="NOMAD", flags=0x40):
    return ctypes.windll.user32.MessageBoxW(0, text, title, flags)


def port_open():
    with socket.socket() as s:
        s.settimeout(0.3)
        return s.connect_ex(("127.0.0.1", PORT)) == 0


def find_browser():
    cands = [
        os.path.expandvars(r"%ProgramFiles(x86)%\Microsoft\Edge\Application\msedge.exe"),
        os.path.expandvars(r"%ProgramFiles%\Microsoft\Edge\Application\msedge.exe"),
        os.path.expandvars(r"%ProgramFiles%\Google\Chrome\Application\chrome.exe"),
        os.path.expandvars(r"%LocalAppData%\Google\Chrome\Application\chrome.exe"),
    ]
    for c in cands:
        if os.path.exists(c):
            return c
    return shutil.which("msedge") or shutil.which("chrome")


def open_window(path=""):
    b = find_browser()
    if b:
        prof = os.path.join(os.environ.get("LOCALAPPDATA", ROOT), "NOMAD", "window")
        subprocess.Popen([b, f"--app={URL}{path}", f"--user-data-dir={prof}", "--window-size=1440,900", "--no-first-run"])
    else:
        webbrowser.open(URL + path)


def run_setup():
    ps1 = os.path.join(ROOT, "app", "setup.ps1")
    subprocess.Popen(["cmd", "/c", "start", "NOMAD setup", "powershell", "-NoProfile", "-ExecutionPolicy", "Bypass",
                      "-NoExit", "-File", ps1], cwd=ROOT)


def local_version():
    try:
        import re
        src = open(os.path.join(ROOT, "app", "nomad.py"), encoding="utf-8").read()
        return re.search(r'VERSION = "([^"]+)"', src).group(1)
    except Exception:
        return None


def running_version():
    import json
    import urllib.request
    try:
        return json.loads(urllib.request.urlopen(URL + "api/status", timeout=3).read()).get("version")
    except Exception:
        return None


def shutdown_running():
    import urllib.request
    try:
        urllib.request.urlopen(urllib.request.Request(URL + "api/shutdown", data=b"{}", method="POST"), timeout=3)
    except Exception:
        pass
    for _ in range(20):
        if not port_open():
            return True
        time.sleep(0.3)
    # oude versie zonder shutdown: proces op de poort stoppen
    out = subprocess.run(["netstat", "-ano", "-p", "TCP"], capture_output=True, text=True, creationflags=NOWIN).stdout
    for line in out.splitlines():
        parts = line.split()
        if len(parts) >= 5 and parts[1].endswith(f":{PORT}") and parts[3] == "LISTENING":
            subprocess.run(["taskkill", "/T", "/F", "/PID", parts[4]], capture_output=True, creationflags=NOWIN)
    time.sleep(1)
    return not port_open()


def start_server():
    global SERVER
    log = open(os.path.join(ROOT, "downloads", "nomad.log"), "a", encoding="utf-8")
    env = dict(os.environ, NOMAD_LAUNCHER="1")
    SERVER = subprocess.Popen([PY, os.path.join(ROOT, "app", "nomad.py"), "--no-browser"], cwd=ROOT, env=env,
                              stdout=log, stderr=log, creationflags=NOWIN)


def keeper():
    """Herstart de server als die om een herstart vraagt (exitcode 3, na een update)."""
    while True:
        time.sleep(1)
        if SERVER and SERVER.poll() == 3:
            start_server()


EXE_REPO = "mikeey77/nomad"


def self_update():
    """Haalt een nieuwe NOMAD.exe op de achtergrond; wordt actief bij de volgende start."""
    if not getattr(sys, "frozen", False):
        return
    import json
    import urllib.request
    exe = sys.executable
    stamp = os.path.join(ROOT, "app", ".exe_asset")
    try:
        old = exe[:-4] + ".old.exe"
        if os.path.exists(old):
            os.remove(old)
        rel = json.loads(urllib.request.urlopen(urllib.request.Request(
            f"https://api.github.com/repos/{EXE_REPO}/releases/tags/exe-latest", headers={"User-Agent": "NOMAD"}), timeout=10).read())
        asset = next(a for a in rel["assets"] if a["name"] == "NOMAD.exe")
        key = f'{asset["id"]}-{asset["updated_at"]}'
        cur = open(stamp).read().strip() if os.path.exists(stamp) else ""
        if not cur:  # eerste keer: huidige exe als bekend markeren
            open(stamp, "w").write(key)
            return
        if key == cur:
            return
        new = exe + ".new"
        with urllib.request.urlopen(asset["browser_download_url"], timeout=300) as r, open(new, "wb") as f:
            shutil.copyfileobj(r, f)
        os.replace(exe, old)      # een draaiende exe mag hernoemd worden
        os.replace(new, exe)
        open(stamp, "w").write(key)
    except Exception:
        pass


def splash():
    """Klein startscherm zolang de server opstart."""
    try:
        import tkinter as tk
    except Exception:
        return None
    root = tk.Tk()
    root.overrideredirect(True)
    root.configure(bg="#030806")
    w, h = 360, 150
    root.geometry(f"{w}x{h}+{(root.winfo_screenwidth() - w) // 2}+{(root.winfo_screenheight() - h) // 2}")
    root.attributes("-topmost", True)
    tk.Label(root, text="N O M A D", fg="#3dffa0", bg="#030806", font=("Consolas", 26, "bold")).pack(pady=(30, 4))
    msg = tk.Label(root, text="starting…", fg="#7a9a8a", bg="#030806", font=("Consolas", 10))
    msg.pack()
    bar = tk.Canvas(root, width=280, height=4, bg="#0b1a13", highlightthickness=0)
    bar.pack(pady=14)
    state = {"x": 0}

    def tick():
        if port_open():
            root.destroy()
            return
        if SERVER and SERVER.poll() is not None and SERVER.poll() != 3:
            root.destroy()
            return
        state["x"] = (state["x"] + 6) % 340
        bar.delete("all")
        bar.create_rectangle(state["x"] - 60, 0, state["x"], 4, fill="#3dffa0", width=0)
        root.after(30, tick)

    root.after(30, tick)
    return root


def stop_server():
    if SERVER and SERVER.poll() is None:
        subprocess.run(["taskkill", "/T", "/F", "/PID", str(SERVER.pid)], creationflags=NOWIN, capture_output=True)


def splash_wait():
    for _ in range(240):  # max 2 minuten
        if port_open():
            return True
        if SERVER and SERVER.poll() is not None:
            return False
        time.sleep(0.5)
    return False


def tray():
    try:
        import pystray
        from PIL import Image
    except ImportError:
        while SERVER and SERVER.poll() is None:
            time.sleep(2)
        return
    ico = os.path.join(getattr(sys, "_MEIPASS", ROOT), "nomad.ico")
    image = Image.open(ico) if os.path.exists(ico) else Image.new("RGB", (64, 64), "#3dffa0")

    def restart(icon, _):
        stop_server()
        start_server()
        if splash_wait():
            open_window()

    def quit_(icon, _):
        stop_server()
        icon.stop()

    menu = pystray.Menu(
        pystray.MenuItem("Open NOMAD", lambda i, _: open_window(), default=True),
        pystray.MenuItem("Open in browser", lambda i, _: webbrowser.open(URL)),
        pystray.MenuItem("Phone / iPad (QR)", lambda i, _: open_window("#home")),
        pystray.MenuItem("Downloads & updates", lambda i, _: open_window("#dl")),
        pystray.Menu.SEPARATOR,
        pystray.MenuItem("Restart", restart),
        pystray.MenuItem("Run setup", lambda i, _: run_setup()),
        pystray.MenuItem("Quit NOMAD", quit_),
    )
    pystray.Icon("NOMAD", image, "PROJECT NOMAD", menu).run()


def main():
    os.makedirs(os.path.join(ROOT, "downloads"), exist_ok=True)
    if not os.path.exists(PY):
        if msg("NOMAD is nog niet ingesteld op deze schijf.\n\nNu de setup starten?", "NOMAD", 0x04 | 0x20) == 6:
            run_setup()
        return
    threading.Thread(target=self_update, daemon=True).start()
    # 2. draait er al een NOMAD? Zelfde versie: alleen venster openen. Oude versie: vervangen.
    if port_open():
        if running_version() == local_version():
            open_window()
            return
        shutdown_running()
    start_server()
    sp = splash()
    if sp:
        sp.mainloop()
    if not splash_wait():
        msg("NOMAD kon niet starten.\nKijk in downloads\\nomad.log voor details.", "NOMAD", 0x10)
        return
    # 3. venster + tray
    threading.Thread(target=keeper, daemon=True).start()
    open_window()
    tray()
    stop_server()


if __name__ == "__main__":
    if "--setup" in sys.argv:
        run_setup()
    else:
        main()
