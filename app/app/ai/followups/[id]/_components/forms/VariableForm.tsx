'use client';
import { useState } from 'react';
import { Label } from '@/components/ui/label';
import { Input } from '@/components/ui/input';
import { Select, SelectContent, SelectItem, SelectTrigger, SelectValue } from '@/components/ui/select';
import { actionConfigSchema, type FlowNode } from '@/lib/followup/graph-schema';
import { variableTypeSchema } from '@/lib/followup/session-variables';
import { TIPOS_DE_VARIAVEL, opcoes } from '@/lib/followup/vocabulario';
import { ExpressionEditor } from './ExpressionEditor';
import { useT } from '@/hooks/i18n/useT';

type Config = Extract<Extract<FlowNode, { type: 'action' }>['config'], { mode: 'set_variable' }>;
export function VariableForm({ config, onChange }: { config: Config; onChange: (config: Config) => void }) {
  const t = useT();
  const [draft, setDraft] = useState(config);
  const [error, setError] = useState<string | null>(null);
  const update = (next: Config) => {
    setDraft(next); const parsed = actionConfigSchema.safeParse(next);
    if (!parsed.success) { setError(parsed.error.issues[0]?.message ?? 'Invalid variable.'); return; }
    setError(null); onChange(next);
  };
  return <div className="space-y-3">
    <p className="text-xs text-text-muted">{t('A session variable belongs only to this flow enrollment. It does not change a customer record or another organization. Do not store credentials here.')}</p>
    <Label htmlFor="variable-key">{t('Variable name')}</Label><Input id="variable-key" maxLength={60} value={draft.key} onChange={e => update({ ...draft, key: e.target.value })} />
    <Label htmlFor="variable-type">{t('Value type')}</Label>
    <Select value={draft.value_type} onValueChange={raw => {
      const type = variableTypeSchema.parse(raw);
      update({ ...draft, value_type: type, expression: { kind: 'literal', value: type === 'number' ? 0 : type === 'boolean' ? false : '' } });
    }}><SelectTrigger id="variable-type"><SelectValue /></SelectTrigger><SelectContent>
      {opcoes(TIPOS_DE_VARIAVEL).map(({ valor, rotulo }) => <SelectItem key={valor} value={valor}>{t(rotulo)}</SelectItem>)}
    </SelectContent></Select>
    <ExpressionEditor value={draft.expression} onChange={expression => update({ ...draft, expression })} />
    <p className="text-xs text-text-muted">{t('Use a number for scores and a true/false variable for a goal. Missing inputs or type mismatches stop the step and appear in flow failures.')}</p>
    {error && <p role="alert" className="text-xs text-error-fg">{error}</p>}
  </div>;
}
