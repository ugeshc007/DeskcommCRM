/** Short push-to-talk clips only; never accept an unbounded request stream. */
export async function readFieldVoiceAudio(req: Request): Promise<Uint8Array> {
  if (req.headers.get('content-type') !== 'audio/mp4' || !req.body) throw new Error('field_voice_invalid_audio');
  const reader = req.body.getReader();
  const chunks: Uint8Array[] = [];
  let size = 0;
  try {
    while (true) {
      const item = await reader.read();
      if (item.done) break;
      size += item.value.length;
      if (size > 512_000) throw new Error('field_voice_invalid_audio');
      chunks.push(item.value);
    }
  } finally { await reader.cancel().catch(() => undefined); }
  if (size < 128) throw new Error('field_voice_invalid_audio');
  return Buffer.concat(chunks);
}

/** Operator-controlled URL, never a value supplied by a device or request. */
export function fieldVoiceBase(configured: string): string | null {
  if (!configured) return null;
  if (!/^http:\/\/(?:field-voice|127\.0\.0\.1):8080$/.test(configured)) return null;
  return configured;
}
