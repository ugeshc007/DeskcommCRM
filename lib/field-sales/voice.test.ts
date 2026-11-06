import { describe, expect, it } from 'vitest';
import { fieldVoiceBase, readFieldVoiceAudio } from './voice';

describe('private field voice boundary', () => {
  it('only allows the configured internal service address', () => {
    expect(fieldVoiceBase('http://field-voice:8080')).toBe('http://field-voice:8080');
    expect(fieldVoiceBase('')).toBeNull();
    expect(fieldVoiceBase('https://example.com')).toBeNull();
    expect(fieldVoiceBase('http://field-voice:8080@evil.test')).toBeNull();
  });
  it('bounds audio independently of Content-Length', async () => {
    const clip = new Uint8Array(256);
    expect((await readFieldVoiceAudio(new Request('http://local.test', { method: 'POST', headers: { 'Content-Type': 'audio/mp4' }, body: clip }))).length).toBe(256);
    await expect(readFieldVoiceAudio(new Request('http://local.test', { method: 'POST', headers: { 'Content-Type': 'audio/mp4' }, body: new Uint8Array(512_001) }))).rejects.toThrow('field_voice_invalid_audio');
  });
});
