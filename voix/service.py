# /// script
# requires-python = ">=3.12"
# dependencies = ["numpy", "httpx", "soundfile", "faster-whisper", "piper-tts"]
# ///
"""The local voice of Lun'Luxuria: transcription, synthesis, RVC, and who holds the microphone.

Nothing it hears or says leaves the PC, except to a voice converter on this machine. Listens on 127.0.0.1 only.

  uv run voix/service.py --stt faster:small --tts piper:<voix.onnx> [--rvc http://127.0.0.1:18888]

  POST /stt   raw float32 LE at 16 kHz    -> {"text", "confidence", "ms"}
  POST /tts   {"text"}                    -> raw float32 LE, X-Sample-Rate, X-Ms
  GET  /micro                             -> {"apps": ["..."]}, the apps holding the microphone
  GET  /ping                              -> {"ok": true, "stt", "tts", "rvc"}
"""
import argparse
import io
import json
import sys
import threading
import time
from http.server import BaseHTTPRequestHandler, ThreadingHTTPServer

import httpx
import numpy as np
import soundfile as sf

SR_STT = 16000
MAX_BODY = 64 * 1024 * 1024
ORIGINS = ("http://127.0.0.1:5180", "http://localhost:5180", "tauri://localhost", "http://tauri.localhost")


def allowed(headers, origins):
    """Any page open in a browser can reach 127.0.0.1: only ours may. The host check stops DNS rebinding."""
    host = (headers.get("Host") or "").rsplit(":", 1)[0]
    origin = headers.get("Origin")
    return host in ("127.0.0.1", "localhost") and (origin is None or origin in origins)


def make_stt(spec, lang):
    kind, _, arg = spec.partition(":")
    if kind == "faster":
        from faster_whisper import WhisperModel

        model = WhisperModel(arg or "small", device="cpu", compute_type="int8")

        def run(audio):
            segs, _ = model.transcribe(audio, language=lang, beam_size=1, condition_on_previous_text=False)
            segs = list(segs)
            conf = float(np.exp(np.mean([s.avg_logprob for s in segs]))) if segs else 0.0
            return " ".join(s.text.strip() for s in segs).strip(), conf

        return run
    if kind == "whisper-server":  # whisper.cpp keeps its model loaded, Vulkan build for the RX
        def run(audio):
            buf = io.BytesIO()
            sf.write(buf, audio, SR_STT, format="WAV")
            r = httpx.post(f"{arg}/inference", files={"file": ("a.wav", buf.getvalue())},
                           data={"language": lang, "response_format": "json"}, timeout=60)
            r.raise_for_status()
            return r.json()["text"].strip(), 0.9  # shortcut: this server gives no confidence, fixed above the gesture bar

        return run
    raise SystemExit(f"stt inconnu : {spec}")


def make_tts(spec):
    kind, _, arg = spec.partition(":")
    if kind == "piper":
        from piper import PiperVoice

        voice = PiperVoice.load(arg)

        def run(text):
            chunks = list(voice.synthesize(text))
            return np.concatenate([c.audio_float_array for c in chunks]), chunks[0].sample_rate

        return run
    if kind == "kokoro":
        from kokoro_onnx import Kokoro

        model, voices = arg.rsplit(":", 1)
        k = Kokoro(model, voices)
        return lambda text: k.create(text, voice="ff_siwa", speed=1.0, lang="fr-fr")
    raise SystemExit(f"tts inconnu : {spec}")


def make_rvc(url):
    """w-okada REST: raw float32 LE at 48 kHz, one call at a time."""
    if not url:
        return None
    lock = threading.Lock()

    def run(audio, sr):
        x = np.interp(np.arange(0, len(audio), sr / 48000), np.arange(len(audio)), audio).astype("<f4")
        with lock:
            r = httpx.post(f"{url}/api/voice-changer/convert_chunk", files={"waveform": x.tobytes()}, timeout=30)
        r.raise_for_status()
        return np.frombuffer(r.content, "<f4"), 48000

    return run


def apps_on_microphone():
    """Windows' own record of who holds the microphone: LastUsedTimeStop is 0 while an app does."""
    try:
        import winreg
    except ImportError:
        return []
    root_path = r"Software\Microsoft\Windows\CurrentVersion\CapabilityAccessManager\ConsentStore\microphone"

    def subkeys(key):
        i = 0
        while True:
            try:
                yield winreg.EnumKey(key, i)
            except OSError:
                return
            i += 1

    def in_use(key, sub):
        try:
            with winreg.OpenKey(key, sub) as k:
                start = winreg.QueryValueEx(k, "LastUsedTimeStart")[0]
                stop = winreg.QueryValueEx(k, "LastUsedTimeStop")[0]
                return start != 0 and stop == 0
        except OSError:
            return False

    apps = set()
    for hive in (winreg.HKEY_CURRENT_USER, winreg.HKEY_LOCAL_MACHINE):
        try:
            with winreg.OpenKey(hive, root_path) as root:
                for sub in subkeys(root):
                    if sub == "NonPackaged":
                        with winreg.OpenKey(root, sub) as np_key:
                            apps |= {s.split("#")[-1] for s in subkeys(np_key) if in_use(np_key, s)}
                    elif in_use(root, sub):
                        apps.add(sub)
        except OSError:
            pass
    return sorted(apps)


def serve(stt, tts, rvc, names, port, origins=ORIGINS):
    stt_lock = threading.Lock()
    tts_lock = threading.Lock()

    class Handler(BaseHTTPRequestHandler):
        def _json(self, code, data):
            body = json.dumps(data).encode()
            self.send_response(code)
            self.send_header("Content-Type", "application/json")
            self.send_header("Content-Length", str(len(body)))
            self.end_headers()
            self.wfile.write(body)

        def _body(self):
            n = int(self.headers.get("Content-Length", 0))
            if n > MAX_BODY:
                raise ValueError("corps trop grand")
            return self.rfile.read(n)

        def _refused(self):
            if allowed(self.headers, origins):
                return False
            self._json(403, {"error": "origine refusée"})
            return True

        def do_GET(self):
            if self._refused():
                return
            if self.path == "/ping":
                self._json(200, {"ok": True, **names})
            elif self.path == "/micro":
                self._json(200, {"apps": apps_on_microphone()})
            else:
                self._json(404, {"error": "inconnu"})

        def do_POST(self):
            if self._refused():
                return
            t0 = time.perf_counter()
            try:
                if self.path == "/stt":
                    audio = np.frombuffer(self._body(), "<f4")
                    with stt_lock:
                        text, conf = stt(audio)
                    self._json(200, {"text": text, "confidence": conf, "ms": round((time.perf_counter() - t0) * 1000)})
                elif self.path == "/tts":
                    text = json.loads(self._body())["text"]
                    with tts_lock:
                        audio, sr = tts(text)
                        if rvc:
                            audio, sr = rvc(np.asarray(audio, dtype="<f4"), sr)
                    data = np.asarray(audio, dtype="<f4").tobytes()
                    self.send_response(200)
                    self.send_header("Content-Type", "application/octet-stream")
                    self.send_header("Content-Length", str(len(data)))
                    self.send_header("X-Sample-Rate", str(sr))
                    self.send_header("X-Ms", str(round((time.perf_counter() - t0) * 1000)))
                    self.end_headers()
                    self.wfile.write(data)
                else:
                    self._json(404, {"error": "inconnu"})
            except Exception as err:  # a failed sentence is said to the client, the service stays up
                print(f"{self.path}: {err}", file=sys.stderr, flush=True)
                self._json(500, {"error": str(err)})

        def log_message(self, *_):  # what he says never lands in a log
            pass

    server = ThreadingHTTPServer(("127.0.0.1", port), Handler)
    print(f"voix prête sur 127.0.0.1:{port}", flush=True)
    server.serve_forever()


def main():
    ap = argparse.ArgumentParser()
    ap.add_argument("--stt", default="faster:small")
    ap.add_argument("--tts", required=True)
    ap.add_argument("--rvc", default="")
    ap.add_argument("--port", type=int, default=8793)
    ap.add_argument("--lang", default="fr", help="langue transcrite")
    ap.add_argument("--origin", action="append", help="page autorisée, en plus de celles de l'appli")
    a = ap.parse_args()
    names = {"stt": a.stt, "tts": a.tts.split(":")[0], "rvc": bool(a.rvc)}
    serve(make_stt(a.stt, a.lang), make_tts(a.tts), make_rvc(a.rvc), names, a.port, (*ORIGINS, *(a.origin or [])))


if __name__ == "__main__":
    main()
