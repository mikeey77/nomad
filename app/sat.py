"""NOMAD v0.17 — offline satellite layer from NASA Blue Marble Next Generation (public domain, 2004 monthly
cloud-free composite with topography & bathymetry shading). The images are downloaded once and turned into a
raster .pmtiles file (Web Mercator, JPEG tiles) right here, so the map can use them fully offline."""
import io
import math
import os
import sqlite3
import subprocess
import sys

N = sys.modules['__main__'] if hasattr(sys.modules.get('__main__'), 'STATE') else __import__('nomad')

BASE = "https://assets.science.nasa.gov/content/dam/science/esd/eo/images/bmng/bmng-topography-bathymetry/june/"
VARIANTS = {
    # id: (title, summary, [(file, west, south, east, north)], max zoom, approx output size)
    "world": ("Satellite · world (2 km/pixel)",
              "NASA Blue Marble — cloud-free satellite image of the whole Earth with relief shading. Good for countries and regions (zoom 0-7). Public domain. Built on your PC after download (~5 min).",
              [("world.topo.bathy.200406.3x21600x10800.jpg", -180, -90, 180, 90)], 7, 700 << 20),
    "detail": ("Satellite · world in detail (500 m/pixel)",
               "NASA Blue Marble at full resolution: 8 tiles of 21600×21600 px. Good down to towns and valleys (zoom 0-9). Public domain. Needs ~3 GB free RAM; building takes 30-90 min.",
               [(f"world.topo.bathy.200406.3x21600x21600.{c}{r}.jpg", -180 + 90 * i, 0 if r == 1 else -90, -90 + 90 * i, 90 if r == 1 else 0)
                for r in (1, 2) for i, c in enumerate("ABCD")], 9, 6 << 30),
}


def target():
    return os.path.join(N.MAP_DIR, "satellite", "satellite.pmtiles")


def items():
    have = N.map_file("satellite")
    out = []
    for vid, (title, summ, files, z, size) in VARIANTS.items():
        out.append({"id": "sat:" + vid, "kind": "sat", "cat": "maps", "title": title, "summary": summ,
                    "file": "satellite.pmtiles", "date": "2004", "size": size, "installed": bool(have),
                    "url": BASE + files[0][0]})
    return out


def _deps(job):
    try:
        import numpy  # noqa: F401
        import PIL  # noqa: F401
        import pmtiles  # noqa: F401
        return
    except Exception:
        pass
    job["msg"] = "installing image tools (Pillow, NumPy, pmtiles)…"
    r = subprocess.run([sys.executable, "-m", "pip", "install", "--quiet", "pillow", "numpy", "pmtiles"],
                       capture_output=True, text=True, creationflags=getattr(subprocess, "CREATE_NO_WINDOW", 0))
    if r.returncode != 0:
        raise RuntimeError("pip: " + (r.stderr or r.stdout)[-300:])


def _tile_lat(y, z):
    n = math.pi - 2 * math.pi * y / (1 << z)
    return math.degrees(math.atan(math.sinh(n)))


def build(job, vid):
    import numpy as np
    from PIL import Image
    Image.MAX_IMAGE_PIXELS = None
    _deps(job)
    title, _, files, maxz, _ = VARIANTS[vid]
    tmpdir = os.path.join(N.DL_DIR, "satellite-build")
    os.makedirs(tmpdir, exist_ok=True)
    # 1) download the source images (resumable)
    for i, (f, *_) in enumerate(files):
        dest = os.path.join(tmpdir, f)
        if not os.path.isfile(dest):
            job["msg"] = f"downloading NASA image {i + 1}/{len(files)}…"
            job["done"] = 0
            N.download(job, BASE + f, dest)
    # 2) cut Web-Mercator tiles at the highest zoom, straight from each source image
    db_path = os.path.join(tmpdir, f"tiles-{vid}.sqlite")
    db = sqlite3.connect(db_path)
    db.execute("CREATE TABLE IF NOT EXISTS t (z INT, x INT, y INT, d BLOB, PRIMARY KEY (z, x, y))")
    n = 1 << maxz
    total = n * n
    done = db.execute("SELECT COUNT(*) FROM t WHERE z=?", (maxz,)).fetchone()[0]
    for si, (f, west, south, east, north) in enumerate(files):
        x0 = int((west + 180) / 360 * n)
        x1 = int(round((east + 180) / 360 * n))
        ys = [y for y in range(n) if south - 1e-9 <= (_tile_lat(y, maxz) + _tile_lat(y + 1, maxz)) / 2 <= north + 1e-9]
        if db.execute("SELECT COUNT(*) FROM t WHERE z=? AND x>=? AND x<?", (maxz, x0, x1)).fetchone()[0] >= (x1 - x0) * len(ys):
            continue
        job["msg"] = f"reading NASA image {si + 1}/{len(files)}…"
        img = np.asarray(Image.open(os.path.join(tmpdir, f)).convert("RGB"))
        H, W = img.shape[:2]
        for x in range(x0, x1):
            lons = (x + (np.arange(256) + 0.5) / 256) / n * 360 - 180
            sx = np.clip(((lons - west) / (east - west) * W).astype(np.int64), 0, W - 1)
            batch = []
            for y in ys:
                if db.execute("SELECT 1 FROM t WHERE z=? AND x=? AND y=?", (maxz, x, y)).fetchone():
                    continue
                yy = (y + (np.arange(256) + 0.5) / 256) / n
                lats = np.degrees(np.arctan(np.sinh(np.pi - 2 * np.pi * yy)))
                sy = np.clip(((north - lats) / (north - south) * H).astype(np.int64), 0, H - 1)
                tile = img[sy[:, None], sx[None, :]]
                buf = io.BytesIO()
                Image.fromarray(tile).save(buf, "JPEG", quality=82, optimize=True)
                batch.append((maxz, x, y, buf.getvalue()))
            db.executemany("INSERT OR REPLACE INTO t VALUES (?,?,?,?)", batch)
            db.commit()
            done += len(batch)
            job["msg"] = f"building satellite tiles (zoom {maxz}) {done * 100 // total}%"
            if job.get("cancel"):
                raise RuntimeError("cancelled")
        del img
    # 3) lower zoom levels: merge 4 children into one tile
    for z in range(maxz - 1, -1, -1):
        m = 1 << z
        job["msg"] = f"building zoom {z}…"
        for x in range(m):
            for y in range(m):
                if db.execute("SELECT 1 FROM t WHERE z=? AND x=? AND y=?", (z, x, y)).fetchone():
                    continue
                canvas = Image.new("RGB", (512, 512), (10, 30, 60))
                for dx in (0, 1):
                    for dy in (0, 1):
                        r = db.execute("SELECT d FROM t WHERE z=? AND x=? AND y=?", (z + 1, 2 * x + dx, 2 * y + dy)).fetchone()
                        if r:
                            canvas.paste(Image.open(io.BytesIO(r[0])), (dx * 256, dy * 256))
                buf = io.BytesIO()
                canvas.resize((256, 256), Image.LANCZOS).save(buf, "JPEG", quality=82, optimize=True)
                db.execute("INSERT OR REPLACE INTO t VALUES (?,?,?,?)", (z, x, y, buf.getvalue()))
        db.commit()
    # 4) write the .pmtiles file
    from pmtiles.tile import zxy_to_tileid, TileType, Compression
    from pmtiles.writer import Writer
    job["msg"] = "writing satellite.pmtiles…"
    out = target()
    os.makedirs(os.path.dirname(out), exist_ok=True)
    tmp = out + ".part"
    rows = [(zxy_to_tileid(z, x, y), z, x, y) for z, x, y in db.execute("SELECT z, x, y FROM t")]
    rows.sort()
    with open(tmp, "wb") as fh:
        w = Writer(fh)
        for tid, z, x, y in rows:
            w.write_tile(tid, db.execute("SELECT d FROM t WHERE z=? AND x=? AND y=?", (z, x, y)).fetchone()[0])
        w.finalize({"tile_type": TileType.JPEG, "tile_compression": Compression.NONE, "min_zoom": 0, "max_zoom": maxz,
                    "min_lon_e7": -1800000000, "min_lat_e7": -850511287, "max_lon_e7": 1800000000, "max_lat_e7": 850511287,
                    "center_zoom": 2, "center_lon_e7": 0, "center_lat_e7": 0},
                   {"name": title, "attribution": "NASA Blue Marble Next Generation (Reto Stöckli, NASA Earth Observatory)",
                    "type": "baselayer", "format": "jpg"})
    db.close()
    try:
        import more
        more.close_handles()
    except Exception:
        pass
    os.replace(tmp, out)
    for f, *_ in files:
        try:
            os.remove(os.path.join(tmpdir, f))
        except OSError:
            pass
    try:
        os.remove(db_path)
        os.rmdir(tmpdir)
    except OSError:
        pass
    N.STATE["data_version"] = N.STATE.get("data_version", 0) + 1
