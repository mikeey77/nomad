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
    subprocess.Popen(["cmd", "/c", "start", "", os.path.join(ROOT, "Setup NOMAD.bat")], cwd=ROOT)


def start_server():
    global SERVER
    log = open(os.path.join(ROOT, "downloads", "nomad.log"), "a", encoding="utf-8")
    SERVER = subprocess.Popen([PY, os.path.join(ROOT, "app", "nomad.py"), "--no-browser"], cwd=ROOT,
                              stdout=log, stderr=log, creationflags=NOWIN)


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
    if port_open():  # draait al
        open_window()
        return
    if not os.path.exists(PY):
        if msg("NOMAD is nog niet ingesteld op deze schijf.\n\nNu 'Setup NOMAD' starten?", "NOMAD", 0x04 | 0x20) == 6:
            run_setup()
        return
    # 1. app bijwerken (stil, max 90 s)
    try:
        subprocess.run([PY, os.path.join(ROOT, "app", "update.py")], cwd=ROOT, creationflags=NOWIN, timeout=90,
                       stdout=open(os.path.join(ROOT, "downloads", "update.log"), "w"), stderr=subprocess.STDOUT)
    except Exception:
        pass
    # 2. server starten
    start_server()
    if not splash_wait():
        msg("NOMAD kon niet starten.\nKijk in downloads\\nomad.log voor details.", "NOMAD", 0x10)
        return
    # 3. venster + tray
    open_window()
    tray()
    stop_server()


if __name__ == "__main__":
    if "--setup" in sys.argv:
        run_setup()
    else:
        main()
