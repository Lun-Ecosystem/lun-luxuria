"""The origin check, against the real server with fake voices.

uv run --with numpy --with httpx --with soundfile python voix/test_service.py
"""
import json
import threading
import time
import urllib.error
import urllib.request

import numpy as np

import service

PORT = 18793


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
    print("ok")


if __name__ == "__main__":
    main()
