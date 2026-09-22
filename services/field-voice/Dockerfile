# Optional private sidecar. No audio/transcript leaves the self-hosted stack.
FROM python:3.11-slim AS prompt
RUN apt-get update && apt-get install -y --no-install-recommends git espeak-ng libsndfile1 && rm -rf /var/lib/apt/lists/*
RUN pip install --no-cache-dir torch==2.5.1 --index-url https://download.pytorch.org/whl/cpu
RUN pip install --no-cache-dir "git+https://github.com/hexgrad/kokoro.git@dfb907a02bba8152ca444717ca5d78747ccb4bec" soundfile==0.13.1
COPY generate_prompt.py /opt/field-voice/generate_prompt.py
RUN python /opt/field-voice/generate_prompt.py /opt/field-voice/where-going.wav

FROM python:3.11-slim
RUN apt-get update && apt-get install -y --no-install-recommends libgomp1 && rm -rf /var/lib/apt/lists/*
RUN pip install --no-cache-dir faster-whisper==1.2.1 huggingface-hub==0.34.4
# Model files are baked into the image: runtime transcription never downloads them.
RUN python -c "from huggingface_hub import snapshot_download; snapshot_download(repo_id='Systran/faster-whisper-small', revision='536b0662742c02347bc0e980a01041f333bce120', local_dir='/opt/field-voice/model')"
COPY --from=prompt /opt/field-voice/where-going.wav /opt/field-voice/where-going.wav
COPY server.py /opt/field-voice/server.py
RUN useradd --system --uid 10001 fieldvoice && chown -R fieldvoice:fieldvoice /opt/field-voice
USER fieldvoice
WORKDIR /opt/field-voice
ENV PYTHONDONTWRITEBYTECODE=1 HF_HUB_OFFLINE=1
EXPOSE 8080
CMD ["python", "server.py"]
