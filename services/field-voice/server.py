"""Private, bounded speech service for the optional Field Sales assistant.

Only the CRM server can call this container. Audio and transcripts are never logged
or retained; the source recording is removed after each request.
"""

import hmac
import json
import os
import tempfile
from http.server import BaseHTTPRequestHandler, ThreadingHTTPServer
from pathlib import Path
from threading import Lock
from threading import BoundedSemaphore

MAX_AUDIO_BYTES = 512_000
MODEL_DIR = os.environ.get("FIELD_VOICE_MODEL_DIR", "/opt/field-voice/model")
PROMPT_FILE = Path(os.environ.get("FIELD_VOICE_PROMPT_FILE", "/opt/field-voice/where-going.wav"))
SECRET = os.environ.get("INTERNAL_SECRET", "")
_model = None
_model_lock = Lock()
_inference_slots = BoundedSemaphore(2)


def transcribe(audio: bytes) -> str:
    global _model
    with _model_lock:
        if _model is None:
            from faster_whisper import WhisperModel
            _model = WhisperModel(MODEL_DIR, device="cpu", compute_type="int8", local_files_only=True)
    descriptor, path = tempfile.mkstemp(suffix=".m4a")
    try:
        with os.fdopen(descriptor, "wb") as recording:
            recording.write(audio)
        segments, _ = _model.transcribe(path, language="en", vad_filter=True,
                                        beam_size=3, condition_on_previous_text=False)
        return " ".join(segment.text.strip() for segment in segments).strip()[:500]
    finally:
        os.unlink(path)


class Handler(BaseHTTPRequestHandler):
    def log_message(self, _format, *_args):
        # Standard HTTP logging can include headers or paths; keep this process silent.
        return

    def respond(self, status: int, body: bytes, content_type: str = "application/json"):
        self.send_response(status)
        self.send_header("Content-Type", content_type)
        self.send_header("Content-Length", str(len(body)))
        self.send_header("Cache-Control", "private, no-store")
        self.end_headers()
        self.wfile.write(body)

    def authorized(self) -> bool:
        supplied = self.headers.get("X-Internal-Secret", "")
        return bool(SECRET) and hmac.compare_digest(supplied, SECRET)

    def do_GET(self):
        if self.path == "/healthz":
            ready = PROMPT_FILE.is_file() and Path(MODEL_DIR).is_dir() and bool(SECRET)
            self.respond(200 if ready else 503, b'{"ready":true}' if ready else b'{"ready":false}')
            return
        if self.path != "/prompt" or not self.authorized():
            self.respond(404, b'{}')
            return
        if not PROMPT_FILE.is_file():
            self.respond(503, b'{}')
            return
        self.respond(200, PROMPT_FILE.read_bytes(), "audio/wav")

    def do_POST(self):
        if self.path != "/transcribe" or not self.authorized():
            self.respond(404, b'{}')
            return
        length = self.headers.get("Content-Length", "")
        if not length.isdecimal() or not 0 < int(length) <= MAX_AUDIO_BYTES or self.headers.get("Content-Type") != "audio/mp4":
            self.respond(413, b'{}')
            return
        audio = self.rfile.read(int(length))
        if len(audio) != int(length):
            self.respond(400, b'{}')
            return
        if not _inference_slots.acquire(blocking=False):
            self.respond(503, b'{}')
            return
        try:
            result = transcribe(audio)
            self.respond(200, json.dumps({"text": result}).encode("utf-8"))
        except Exception:
            # Never expose model paths, payloads, or recognized text in errors.
            self.respond(503, b'{}')
        finally:
            _inference_slots.release()


if __name__ == "__main__":
    ThreadingHTTPServer(("0.0.0.0", 8080), Handler).serve_forever()
