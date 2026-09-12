import { createHmac, timingSafeEqual } from "node:crypto";

export function verifyBillingWebhookSignature(rawBody: string, suppliedHex: string | null, secret: string): boolean {
  if (!suppliedHex || !secret || !/^[a-f0-9]{64}$/i.test(suppliedHex)) return false;
  const expected = createHmac("sha256", secret).update(rawBody).digest();
  const supplied = Buffer.from(suppliedHex, "hex");
  return supplied.length === expected.length && timingSafeEqual(supplied, expected);
}
