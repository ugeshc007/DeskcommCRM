import { z } from 'zod';

export const expressionOperatorSchema = z.enum(['add', 'subtract', 'multiply', 'divide', 'min', 'max', 'concat', 'lower', 'upper', 'trim', 'length']);
export type ExpressionOperator = z.infer<typeof expressionOperatorSchema>;
export type ExpressionValue = string | number | boolean | null;
export type Expression = { kind: 'literal'; value: ExpressionValue }
  | { kind: 'field'; key: string }
  | { kind: 'variable'; key: string }
  | { kind: 'call'; operator: ExpressionOperator; args: Expression[] };
export const variableKeySchema = z.string().regex(/^[a-z][a-z0-9_]{0,59}$/i)
  .refine(key => !['__proto__', 'constructor', 'prototype', 'password', 'secret', 'token', 'api_key'].includes(key.toLowerCase()), 'Reserved field name.');

const shape: z.ZodType<Expression> = z.lazy(() => z.discriminatedUnion('kind', [
  z.strictObject({ kind: z.literal('literal'), value: z.union([z.string().max(2000), z.number().finite(), z.boolean(), z.null()]) }),
  z.strictObject({ kind: z.literal('field'), key: variableKeySchema }),
  z.strictObject({ kind: z.literal('variable'), key: variableKeySchema }),
  z.strictObject({ kind: z.literal('call'), operator: expressionOperatorSchema, args: z.array(shape).min(1).max(10) }),
]));

// Limita antes do parser recursivo: profundidade arbitrária não chega ao Zod.
export const expressionSchema = z.unknown().superRefine((raw, ctx) => {
  const queue = [{ value: raw, depth: 0 }];
  let visited = 0;
  while (queue.length) {
    const { value, depth } = queue.pop()!;
    if (++visited > 64 || depth > 8) { ctx.addIssue({ code: 'custom', message: 'Formula exceeds its complexity limit.' }); return; }
    if (value && typeof value === 'object' && 'args' in value && Array.isArray(value.args))
      for (const arg of value.args) queue.push({ value: arg, depth: depth + 1 });
  }
}).pipe(shape);

export type ExpressionResult = { ok: true; value: ExpressionValue } | { ok: false; code: 'invalid_formula' | 'missing_field' | 'invalid_operand' | 'division_by_zero' | 'result_too_large' };

/** Sem eval, acesso a propriedades aninhadas, rede, relógio ou credenciais. */
export function evaluateExpression(raw: unknown, fields: Record<string, unknown>, variables: Record<string, unknown> = {}): ExpressionResult {
  const parsed = expressionSchema.safeParse(raw);
  if (!parsed.success) return { ok: false, code: 'invalid_formula' };
  const visit = (expression: Expression): ExpressionResult => {
    if (expression.kind === 'literal') return { ok: true, value: expression.value };
    if (expression.kind === 'field' || expression.kind === 'variable') {
      const source = expression.kind === 'field' ? fields : variables;
      if (!Object.hasOwn(source, expression.key)) return { ok: false, code: 'missing_field' };
      const value = source[expression.key];
      if (value === null || typeof value === 'boolean' || (typeof value === 'number' && Number.isFinite(value)) || (typeof value === 'string' && value.length <= 2000)) return { ok: true, value };
      return { ok: false, code: 'invalid_operand' };
    }
    const values: ExpressionValue[] = [];
    for (const arg of expression.args) { const result = visit(arg); if (!result.ok) return result; values.push(result.value); }
    const operator = expression.operator;
    let value: ExpressionValue;
    if (['lower', 'upper', 'trim', 'length'].includes(operator)) {
      if (values.length !== 1 || typeof values[0] !== 'string') return { ok: false, code: 'invalid_operand' };
      value = operator === 'lower' ? values[0].toLowerCase() : operator === 'upper' ? values[0].toUpperCase() : operator === 'trim' ? values[0].trim() : values[0].length;
    } else if (operator === 'concat') {
      if (!values.every(v => typeof v === 'string')) return { ok: false, code: 'invalid_operand' };
      value = values.join('');
    } else {
      if (!values.every(v => typeof v === 'number') || (['subtract', 'divide'].includes(operator) && values.length !== 2)) return { ok: false, code: 'invalid_operand' };
      const numbers = values as number[];
      if (operator === 'divide' && numbers[1] === 0) return { ok: false, code: 'division_by_zero' };
      value = operator === 'add' ? numbers.reduce((a, b) => a + b, 0)
        : operator === 'multiply' ? numbers.reduce((a, b) => a * b, 1)
        : operator === 'subtract' ? numbers[0]! - numbers[1]!
        : operator === 'divide' ? numbers[0]! / numbers[1]!
        : operator === 'min' ? Math.min(...numbers) : Math.max(...numbers);
    }
    if ((typeof value === 'number' && !Number.isFinite(value)) || (typeof value === 'string' && value.length > 2000)) return { ok: false, code: 'result_too_large' };
    return { ok: true, value };
  };
  return visit(parsed.data);
}
