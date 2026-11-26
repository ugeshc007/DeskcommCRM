import { z } from "zod";

/** Formato explícito: nunca adivinha país, separador decimal ou fuso. */
export const answerFormatSchema = z.enum(["text", "name", "email", "number", "phone", "date", "file"]);
export type AnswerFormat = z.infer<typeof answerFormatSchema>;
export const INVALID_ANSWER_BRANCH_ID = "invalid_answer";

export type ValidatedAnswer = { valid: true; value: string } | { valid: false };

/** Sem dados pessoais no erro; o grafo escolhe a mensagem de correção. */
export function validateAnswer(format: AnswerFormat, raw: string, trustedAttachmentId?: string | null): ValidatedAnswer {
  if (format === 'file') return z.uuid().safeParse(trustedAttachmentId).success
    ? { valid: true, value: `attachment:${trustedAttachmentId}` } : { valid: false };
  const value = raw.trim();
  if (!value || value.length > 2000 || /[\u0000-\u0008\u000b\u000c\u000e-\u001f\u007f]/.test(value)) {
    return { valid: false };
  }
  switch (format) {
    case "text":
      return { valid: true, value };
    case "name":
      return value.length <= 200 && /\p{L}/u.test(value) && !/[\r\n]/.test(value)
        ? { valid: true, value } : { valid: false };
    case "email":
      return z.email().safeParse(value).success ? { valid: true, value } : { valid: false };
    case "number":
      // Decimal simples e finito; sem milhares, expoentes ou interpretação regional.
      return /^[+-]?\d+(?:\.\d+)?$/.test(value) && Number.isFinite(Number(value))
        ? { valid: true, value } : { valid: false };
    case "phone": {
      if (!/^\+[\d ()-]+$/.test(value)) return { valid: false };
      const normalized = value.replace(/[ ()-]/g, "");
      return /^\+[1-9]\d{6,14}$/.test(normalized)
        ? { valid: true, value: normalized } : { valid: false };
    }
    case "date": {
      if (!/^\d{4}-\d{2}-\d{2}$/.test(value) || value.startsWith("0000")) return { valid: false };
      const parsed = new Date(`${value}T00:00:00.000Z`);
      return Number.isFinite(parsed.getTime()) && parsed.toISOString().slice(0, 10) === value
        ? { valid: true, value } : { valid: false };
    }
  }
}
