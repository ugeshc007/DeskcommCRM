import unittest
import tempfile
from pathlib import Path
from unittest.mock import patch

import server


class SpeechServiceTests(unittest.TestCase):
    def test_next_shop_prompt_is_a_distinct_private_audio_asset(self):
        handler = object.__new__(server.Handler)
        handler.path = "/prompt-next"
        with tempfile.TemporaryDirectory() as directory:
            asset = Path(directory) / "next.wav"
            asset.write_bytes(b"synthetic-next-shop-prompt")
            with patch.object(server, "NEXT_PROMPT_FILE", asset), patch.object(handler, "authorized", return_value=True), patch.object(handler, "respond") as respond:
                handler.do_GET()
            respond.assert_called_once_with(200, b"synthetic-next-shop-prompt", "audio/wav")

    def test_authentication_requires_secret(self):
        handler = object.__new__(server.Handler)
        handler.headers = {"X-Internal-Secret": "demo"}
        with patch.object(server, "SECRET", ""):
            self.assertFalse(handler.authorized())
        with patch.object(server, "SECRET", "demo"):
            self.assertTrue(handler.authorized())
        handler.headers = {"X-Internal-Secret": "wrong"}
        with patch.object(server, "SECRET", "demo"):
            self.assertFalse(handler.authorized())

    def test_temp_audio_is_deleted_after_transcription(self):
        class FakeModel:
            def transcribe(self, path, **_kwargs):
                self.path = path
                with open(path, "rb") as recording:
                    self.body = recording.read()
                return iter([type("Segment", (), {"text": " Cherry project "})()]), None

        model = FakeModel()
        with patch.object(server, "_model", model):
            self.assertEqual(server.transcribe(b"synthetic-test-audio"), "Cherry project")
        self.assertEqual(model.body, b"synthetic-test-audio")
        self.assertFalse(server.Path(model.path).exists())


if __name__ == "__main__":
    unittest.main()
