'use client';

import { useState } from 'react';
import { Button } from '@/components/ui/button';
import { Input } from '@/components/ui/input';
import { Label } from '@/components/ui/label';
import { Textarea } from '@/components/ui/textarea';
import { actionConfigSchema, type FlowNode } from '@/lib/followup/graph-schema';
import { useT } from '@/hooks/i18n/useT';

type Config = Extract<Extract<FlowNode, { type: 'action' }>['config'], { mode: 'interactive' }>;

export function InteractiveForm({ config, onChange }: { config: Config; onChange: (config: Config) => void }) {
  const t = useT();
  const [draft, setDraft] = useState(config);
  const [error, setError] = useState<string | null>(null);
  const update = (next: Config) => {
    setDraft(next);
    const parsed = actionConfigSchema.safeParse(next);
    if (!parsed.success) { setError(parsed.error.issues[0]?.message ?? 'Invalid choices.'); return; }
    setError(null);
    onChange(next);
  };
  const choices = draft.interactive.kind === 'buttons' ? draft.interactive.choices : draft.interactive.sections.flatMap(section => section.rows);
  const limit = draft.interactive.kind === 'buttons' ? 3 : 10;
  const changeChoice = (index: number, field: 'title' | 'description', value: string) => {
    let offset = 0;
    const interactive = draft.interactive.kind === 'buttons'
      ? { ...draft.interactive, choices: choices.map((choice, i) => i === index ? { ...choice, [field]: value } : choice) }
      : { ...draft.interactive, sections: draft.interactive.sections.map(section => ({ ...section,
        rows: section.rows.map(choice => offset++ === index ? { ...choice, [field]: value } : choice),
      })) };
    update({ ...draft, interactive });
  };
  return <div className="space-y-4">
    <p className="text-xs text-text-muted">{t('Native choices require a compatible channel and an open messaging window. Connect a reply node to route the selection.')}</p>
    <div className="space-y-2"><Label htmlFor="interactive-body">{t('Message')}</Label>
      <Textarea id="interactive-body" value={draft.body} maxLength={1024} onChange={e => update({ ...draft, body: e.target.value })} /></div>
    {draft.interactive.kind === 'list' && <div className="space-y-2"><Label htmlFor="list-label">{t('Menu button label')}</Label>
      <Input id="list-label" maxLength={20} value={draft.interactive.button_label} onChange={e => {
        if (draft.interactive.kind === 'list') update({ ...draft, interactive: { ...draft.interactive, button_label: e.target.value } });
      }} /></div>}
    {choices.map((choice, index) => <fieldset key={choice.id} className="space-y-2 rounded-lg border border-border p-3">
      <legend className="px-1 text-xs">{t('Choice')} {index + 1}</legend>
      <Label htmlFor={`choice-${choice.id}`}>{t('Label')}</Label>
      <Input id={`choice-${choice.id}`} value={choice.title} maxLength={limit === 3 ? 20 : 24} onChange={e => changeChoice(index, 'title', e.target.value)} />
      <p className="break-all text-xs text-text-muted">ID: {choice.id}</p>
      <Button type="button" variant="outline" size="sm" disabled={choices.length === 1} onClick={() => {
        const interactive = draft.interactive.kind === 'buttons'
          ? { ...draft.interactive, choices: draft.interactive.choices.filter(c => c.id !== choice.id) }
          : { ...draft.interactive, sections: draft.interactive.sections.map(s => ({ ...s, rows: s.rows.filter(c => c.id !== choice.id) })).filter(s => s.rows.length) };
        update({ ...draft, interactive });
      }}>{t('Remove choice')}</Button>
    </fieldset>)}
    <Button type="button" variant="outline" disabled={choices.length >= limit} onClick={() => {
      const choice = { id: crypto.randomUUID(), title: `Option ${choices.length + 1}` };
      const interactive = draft.interactive.kind === 'buttons'
        ? { ...draft.interactive, choices: [...draft.interactive.choices, choice] }
        : { ...draft.interactive, sections: draft.interactive.sections.map((s, i) => i === 0 ? { ...s, rows: [...s.rows, choice] } : s) };
      update({ ...draft, interactive });
    }}>{t('Add choice')}</Button>
    {error && <p role="alert" className="text-xs text-error-fg">{error}</p>}
  </div>;
}
