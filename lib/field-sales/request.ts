/** Bounded JSON reader for the employee-only photo/attendance endpoint. */
export async function readFieldJson(req: Request): Promise<unknown> {
  if (!req.body) throw new Error('invalid_request');
  const reader = req.body.getReader(), chunks: Uint8Array[] = []; let length = 0;
  try {
    while (true) {
      const chunk = await reader.read(); if (chunk.done) break;
      length += chunk.value.length;
      if (length > 1_450_000) throw new Error('invalid_request');
      chunks.push(chunk.value);
    }
    return JSON.parse(Buffer.concat(chunks).toString('utf8'));
  } finally { await reader.cancel().catch(() => undefined); }
}
