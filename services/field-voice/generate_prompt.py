"""Build-time Kokoro synthesis for a fixed English prompt; never processes employee data."""

import sys

import soundfile as sf
from kokoro import KPipeline


def main(destination: str, message: str):
    pipeline = KPipeline(lang_code="a", repo_id="hexgrad/Kokoro-82M", device="cpu")
    chunks = [audio for _, _, audio in pipeline(message, voice="af_heart")]
    if len(chunks) != 1:
        raise RuntimeError("Unexpected prompt synthesis output")
    sf.write(destination, chunks[0], 24000, subtype="PCM_16")


if __name__ == "__main__":
    main(sys.argv[1], sys.argv[2])
