"""The origin check, against the real server with fake voices; the whisper-server confidence and the RVC blocks, against
fake servers on this machine.

uv run --with numpy --with httpx --with soundfile python voix/test_service.py
"""
import json
import math
import threading
import time
import urllib.error
import urllib.request
from http.server import BaseHTTPRequestHandler, ThreadingHTTPServer

import numpy as np

import service

PORT = 18793
FAKE_PORT = 18794


def fake_server(port, answer):
    """answer(path, body) -> (status, content type, bytes)."""

    class Handler(BaseHTTPRequestHandler):
        def do_POST(self):
            body = self.rfile.read(int(self.headers.get("Content-Length", 0)))
            status, kind, data = answer(self.path, body)
            self.send_response(status)
            self.send_header("Content-Type", kind)
            self.send_header("Content-Length", str(len(data)))
            self.end_headers()
            self.wfile.write(data)

        def log_message(self, *_):
            pass

    server = ThreadingHTTPServer(("127.0.0.1", port), Handler)
    threading.Thread(target=server.serve_forever, daemon=True).start()
    return server


def check_whisper_confidence():
    asked = []
    reply = {"segments": [{"words": [{"probability": 0.9}, {"probability": 0.4}]}, {"words": [{"probability": 0.8}]}]}

    def answer(path, body):
        asked.append(body)
        return 200, "application/json", json.dumps({"text": " oui ", **reply}).encode()

    server = fake_server(FAKE_PORT, answer)
    try:
        stt = service.make_stt(f"whisper-server:http://127.0.0.1:{FAKE_PORT}", "fr")
        text, conf = stt(np.zeros(1600, dtype="<f4"))
        assert text == "oui"
        assert abs(conf - math.exp((math.log(0.9) + math.log(0.4) + math.log(0.8)) / 3)) < 1e-6, conf
        assert b"verbose_json" in asked[0] and b"token_timestamps" in asked[0], "per-word probabilities, no timestamps"

        reply["segments"] = [{"words": []}, {}]
        assert stt(np.zeros(1600, dtype="<f4"))[1] == 0.0, "no word, no confidence"
        reply["segments"] = [{"words": [{"probability": 0.0}]}]
        assert 0.0 < stt(np.zeros(1600, dtype="<f4"))[1] < 1e-5, "a zero probability is bounded, not a crash"
    finally:
        server.shutdown()


def check_rvc_blocks():
    calls = []
    fail_at = [None]

    def answer(path, body):
        x = np.frombuffer(body.split(b"\r\n\r\n", 1)[1].rsplit(b"\r\n--", 1)[0], "<f4")
        calls.append(len(x))
        if fail_at[0] == len(calls):
            return 500, "text/plain", b"plante"
        y = {1: x[:23000], 2: np.concatenate([x, np.full(500, -1, "<f4")])}.get(len(calls), x)  # short, then long
        return 200, "application/octet-stream", y.tobytes()

    server = fake_server(FAKE_PORT, answer)
    try:
        rvc = service.make_rvc(f"http://127.0.0.1:{FAKE_PORT}", gain=2.0)
        out, sr = rvc(np.full(26460, 0.8, dtype="<f4"), 22050)  # 1.2 s
        assert sr == 48000
        assert calls == [24000, 24000, 24000], calls
        assert len(out) == 2400 + 57600, "the useful length: 50 ms of silence and the sentence, without the padding"
        assert np.all(out[:2400] == 0) and np.all(out[2400:23000] == 1.0), "gain, then bounded to 1"
        assert np.all(out[23000:24000] == 0), "a short block is completed, the next ones stay in place"
        assert np.all(out[24000:48000] == 1.0), "a long block is cut, its tail never lands on the next one"
        assert np.all(out[24000:] == 1.0)

        calls.clear()
        fail_at[0] = 2
        try:
            rvc(np.full(26460, 0.8, dtype="<f4"), 22050)
            raise AssertionError("a failed block fails the sentence")
        except Exception as err:
            assert "500" in str(err), err
        fail_at[0] = None
        calls.clear()
        assert len(rvc(np.full(26460, 0.8, dtype="<f4"), 22050)[0]) == 60000, "the next sentence goes through"
    finally:
        server.shutdown()


def call(path, headers=None, data=None):
    req = urllib.request.Request(f"http://127.0.0.1:{PORT}{path}", data=data, headers=headers or {})
    try:
        with urllib.request.urlopen(req, timeout=5) as r:
            return r.status, r.read()
    except urllib.error.HTTPError as e:
        return e.code, e.read()


def main():
    heard = []

    def stt(audio):
        heard.append(len(audio))
        return "salut", 0.9

    tts = lambda text: (np.zeros(10, dtype="<f4"), 22050)
    threading.Thread(target=service.serve, args=(stt, tts, None, {"stt": "x"}, PORT), daemon=True).start()
    time.sleep(0.3)

    ours = {"Origin": "http://127.0.0.1:5180"}
    other = {"Origin": "https://exemple.org"}
    rebound = {"Host": "exemple.org:8793"}
    sound = np.zeros(4, dtype="<f4").tobytes()

    assert call("/ping")[0] == 200, "no origin: not a page"
    assert call("/ping", ours)[0] == 200, "our page"
    assert call("/ping", other)[0] == 403, "another site"
    assert call("/ping", rebound)[0] == 403, "another host"
    assert call("/micro", other)[0] == 403, "who holds the microphone stays private"

    assert call("/stt", other, sound)[0] == 403
    assert heard == [], "a refused page never reaches the transcription"
    assert call("/tts", other, json.dumps({"text": "x"}).encode())[0] == 403

    status, body = call("/stt", ours, sound)
    assert status == 200 and json.loads(body)["text"] == "salut"
    assert heard == [4]
    assert call("/tts", ours, json.dumps({"text": "x"}).encode())[0] == 200

    check_whisper_confidence()
    check_rvc_blocks()
    print("ok")


if __name__ == "__main__":
    main()
