'use client';

import { useState } from 'react';
import { Button } from '@/components/ui/button';
import { Sheet, SheetContent, SheetTitle, SheetDescription } from '@/components/ui/sheet';
import { nodeBranches, type FlowGraph } from '@/lib/followup/graph-schema';
import { startSimulation, stepSimulation, type SimulationState } from '@/lib/followup/simulator';
import { validateFlowForPublish } from '@/lib/followup/validate-publish';

export function FlowSimulator({ graph }: { graph: FlowGraph }) {
  const [open, setOpen] = useState(false);
  const [state, setState] = useState<SimulationState | null>(null);
  const [error, setError] = useState('');
  const [reply, setReply] = useState('');
  const [mock, setMock] = useState('"sample value"');
  const [checks, setChecks] = useState<string[]>([]);
  const node = state?.graph.nodes.find(item => item.id === state.node_id);
  const start = () => {
    setChecks([]); setMock('"sample value"'); setReply('');
    try {
      setState(startSimulation(graph)); setError(''); setReply('');
      const validation = validateFlowForPublish(graph);
      setChecks(validation.ok ? [] : validation.errors.map(issue => `${issue.node_id ?? 'Flow'}: ${issue.code}`));
    } catch { setState(null); setError('Add exactly one Start block and check the block settings before testing.'); }
  };
  const step = (branch?: string, timeout = false) => {
    if (!state) return;
    try {
      const output: unknown = node?.type === 'action' && node.config.mode === 'integration' && branch === 'success' ? JSON.parse(mock) : null;
      if (output !== null && typeof output !== 'string' && typeof output !== 'number' && typeof output !== 'boolean') throw new Error('Invalid mock');
      setState(stepSimulation(state, { branch, timeout, reply: node?.type === 'match_reply' && !timeout ? reply : undefined,
        choice_id: node?.type === 'match_reply' && node.config.choice_source_node_id ? reply : undefined, mock_output: output }));
      setError(''); setReply('');
    } catch { setError('Mock output must be a JSON string, number, true, false or null.'); }
  };
  const external = node?.type === 'action' && node.config.mode === 'integration';
  return <Sheet open={open} onOpenChange={value => {
    setOpen(value);
    if (!value) { setState(null); setReply(''); setMock('"sample value"'); setChecks([]); setError(''); }
  }}>
    <Button type="button" size="sm" variant="secondary" onClick={() => { start(); setOpen(true); }}>Test flow</Button>
    <SheetContent className="w-full overflow-y-auto sm:max-w-xl">
      <SheetTitle>Draft simulator</SheetTitle>
      <SheetDescription>No messages, payments or integration requests are sent. Test data is discarded when this panel closes. This does not verify live delivery.</SheetDescription>
      <div className="space-y-4 px-4 pb-6">
        <Button type="button" variant="secondary" onClick={start}>Restart with current draft</Button>
        {checks.length > 0 && <details className="rounded-md border border-border p-3"><summary>Publication checks: {checks.length} issues</summary><ul className="list-disc pl-5 text-sm">{checks.map((check, index) => <li key={index}>{check}</li>)}</ul></details>}
        {error && <p role="alert" className="text-sm text-red-600">{error}</p>}
        <p role="status">{state?.status === 'running' ? `Current block: ${node?.label ?? 'Missing block'}` : state?.status}</p>
        {state?.status === 'running' && <div className="space-y-3 rounded-md border border-border p-3">
          {node?.type === 'match_reply' && <label className="block text-sm">{node.config.choice_source_node_id ? 'Sample choice ID' : 'Sample customer answer'}<input className="mt-1 block w-full rounded-md border border-border bg-surface p-2" value={reply} maxLength={2000} onChange={event => setReply(event.target.value)} /></label>}
          {external && <label className="block text-sm">Mock output (JSON scalar)<input className="mt-1 block w-full rounded-md border border-border bg-surface p-2" value={mock} maxLength={2200} onChange={event => setMock(event.target.value)} /></label>}
          <div className="flex flex-wrap gap-2">
            {external ? <><Button onClick={() => step('success')}>Mock success</Button><Button variant="secondary" onClick={() => step('error')}>Mock error</Button></>
              : node?.type === 'ai_classify' ? nodeBranches(node).map(branch => <Button key={branch.id} variant="secondary" onClick={() => step(branch.id)}>Mock: {branch.label}</Button>)
              : <Button onClick={() => step()}>{node?.type === 'match_reply' ? 'Submit sample answer' : 'Next step'}</Button>}
            {node?.type === 'match_reply' && <Button variant="secondary" onClick={() => step(undefined, true)}>Simulate no reply</Button>}
          </div>
        </div>}
        <h3 className="font-medium">Session variables</h3>
        <pre className="max-h-48 overflow-auto whitespace-pre-wrap break-all rounded-md bg-surface p-3 text-xs">{JSON.stringify(state?.variables ?? {}, null, 2)}</pre>
        <h3 className="font-medium">Step history</h3>
        <ol className="space-y-2">{state?.trace.map((entry, index) => <li key={index} className="rounded-md border border-border p-3 text-sm"><strong>{index + 1}. {entry.node_id}</strong><p className="whitespace-pre-wrap break-words">{entry.message}</p><details><summary>Variables at this step</summary><pre className="overflow-auto text-xs">{JSON.stringify(entry.variables, null, 2)}</pre></details></li>)}</ol>
      </div>
    </SheetContent>
  </Sheet>;
}
