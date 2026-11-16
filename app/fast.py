"""NOMAD v0.12: fast offline translation (Argos models on CTranslate2), language detection,
vision (photo recognition) helpers and a real update check for AI models."""
import glob
import hashlib
import json
import os
import re
import shutil
import subprocess
import threading
import urllib.request
import zipfile

import nomad as N

# ───────── fast translation (Argos Translate models, run with CTranslate2) ─────────
ARGOS_INDEX = "https://raw.githubusercontent.com/argosopentech/argospm-index/main/index.json"
MT_LANGS = {"nl": "Dutch", "de": "German", "fr": "French", "es": "Spanish", "it": "Italian", "pt": "Portuguese",
            "pl": "Polish", "tr": "Turkish", "ar": "Arabic", "uk": "Ukrainian", "ru": "Russian", "zh": "Chinese", "ja": "Japanese"}
MT = {"cache": {}, "lock": threading.Lock()}


def mt_dir():
    return os.path.join(N.ROOT, "ai", "translate")


def _pair_dir(a, b):
    return os.path.join(mt_dir(), f"{a}_{b}")


def _model_paths(a, b):
    """(ctranslate2 model dir, sentencepiece file) inside an extracted Argos package, or None."""
    d = _pair_dir(a, b)
    if not os.path.isdir(d):
        return None
    model = next((os.path.dirname(p) for p in glob.glob(os.path.join(d, "**", "model.bin"), recursive=True)), None)
    spm = next(iter(glob.glob(os.path.join(d, "**", "sentencepiece.model"), recursive=True)), None)
    return (model, spm) if model and spm else None


def mt_installed(code):
    return bool(_model_paths("en", code) and _model_paths(code, "en"))


def mt_engine_ok():
    try:
        import ctranslate2  # noqa: F401
        import sentencepiece  # noqa: F401
        return True
    except Exception:
        return False


def mt_items():
    out = []
    for code, name in MT_LANGS.items():
        out.append({"id": "mt:" + code, "kind": "mt", "cat": "ai", "title": f"Fast translator · {name} ↔ English",
                    "summary": "Instant offline translation (Argos models). Other language pairs go via English. ~10× faster than the AI.",
                    "file": code, "date": "", "size": 230 << 20, "installed": mt_installed(code)})
    return out


def _index():
    cache = os.path.join(N.DL_DIR, "argos-index.json")
    try:
        with urllib.request.urlopen(urllib.request.Request(ARGOS_INDEX, headers={"User-Agent": "NOMAD"}), timeout=20) as r:
            data = r.read()
        json.loads(data)
        with open(cache, "wb") as f:
            f.write(data)
    except Exception:
        if not os.path.isfile(cache):
            raise
        with open(cache, "rb") as f:
            data = f.read()
    return json.loads(data)


def install_mt(job, code):
    import sys as _s
    if not mt_engine_ok():
        job["msg"] = "installing translation engine (CTranslate2)…"
        r = subprocess.run([_s.executable, "-m", "pip", "install", "--quiet", "ctranslate2", "sentencepiece"],
                           capture_output=True, text=True, creationflags=getattr(subprocess, "CREATE_NO_WINDOW", 0))
        if r.returncode != 0:
            raise RuntimeError("pip: " + (r.stderr or r.stdout)[-300:])
    idx = _index()
    for a, b in (("en", code), (code, "en")):
        if _model_paths(a, b):
            continue
        pk = max((p for p in idx if p.get("from_code") == a and p.get("to_code") == b),
                 key=lambda p: [int(x) for x in re.findall(r"\d+", p.get("package_version", "0"))], default=None)
        if not pk:
            raise RuntimeError(f"no Argos model for {a}→{b}")
        job["msg"] = f"downloading {a}→{b} model…"
        job["done"] = 0
        zpath = os.path.join(N.DL_DIR, f"translate-{a}_{b}.argosmodel")
        N.download(job, pk["links"][0], zpath)
        job["msg"] = f"unpacking {a}→{b}…"
        tmp = _pair_dir(a, b) + ".tmp"
        shutil.rmtree(tmp, ignore_errors=True)
        with zipfile.ZipFile(zpath) as z:
            z.extractall(tmp)
        shutil.rmtree(_pair_dir(a, b), ignore_errors=True)
        os.replace(tmp, _pair_dir(a, b))
        os.remove(zpath)
        if not _model_paths(a, b):
            raise RuntimeError(f"{a}→{b}: unsupported model format")
    MT["cache"].clear()


def remove_mt(code):
    MT["cache"].clear()
    for a, b in (("en", code), (code, "en")):
        shutil.rmtree(_pair_dir(a, b), ignore_errors=True)
    return {"ok": True}


def _translator(a, b):
    key = (a, b)
    if key not in MT["cache"]:
        import ctranslate2
        import sentencepiece
        model, spm = _model_paths(a, b)
        tr = ctranslate2.Translator(model, device="cpu", compute_type="int8", intra_threads=max(1, (os.cpu_count() or 4) - 1))
        MT["cache"][key] = (tr, sentencepiece.SentencePieceProcessor(model_file=spm))
    return MT["cache"][key]


SENT_RE = re.compile(r"(?<=[.!?。！？])\s+")


def _run(a, b, sentences):
    tr, sp = _translator(a, b)
    toks = [sp.encode(s, out_type=str) for s in sentences]
    res = tr.translate_batch(toks, beam_size=2, max_decoding_length=300, replace_unknowns=True)
    return [sp.decode(r.hypotheses[0]).replace("▁", " ").strip() for r in res]


def route(src, dst):
    """List of model pairs needed for src→dst, or None when not installed."""
    if src == dst:
        return []
    hops = [(src, dst)] if "en" in (src, dst) else [(src, "en"), ("en", dst)]
    return hops if all(_model_paths(a, b) for a, b in hops) else None


def translate_fast(text, src, dst, emit):
    hops = route(src, dst)
    with MT["lock"]:
        for para in text.split("\n"):
            if not para.strip():
                emit("\n")
                continue
            sents = [s for s in SENT_RE.split(para.strip()) if s]
            for a, b in hops:
                sents = _run(a, b, sents)
            emit(" ".join(sents) + "\n")


# ───────── language detection (offline, simple but good enough) ─────────
STOPS = {
    "en": "the and is are of to in that it you for was with on as have not this be at by what your from they will can",
    "nl": "de het een en is van dat niet je ik zijn op te met voor er maar ook als wat dan bij nog kan geen wij jij hij",
    "de": "der die das und ist nicht ich ein eine zu mit sie es auf für den dem sich auch wie wir aber noch kann",
    "fr": "le la les et est un une des pas je que en du dans pour qui il elle nous vous sur avec ce mais très",
    "es": "el la los las y es un una de que no en por para con se lo como pero muy está yo tú usted nosotros",
    "it": "il lo la gli le e è un una di che non in per con si sono come ma anche molto questo io tu",
    "pt": "o a os as e é um uma de que não em por para com se como mas muito está eu você nós",
    "pl": "i w nie się na to jest że z do jak ale co tak jestem mnie jego jej czy",
    "tr": "ve bir bu da de için ne ile çok ben sen o var yok değil gibi ama",
}
STOPS = {k: set(v.split()) for k, v in STOPS.items()}


def detect(text):
    t = text.strip()
    if not t:
        return "en"
    if re.search(r"[぀-ヿ]", t):
        return "ja"
    if re.search(r"[一-鿿]", t):
        return "zh"
    if re.search(r"[؀-ۿ]", t):
        return "ar"
    if re.search(r"[Ѐ-ӿ]", t):
        return "uk" if re.search(r"[їієґ]", t.lower()) else "ru"
    words = re.findall(r"[a-zà-ÿąćęłńóśźżçğışöü']+", t.lower())
    best, score = "en", 0
    for lang, s in STOPS.items():
        n = sum(1 for w in words if w in s)
        if n > score:
            best, score = lang, n
    return best


# ───────── vision (photo recognition) ─────────
VISION_HINTS = ("moondream", "llava", "gemma3:4b", "gemma3:12b", "qwen2.5vl", "llama3.2-vision", "minicpm-v", "granite3.2-vision")


def is_vision(model):
    m = (model or "").lower()
    return any(h in m for h in VISION_HINTS) and m not in ("gemma3:1b",)


def vision_model():
    have = N.ai_models()
    cur = N.CFG.get("ai_model")
    if is_vision(cur) and any(h.split(":")[0] == cur.split(":")[0] for h in have):
        return cur
    pref = N.CFG.get("vision_model")
    order = ([pref] if pref else []) + ["qwen2.5vl:3b", "gemma3:4b", "moondream", "llava:7b"]
    for m in order:
        for h in have:
            if h == m or h == m + ":latest" or h.startswith(m + ":"):
                return h
    return next((h for h in have if is_vision(h)), None)


def identify(model, image_b64):
    """Short name of the main subject in a photo (used to search the library)."""
    payload = {"model": model, "stream": False, "keep_alive": "30m", "options": {"temperature": 0, "num_predict": 24},
               "messages": [{"role": "user", "images": [image_b64],
                             "content": "What is the main subject of this photo? Answer with only its most specific common name "
                                        "(for a plant or animal: the species name), max 5 words, no sentence."}]}
    req = urllib.request.Request(f"http://127.0.0.1:{N.CFG['ollama_port']}/api/chat", data=json.dumps(payload).encode(),
                                 headers={"Content-Type": "application/json"})
    with urllib.request.urlopen(req, timeout=300) as r:
        txt = (json.loads(r.read()).get("message") or {}).get("content", "")
    txt = re.sub(r"[*_`\"'.\n]+", " ", txt).strip()
    return " ".join(txt.split()[:6])


# ───────── AI model updates: compare the local manifest digest with the registry ─────────
def model_update_available(name):
    """True/False, or None when it can't be checked (offline)."""
    try:
        tags = N.http_json(f"http://127.0.0.1:{N.CFG['ollama_port']}/api/tags", timeout=5).get("models", [])
        local = next((m.get("digest", "") for m in tags if m.get("name") in (name, name + ":latest")), None)
        if not local:
            return None
        repo, _, tag = name.partition(":")
        tag = tag or "latest"
        ns = repo if "/" in repo else "library/" + repo
        req = urllib.request.Request(f"https://registry.ollama.ai/v2/{ns}/manifests/{tag}",
                                     headers={"Accept": "application/vnd.docker.distribution.manifest.v2+json", "User-Agent": "NOMAD"})
        with urllib.request.urlopen(req, timeout=20) as r:
            body = r.read()
            remote = r.headers.get("Docker-Content-Digest", "")
        digest = hashlib.sha256(body).hexdigest()
        local = local.replace("sha256:", "")
        return not (local == digest or remote.replace("sha256:", "") == local)
    except Exception:
        return None
