import { afterEach, beforeEach, expect, it, vi } from 'vitest';
import { cleanup, fireEvent, render, screen, waitFor } from '@testing-library/react';
import { StoreTemplateInstaller } from '@/app/app/ai/followups/_components/StoreTemplateInstaller';
const api = vi.hoisted(() => ({ get: vi.fn(), post: vi.fn() }));
vi.mock('@/lib/api/client', () => ({ apiClient: api }));
const setup = { locale: { country_code: 'AE', currency: 'AED', timezone: 'Asia/Dubai' }, channels: [{ id: '11111111-1111-4111-8111-111111111111', display_name: 'Synthetic store' }], credentials: [] };
beforeEach(() => { vi.clearAllMocks(); api.get.mockResolvedValue({ data: setup }); });
afterEach(cleanup);
async function open() { render(<StoreTemplateInstaller />); fireEvent.click(screen.getByRole('button', { name: 'E-commerce template' })); await screen.findByLabelText('Messaging channel'); }
it('loads organization region and leaves installation disabled until configured', async () => {
  await open(); expect(screen.getByText(/Account region:/)).toHaveTextContent('AE · AED · Asia/Dubai');
  expect(screen.getByRole('button', { name: 'Install draft — do not publish' })).toBeDisabled();
  expect(api.post).not.toHaveBeenCalled();
});
it('requires explicit delivery charge and retains fields on failure', async () => {
  await open(); fireEvent.change(screen.getByLabelText('Messaging channel'), { target: { value: setup.channels[0]!.id } });
  fireEvent.change(screen.getByLabelText('Model ID'), { target: { value: 'synthetic' } });
  fireEvent.click(screen.getByRole('button', { name: 'Add courier rule' }));
  expect(screen.getByLabelText('Pricing')).toHaveValue('manual_quote');
  fireEvent.change(screen.getByLabelText('Rule name'), { target: { value: 'Local quote' } });
  api.post.mockRejectedValue(new Error('Database unavailable'));
  fireEvent.click(screen.getByRole('button', { name: 'Install draft — do not publish' }));
  await screen.findByRole('alert'); expect(screen.getByLabelText('Rule name')).toHaveValue('Local quote');
  expect(api.post.mock.calls[0]![1].config.courier_rules[0]).toMatchObject({ charge_cents: null, mode: 'manual_quote' });
});
it('never submits locale or organization authority from the form and shows draft review links', async () => {
  await open(); fireEvent.change(screen.getByLabelText('Messaging channel'), { target: { value: setup.channels[0]!.id } });
  fireEvent.change(screen.getByLabelText('Model ID'), { target: { value: 'synthetic' } });
  api.post.mockResolvedValue({ data: { receipt: { agent_id: 'agent', flow_id: 'flow', pipeline_id: 'pipeline' } } });
  fireEvent.click(screen.getByRole('button', { name: 'Install draft — do not publish' }));
  await screen.findByRole('link', { name: 'Open enquiry flow' });
  expect(api.post.mock.calls[0]![1]).not.toHaveProperty('organization_id');
  expect(api.post.mock.calls[0]![1]).not.toHaveProperty('locale');
  expect(screen.getByRole('link', { name: 'Open enquiry flow' })).toHaveAttribute('href', '/app/ai/followups/flow');
});
it('shows load errors with a retry rather than an empty success form', async () => {
  api.get.mockRejectedValueOnce(new Error('Setup unavailable'));
  render(<StoreTemplateInstaller />); fireEvent.click(screen.getByRole('button', { name: 'E-commerce template' }));
  await screen.findByRole('alert'); expect(screen.queryByLabelText('Messaging channel')).toBeNull();
  fireEvent.click(screen.getByRole('button', { name: 'Retry setup' }));
  await waitFor(() => expect(screen.getByLabelText('Messaging channel')).toBeInTheDocument());
});
