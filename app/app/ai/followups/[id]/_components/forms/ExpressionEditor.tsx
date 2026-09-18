'use client';
import { Input } from '@/components/ui/input';
import { Label } from '@/components/ui/label';
import { Select, SelectContent, SelectItem, SelectTrigger, SelectValue } from '@/components/ui/select';
import { expressionOperatorSchema, type Expression, type ExpressionOperator } from '@/lib/followup/expression';
import { useT } from '@/hooks/i18n/useT';

const unary = (op: ExpressionOperator) => ['lower', 'upper', 'trim', 'length'].includes(op);
export function ExpressionEditor({ value, onChange, depth = 0, label = 'Formula' }: {
  value: Expression; onChange: (value: Expression) => void; depth?: number; label?: string;
}) {
  const t = useT();
  return <fieldset className="min-w-0 space-y-2 rounded-md border border-border p-2">
    <legend className="px-1 text-xs">{t(label)}</legend>
    <Select value={value.kind} onValueChange={kind => onChange(kind === 'field' ? { kind: 'field', key: 'quantity' }
      : kind === 'variable' ? { kind: 'variable', key: 'score' }
      : kind === 'call' ? { kind: 'call', operator: 'add', args: [{ kind: 'literal', value: 0 }, { kind: 'literal', value: 0 }] }
      : { kind: 'literal', value: 0 })}>
      <SelectTrigger aria-label={t('Value source')}><SelectValue /></SelectTrigger>
      <SelectContent><SelectItem value="literal">{t('Fixed value')}</SelectItem><SelectItem value="field">{t('Lead field')}</SelectItem>
        <SelectItem value="variable">{t('Session variable')}</SelectItem>
        {depth < 4 && <SelectItem value="call">{t('Calculation')}</SelectItem>}</SelectContent>
    </Select>
    {(value.kind === 'field' || value.kind === 'variable') && <><Label>{t('Field key')}</Label><Input aria-label={t('Field key')} value={value.key} maxLength={60} onChange={e => onChange({ ...value, key: e.target.value })} /></>}
    {value.kind === 'literal' && <>
      <Select value={typeof value.value === 'number' ? 'number' : typeof value.value === 'boolean' ? 'boolean' : 'text'} onValueChange={type => onChange({ ...value, value: type === 'number' ? 0 : type === 'boolean' ? false : '' })}>
        <SelectTrigger aria-label={t('Value type')}><SelectValue /></SelectTrigger>
        <SelectContent><SelectItem value="number">{t('Number')}</SelectItem><SelectItem value="text">{t('Text')}</SelectItem><SelectItem value="boolean">{t('True / false')}</SelectItem></SelectContent>
      </Select>
      {typeof value.value === 'boolean' ? <Select value={String(value.value)} onValueChange={raw => onChange({ ...value, value: raw === 'true' })}>
        <SelectTrigger aria-label={t('Fixed value')}><SelectValue /></SelectTrigger><SelectContent><SelectItem value="true">{t('True')}</SelectItem><SelectItem value="false">{t('False')}</SelectItem></SelectContent>
      </Select> : <Input aria-label={t('Fixed value')} type={typeof value.value === 'number' ? 'number' : 'text'} value={String(value.value ?? '')} maxLength={2000}
        onChange={e => onChange({ ...value, value: typeof value.value === 'number' ? Number(e.target.value) : e.target.value })} />}
    </>}
    {value.kind === 'call' && <>
      <Select value={value.operator} onValueChange={raw => {
        const op = expressionOperatorSchema.parse(raw);
        onChange({ ...value, operator: op, args: unary(op) ? [value.args[0]!] : [value.args[0]!, value.args[1] ?? { kind: 'literal', value: 0 }] });
      }}><SelectTrigger aria-label={t('Calculation')}><SelectValue /></SelectTrigger><SelectContent>
        {expressionOperatorSchema.options.map(op => <SelectItem key={op} value={op}>{t(op)}</SelectItem>)}
      </SelectContent></Select>
      {value.args.map((arg, index) => <ExpressionEditor key={index} label={`Input ${index + 1}`} depth={depth + 1} value={arg}
        onChange={next => onChange({ ...value, args: value.args.map((a, i) => i === index ? next : a) })} />)}
    </>}
  </fieldset>;
}
