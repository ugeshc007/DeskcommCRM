import { describe, expect, it, vi, afterEach } from 'vitest';
import { createStoreEnquiryFlow, storeSalesPrompt, STORE_SALES_STAGES } from './template';
import { emptyStoreConfig } from './config';
import { startSimulation, stepSimulation } from '@/lib/followup/simulator';
import { validateFlowForPublish } from '@/lib/followup/validate-publish';

afterEach(() => vi.unstubAllGlobals());
describe('store enquiry draft', () => {
  it('has connected valid, invalid and timeout paths for every question', () => {
    expect(validateFlowForPublish(createStoreEnquiryFlow())).toEqual({ ok: true });
  });
  it('collects preferences without a real send, order, charge or catalogue invention', () => {
    const network = vi.fn(() => { throw new Error('Unexpected request'); }); vi.stubGlobal('fetch', network);
    let state = startSimulation(createStoreEnquiryFlow());
    const answers: Record<string, string> = { category: 'Home', product: 'Example SKU', quantity: '2', destination: 'AE, Dubai', payment: 'Card' };
    for (let steps = 0; steps < 30 && state.status === 'running'; steps++) {
      const key = state.node_id?.replace('reply-', '') ?? '';
      state = stepSimulation(state, answers[key] ? { reply: answers[key] } : undefined);
    }
    expect(state.status).toBe('completed');
    expect(state.variables.store_product?.value).toBe('Example SKU');
    expect(state.variables.store_quantity?.value).toBe('2');
    expect(state.node_id).toBe('finish');
    expect(network).not.toHaveBeenCalled();
  });
  it('does not store an empty reply or continue a checkout after timeout', () => {
    let state = startSimulation(createStoreEnquiryFlow());
    state = stepSimulation(stepSimulation(state));
    const invalid = stepSimulation(state, { reply: ' ' });
    expect(invalid.node_id).toBe('ask-category'); expect(invalid.variables).toEqual({});
    const timedOut = stepSimulation(state, { timeout: true });
    expect(timedOut.node_id).toBe('no-reply');
  });
  it('uses independent graphs for each draft', () => {
    const changed = createStoreEnquiryFlow(); changed.nodes[0]!.label = 'Other organization';
    expect(createStoreEnquiryFlow().nodes[0]!.label).toBe('Welcome');
  });
  it('grounds the English agent in organization configuration and does not fabricate policies', () => {
    const config = emptyStoreConfig(); config.categories = ['Furniture'];
    const prompt = storeSalesPrompt(config, { country_code: 'AE', currency: 'AED', timezone: 'Asia/Dubai' });
    expect(prompt).toContain('Speak and write in English');
    expect(prompt).toContain('Furniture'); expect(prompt).toContain('AED');
    expect(prompt).toContain('Unconfigured policy fields are unknown');
    expect(prompt).toContain('Only a verified payment record');
    expect(prompt).toContain('use human handoff');
    expect(STORE_SALES_STAGES.map(stage => stage.hint)).toEqual(['new', 'contacted', 'qualifying', 'qualified', 'negotiating', 'won', 'lost']);
  });
});
