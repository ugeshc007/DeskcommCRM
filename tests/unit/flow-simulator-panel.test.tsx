import { afterEach, expect, it, vi } from 'vitest';
import { cleanup, fireEvent, render, screen } from '@testing-library/react';
import { FlowSimulator } from '@/app/app/ai/followups/[id]/_components/FlowSimulator';
import type { FlowGraph } from '@/lib/followup/graph-schema';

const position = { x: 0, y: 0 };
const graph: FlowGraph = { nodes: [
  { id: 'start', type: 'trigger', label: 'Start', position, config: {} },
  { id: 'integration', type: 'action', label: 'Integration', position, config: { mode: 'integration', action: 'read_cell', mappings: {}, output: { field: 'value', variable: 'price' } } },
  { id: 'end', type: 'end', label: 'Finish', position, config: { outcome: 'custom' } },
], edges: [
  { id: 'entry', source: 'start', target: 'integration', priority: 0, condition: { type: 'always' } },
  ...['success', 'error'].map(branch => ({ id: branch, source: 'integration', target: 'end', priority: 0, condition: { type: 'branch' as const, branch_id: branch } })),
] };
function openIntegration() {
  fireEvent.click(screen.getByRole('button', { name: 'Test flow' }));
  fireEvent.click(screen.getByRole('button', { name: 'Next step' }));
}
afterEach(() => { cleanup(); vi.unstubAllGlobals(); });
it('requires an explicit mock and rejects structured output without advancing', () => {
  const fetch = vi.fn(() => { throw new Error('Network forbidden'); }); vi.stubGlobal('fetch', fetch);
  render(<FlowSimulator graph={graph} />); openIntegration();
  expect(screen.getByRole('status')).toHaveTextContent('Current block: Integration');
  fireEvent.change(screen.getByLabelText('Mock output (JSON scalar)'), { target: { value: '{"price":12}' } });
  fireEvent.click(screen.getByRole('button', { name: 'Mock success' }));
  expect(screen.getByRole('alert')).toHaveTextContent('Mock output must be');
  expect(screen.getByRole('status')).toHaveTextContent('Current block: Integration');
  fireEvent.change(screen.getByLabelText('Mock output (JSON scalar)'), { target: { value: '12' } });
  fireEvent.click(screen.getByRole('button', { name: 'Mock success' }));
  expect(screen.getByRole('status')).toHaveTextContent('Current block: Finish');
  expect(fetch).not.toHaveBeenCalled();
});
it('discards sample values when the panel closes and is reopened', () => {
  render(<FlowSimulator graph={graph} />); openIntegration();
  fireEvent.change(screen.getByLabelText('Mock output (JSON scalar)'), { target: { value: '"private sample"' } });
  fireEvent.keyDown(screen.getByRole('dialog'), { key: 'Escape' });
  openIntegration();
  expect(screen.getByLabelText('Mock output (JSON scalar)')).toHaveValue('"sample value"');
});
it('clears old publication findings if the current draft cannot start', () => {
  const view = render(<FlowSimulator graph={graph} />); openIntegration();
  expect(screen.getByText(/Publication checks:/)).toBeInTheDocument();
  view.rerender(<FlowSimulator graph={{ nodes: [], edges: [] }} />);
  fireEvent.click(screen.getByRole('button', { name: 'Restart with current draft' }));
  expect(screen.getByRole('alert')).toHaveTextContent('Add exactly one Start');
  expect(screen.queryByText(/Publication checks:/)).toBeNull();
});
