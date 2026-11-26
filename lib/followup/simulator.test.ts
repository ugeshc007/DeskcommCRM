import { afterEach, describe, expect, it, vi } from 'vitest';
import { startSimulation, stepSimulation } from './simulator';
import type { FlowGraph, FlowNode } from './graph-schema';

const start: FlowNode = { id: 'start', label: 'Start', type: 'trigger', config: {}, position: { x: 0, y: 0 } };
const end: FlowNode = { id: 'end', label: 'End', type: 'end', config: { outcome: 'custom' }, position: { x: 0, y: 200 } };
function fixture(node: FlowNode, branches = ['else']): FlowGraph {
  return { nodes: [start, node, end], edges: [
    { id: 'entry', source: 'start', target: node.id, priority: 0, condition: { type: 'always' } },
    ...branches.map(id => ({ id, source: node.id, target: 'end', priority: 0,
      condition: id === 'else' ? { type: 'always' as const } : { type: 'branch' as const, branch_id: id } })),
  ] };
}
afterEach(() => vi.unstubAllGlobals());
describe('isolated draft simulation', () => {
  it('runs text to completion without network or mutating the draft', () => {
    const network = vi.fn(() => { throw new Error('Real network forbidden'); });
    vi.stubGlobal('fetch', network);
    const graph = fixture({ id: 'message', label: 'Message', type: 'action', position: { x: 0, y: 100 }, config: { mode: 'text', body: 'Hello' } });
    const snapshot = JSON.stringify(graph);
    let state = startSimulation(graph);
    for (let i = 0; i < 3; i++) state = stepSimulation(state);
    expect(state.status).toBe('completed');
    expect(state.trace[1]?.message).toBe('Hello');
    expect(network).not.toHaveBeenCalled();
    expect(JSON.stringify(graph)).toBe(snapshot);
  });
  it('requires explicit mock integration results and keeps sessions isolated', () => {
    const graph = fixture({ id: 'app', label: 'App', type: 'action', position: { x: 0, y: 100 }, config: {
      mode: 'integration', action: 'create_payment_link', mappings: {}, output: { field: 'url', variable: 'payment_url' },
    } }, ['success', 'error']);
    const first = stepSimulation(startSimulation(graph));
    const other = stepSimulation(startSimulation(graph));
    expect(stepSimulation(first).node_id).toBe('app');
    const result = stepSimulation(first, { branch: 'success', mock_output: 'https://example.test/mock-only' });
    expect(result.variables.payment_url?.value).toBe('https://example.test/mock-only');
    expect(other.variables).toEqual({});
    expect(first.variables).toEqual({});
    expect(result.trace[1]?.message).toContain('No external request');
    expect(stepSimulation(first, { branch: 'error' }).variables).toEqual({});
  });
  it('routes invalid answers without saving them, then captures a valid number', () => {
    const graph = fixture({ id: 'question', label: 'Quantity', type: 'match_reply', position: { x: 0, y: 100 }, config: {
      branches: [], grace_timeout_ms: 900000, answer_format: 'number', save_to: { kind: 'session_variable', key: 'quantity' },
    } }, ['else', 'invalid_answer', 'no_reply']);
    const state = stepSimulation(startSimulation(graph));
    expect(stepSimulation(state).node_id).toBe('question');
    expect(stepSimulation(state, { reply: 'not a number' }).variables).toEqual({});
    expect(stepSimulation(state, { reply: '3' }).variables.quantity).toEqual({ type: 'number', value: 3 });
    expect(stepSimulation(state, { timeout: true }).variables).toEqual({});
  });
  it('advances waits virtually without scheduling work', () => {
    const graph = fixture({ id: 'wait', label: 'Wait', type: 'wait', position: { x: 0, y: 100 }, config: { mode: 'fixed', duration_ms: 300000 } });
    const state = stepSimulation(stepSimulation(startSimulation(graph, '2026-09-18T00:00:00.000Z')));
    expect(state.now).toBe('2026-09-18T00:05:00.000Z');
    expect(state.node_id).toBe('end');
  });
  it('evaluates typed variables and refuses mismatched types', () => {
    const graph = fixture({ id: 'set', label: 'Set', type: 'action', position: { x: 0, y: 100 }, config: {
      mode: 'set_variable', key: 'total', value_type: 'number', expression: { kind: 'literal', value: 12 },
    } });
    const state = stepSimulation(stepSimulation(startSimulation(graph)));
    expect(state.variables.total).toEqual({ type: 'number', value: 12 });
  });
  it('bounds cycles and rejects missing starts', () => {
    expect(() => startSimulation({ nodes: [end, { ...end, id: 'other' }], edges: [] })).toThrow('Exactly one start');
    const state = startSimulation({ nodes: [start, end], edges: [{ id: 'loop', source: 'start', target: 'start', priority: 0, condition: { type: 'always' } }] });
    let result = state;
    for (let i = 0; i < 201; i++) result = stepSimulation(result);
    expect(result.status).toBe('failed');
    expect(result.trace.at(-1)?.message).toContain('200-step');
  });
  it('fails a disconnected result instead of reporting completion', () => {
    const graph = fixture({ id: 'app', label: 'App', type: 'action', position: { x: 0, y: 100 }, config: {
      mode: 'integration', action: 'send_event', mappings: {},
    } }, ['success']);
    const state = stepSimulation(startSimulation(graph));
    const result = stepSimulation(state, { branch: 'error' });
    expect(result.status).toBe('failed');
    expect(result.trace.at(-1)?.message).toContain('No connected output');
    expect(state.status).toBe('running');
  });
  it('does not invent an integration output when its mock is absent', () => {
    const graph = fixture({ id: 'app', label: 'App', type: 'action', position: { x: 0, y: 100 }, config: {
      mode: 'integration', action: 'read_cell', mappings: {}, output: { field: 'value', variable: 'price' },
    } }, ['success', 'error']);
    const result = stepSimulation(stepSimulation(startSimulation(graph)), { branch: 'success' });
    expect(result.status).toBe('failed');
    expect(result.variables).toEqual({});
    expect(result.trace.at(-1)?.message).toContain('Supply a mock output');
  });
  it('keeps completed and failed sessions terminal', () => {
    const graph = fixture({ id: 'text', label: 'Text', type: 'action', position: { x: 0, y: 100 }, config: { mode: 'text', body: 'Hello' } });
    let state = startSimulation(graph);
    for (let i = 0; i < 3; i++) state = stepSimulation(state);
    expect(state.status).toBe('completed');
    expect(stepSimulation(state, { reply: 'restart' })).toBe(state);
    const failed = { ...state, status: 'failed' as const };
    expect(stepSimulation(failed)).toBe(failed);
  });
  it('rejects a malformed clock and snapshots the graph at start', () => {
    const graph = fixture({ id: 'text', label: 'Text', type: 'action', position: { x: 0, y: 100 }, config: { mode: 'text', body: 'Original' } });
    expect(() => startSimulation(graph, 'not-a-date')).toThrow('Invalid simulation clock');
    const state = startSimulation(graph);
    graph.nodes[1] = { id: 'text', label: 'Changed', type: 'action', position: { x: 0, y: 100 }, config: { mode: 'text', body: 'Changed' } };
    expect(stepSimulation(stepSimulation(state)).trace.at(-1)?.message).toBe('Original');
  });
});
