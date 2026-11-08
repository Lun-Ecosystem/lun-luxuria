# /// script
# requires-python = ">=3.12"
# dependencies = ["numpy", "httpx", "soundfile", "faster-whisper", "piper-tts"]
# ///
"""The local voice of Lun'Luxuria: transcription, synthesis, RVC, and who holds the microphone.

Nothing it hears or says leaves the PC, except to a voice converter on this machine. Listens on 127.0.0.1 only.

  uv run voix/service.py --stt faster:small --tts piper:<voix.onnx> [--rvc http://127.0.0.1:18888 [--rvc-gain 2.0]]

  POST /stt   raw float32 LE at 16 kHz    -> {"text", "confidence", "ms"}
  POST /tts   {"text"}                    -> raw float32 LE, X-Sample-Rate, X-Ms, the whole sentence
  GET  /micro                             -> {"apps": ["..."]}, the apps holding the microphone
  GET  /ping                              -> {"ok": true, "stt", "tts", "rvc"}
  GET  /etat                              -> {"stt": {"kind", "up"}, "rvc": {"up"} | null}, the programs it calls
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
DRAIN_MAX = 1024 * 1024  # what a refused page may make the service read, at most
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
                           data={"language": lang, "response_format": "verbose_json", "token_timestamps": "false"},
                           timeout=60)
            r.raise_for_status()
            body = r.json()
            # Text tokens only, unlike faster-whisper's avg_logprob; whisper.cpp's own avg_logprob counts special tokens.
            p = [w["probability"] for s in body.get("segments", []) for w in s.get("words", [])]
            conf = float(np.exp(np.mean(np.log(np.maximum(p, 1e-6))))) if p else 0.0
            return body["text"].strip(), conf

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


RVC_BLOCK = 24000  # 0.5 s at 48 kHz, the size kept by ear on the desktop (ADR 0011)
RVC_LEAD = 2400  # 50 ms of silence in front, so the first word is not eaten


def make_rvc(url, gain=2.0):
    """w-okada REST: raw float32 LE at 48 kHz, converted in 0.5 s blocks, one call at a time. The whole sentence back."""
    if not url:
        return None
    lock = threading.Lock()

    def run(audio, sr):
        x = np.interp(np.arange(0, len(audio), sr / 48000), np.arange(len(audio)), audio).astype("<f4")
        x = np.concatenate([np.zeros(RVC_LEAD, "<f4"), x])
        useful = len(x)
        x = np.pad(x, (0, -len(x) % RVC_BLOCK))
        out = []
        with lock:
            for i in range(0, len(x), RVC_BLOCK):
                r = httpx.post(f"{url}/api/voice-changer/convert_chunk",
                               files={"waveform": x[i:i + RVC_BLOCK].tobytes()}, timeout=30)
                r.raise_for_status()
                y = np.frombuffer(r.content, "<f4")[:RVC_BLOCK]
                out.append(np.pad(y, (0, RVC_BLOCK - len(y))))
        return np.clip(np.concatenate(out)[:useful] * gain, -1, 1).astype("<f4"), 48000

    return run


def reach(url):
    """Any answer counts: the program is there. Short, the screen asks often."""
    try:
        httpx.get(url, timeout=0.5)
        return True
    except Exception:  # refused, too slow, or an address that is not one: not answering
        return False


def bricks(stt_spec, rvc_url):
    """whisper-server and RVC run on their own: the screen says whether they answer at their address."""
    kind, _, arg = stt_spec.partition(":")
    return {
        "stt": {"kind": kind, "up": reach(arg) if kind == "whisper-server" else True},
        "rvc": {"up": reach(rvc_url)} if rvc_url else None,
    }


HELD_MAX_S = 12 * 3600


def unix_time(filetime):
    """A registry FILETIME: 100 ns steps since 1601-01-01, in UTC, like time.time()."""
    return filetime / 1e7 - 11644473600


def app_name(key):
    """A NonPackaged key is the program's path with # for \\: the client sees its last piece, case kept."""
    return key.split("#")[-1]


def held(entries, now):
    """The open entries, (name, start), that still mean a microphone held.

    shortcut: an entry left open by a crash counts up to 12 h, and a call longer than 12 h no longer counts; the apps
    ignored in the settings stay the way out. Check the program's own start time if the desktop shows a recent crash.
    """
    return sorted({name for name, start in entries if now - unix_time(start) < HELD_MAX_S})


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

    def opened(key, sub):
        """The start of an entry still open, None otherwise."""
        try:
            with winreg.OpenKey(key, sub) as k:
                start = winreg.QueryValueEx(k, "LastUsedTimeStart")[0]
                stop = winreg.QueryValueEx(k, "LastUsedTimeStop")[0]
                return start if start != 0 and stop == 0 else None
        except OSError:
            return None

    entries = []
    for hive in (winreg.HKEY_CURRENT_USER, winreg.HKEY_LOCAL_MACHINE):
        try:
            with winreg.OpenKey(hive, root_path) as root:
                for sub in subkeys(root):
                    if sub == "NonPackaged":
                        with winreg.OpenKey(root, sub) as np_key:
                            entries += [(app_name(s), t) for s in subkeys(np_key) if (t := opened(np_key, s))]
                    elif t := opened(root, sub):
                        entries.append((sub, t))
        except OSError:
            pass
    return held(entries, time.time())


def serve(stt, tts, rvc, names, port, origins=ORIGINS, state=lambda: {}):
    stt_lock = threading.Lock()
    tts_lock = threading.Lock()

    class Handler(BaseHTTPRequestHandler):
        timeout = 5  # a client that announces a body and sends nothing holds no thread for long

        def end_headers(self):
            # The window's page lives on another origin than the service: our pages, and only they, may read.
            origin = self.headers.get("Origin")
            if origin and allowed(self.headers, origins):
                self.send_header("Access-Control-Allow-Origin", origin)
                self.send_header("Vary", "Origin")
                self.send_header("Access-Control-Expose-Headers", "X-Sample-Rate, X-Ms")
            super().end_headers()

        def do_OPTIONS(self):
            if self._refused():
                return
            self.send_response(204)
            self.send_header("Access-Control-Allow-Methods", "GET, POST")
            self.send_header("Access-Control-Allow-Headers", "Content-Type")
            if self.headers.get("Access-Control-Request-Private-Network") == "true":
                self.send_header("Access-Control-Allow-Private-Network", "true")
            self.send_header("Access-Control-Max-Age", "600")
            self.send_header("Content-Length", "0")
            self.end_headers()

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
            # Windows resets a socket closed with unread bytes, often before the 403 is read: drain a small body.
            try:
                n = int(self.headers.get("Content-Length", 0))
                if 0 < n <= DRAIN_MAX:
                    self.rfile.read(n)
            except (ValueError, OSError):  # unreadable length, or a body announced and never sent
                pass
            self._json(403, {"error": "origine refusée"})
            return True

        def do_GET(self):
            if self._refused():
                return
            if self.path == "/ping":
                self._json(200, {"ok": True, **names})
            elif self.path == "/etat":
                self._json(200, state())
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
    ap.add_argument("--rvc-gain", type=float, default=2.0, help="gain de sortie de RVC, sortie bornée à [-1, 1]")
    ap.add_argument("--port", type=int, default=8793)
    ap.add_argument("--lang", default="fr", help="langue transcrite")
    ap.add_argument("--origin", action="append", help="page autorisée, en plus de celles de l'appli")
    a = ap.parse_args()
    names = {"stt": a.stt, "tts": a.tts.split(":")[0], "rvc": bool(a.rvc)}
    serve(make_stt(a.stt, a.lang), make_tts(a.tts), make_rvc(a.rvc, a.rvc_gain), names, a.port,
          (*ORIGINS, *(a.origin or [])), lambda: bricks(a.stt, a.rvc))


if __name__ == "__main__":
    main()
