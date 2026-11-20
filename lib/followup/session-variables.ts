import { z } from 'zod';
import { variableKeySchema, type ExpressionValue } from './expression';

export const variableTypeSchema = z.enum(['string', 'number', 'boolean']);
export type VariableType = z.infer<typeof variableTypeSchema>;
export const sessionVariablesSchema = z.record(variableKeySchema, z.discriminatedUnion('type', [
  z.strictObject({ type: z.literal('string'), value: z.string().max(2000) }),
  z.strictObject({ type: z.literal('number'), value: z.number().finite() }),
  z.strictObject({ type: z.literal('boolean'), value: z.boolean() }),
])).refine(value => Object.keys(value).length <= 50 && JSON.stringify(value).length <= 32768, 'Session variable limit exceeded.');
export type SessionVariables = z.infer<typeof sessionVariablesSchema>;
export function sessionVariableValues(raw: unknown): Record<string, ExpressionValue> {
  const parsed = sessionVariablesSchema.parse(raw ?? {});
  return Object.fromEntries(Object.entries(parsed).map(([key, item]) => [key, item.value]));
}
