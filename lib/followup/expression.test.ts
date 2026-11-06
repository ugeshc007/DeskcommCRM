import { describe, expect, it } from 'vitest';
import { evaluateExpression, expressionSchema, type Expression } from './expression';
import { sessionVariablesSchema, sessionVariableValues } from './session-variables';

const number = (value: number): Expression => ({ kind: 'literal', value });
describe('bounded builder calculations', () => {
  it('reads explicit lead fields and this enrollment variables separately', () => {
    const expression: Expression = { kind: 'call', operator: 'multiply', args: [{ kind: 'field', key: 'price_cents' }, { kind: 'variable', key: 'quantity' }] };
    expect(evaluateExpression(expression, { price_cents: 500, quantity: 100 }, { quantity: 2 })).toEqual({ ok: true, value: 1000 });
    expect(evaluateExpression(expression, { price_cents: 500, quantity: 100 }, {})).toEqual({ ok: false, code: 'missing_field' });
  });
  it('rejects division by zero, overflow and coercion', () => {
    expect(evaluateExpression({ kind: 'call', operator: 'divide', args: [number(10), number(0)] }, {})).toEqual({ ok: false, code: 'division_by_zero' });
    expect(evaluateExpression({ kind: 'call', operator: 'multiply', args: [number(1e308), number(1e308)] }, {})).toEqual({ ok: false, code: 'result_too_large' });
    expect(evaluateExpression({ kind: 'call', operator: 'add', args: [number(2), { kind: 'literal', value: '3' }] }, {})).toEqual({ ok: false, code: 'invalid_operand' });
  });
  it('cannot read prototypes, secret names, nested paths or execute code', () => {
    for (const key of ['__proto__', 'constructor', 'prototype', 'secret', 'token', 'password', 'api_key', 'settings.key'])
      expect(expressionSchema.safeParse({ kind: 'field', key }).success).toBe(false);
    expect(evaluateExpression({ kind: 'field', key: 'inherited' }, Object.create({ inherited: 10 }))).toEqual({ ok: false, code: 'missing_field' });
    expect(evaluateExpression({ kind: 'call', operator: 'eval', args: [{ kind: 'literal', value: 'process.env' }] }, {})).toEqual({ ok: false, code: 'invalid_formula' });
  });
  it('bounds nesting before evaluating and rejects cyclic objects', () => {
    let expression: Expression = number(1);
    for (let i = 0; i < 12; i++) expression = { kind: 'call', operator: 'add', args: [expression] };
    expect(expressionSchema.safeParse(expression).success).toBe(false);
    const cyclic: Expression = { kind: 'call', operator: 'add', args: [] }; cyclic.args.push(cyclic);
    expect(expressionSchema.safeParse(cyclic).success).toBe(false);
  });
  it('checks typed and bounded enrollment state', () => {
    expect(sessionVariableValues({ score: { type: 'number', value: 2 } })).toEqual({ score: 2 });
    expect(sessionVariablesSchema.safeParse({ score: { type: 'number', value: '2' } }).success).toBe(false);
    expect(sessionVariablesSchema.safeParse(Object.fromEntries(Array.from({ length: 51 }, (_, i) => [`v${i}`, { type: 'number', value: i }]))).success).toBe(false);
  });
});
