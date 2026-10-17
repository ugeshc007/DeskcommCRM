import { afterEach, beforeEach, expect, it, vi } from 'vitest';
import { cleanup, fireEvent, render, screen, waitFor, within } from '@testing-library/react';
import { IntegrationsGallery } from '@/app/app/integrations/_components/IntegrationsGallery';
const fetchMock = vi.fn();
const saved = { id: '11111111-1111-4111-8111-111111111111', provider: 'messenger', label: 'Synthetic Page', revision: 1, active: false, auth_kind: 'api_key', validated_at: null, failure_code: null };
let rows: typeof saved[] = [];
beforeEach(() => {
  rows = []; fetchMock.mockReset(); vi.stubGlobal('fetch', fetchMock);
  fetchMock.mockImplementation(async (_url: string, options: RequestInit) => {
    if (_url.endsWith('/channel')) return { ok: true, json: async () => ({ data: null }) };
    if (options.method === 'POST') { rows = [saved]; return { ok: true, json: async () => ({ data: saved }) }; }
    return { ok: true, json: async () => ({ data: { connections: rows, runs: [], can_manage: true, google_oauth_configured: false } }) };
  });
});
afterEach(() => { cleanup(); vi.unstubAllGlobals(); });
async function openForm() {
  render(<IntegrationsGallery />);
  await screen.findByText('No connections yet. Choose an available app below to get started.');
  const card = screen.getByRole('heading', { name: 'Facebook Messenger' }).closest('article');
  expect(card).not.toBeNull();
  fireEvent.click(within(card!).getByRole('button', { name: 'Add connection' }));
  return screen.findByRole('dialog');
}
it('offers Page setup with masked secrets without automatically activating a bot', async () => {
  await openForm();
  expect(screen.getByLabelText('Page access token')).toHaveAttribute('type', 'password');
  expect(screen.getByLabelText('Meta app secret')).toHaveAttribute('type', 'password');
  expect(screen.getByLabelText(/Webhook verification token/)).toHaveAttribute('type', 'password');
  expect(screen.getByText(/This setup does not activate a bot or send messages/)).toBeInTheDocument();
});
it('saves through the shared endpoint without client organization authority and clears secrets after save', async () => {
  const dialog = await openForm();
  fireEvent.change(screen.getByLabelText('Connection name'), { target: { value: 'Synthetic Page' } });
  for (const [label, value] of [
    ['Facebook Page ID', '1234'], ['Page access token', 'synthetic-token'],
    ['Meta app secret', 'a'.repeat(32)], ['Graph API version (for example v26.0)', 'v26.0'],
  ]) fireEvent.change(screen.getByLabelText(label!), { target: { value } });
  fireEvent.change(screen.getByLabelText(/Webhook verification token/), { target: { value: 'synthetic_verify_token' } });
  fireEvent.submit(dialog.querySelector('form')!);
  await waitFor(() => expect(screen.queryByRole('dialog')).toBeNull());
  const call = fetchMock.mock.calls.find(([, options]) => options.method === 'POST');
  expect(call?.[0]).toBe('/api/v1/integration-connections');
  expect(JSON.parse(call?.[1].body)).toEqual({ provider: 'messenger', label: 'Synthetic Page', credential: {
    page_id: '1234', token: 'synthetic-token', app_secret: 'a'.repeat(32), verify_token: 'synthetic_verify_token', graph_version: 'v26.0',
  } });
  expect(screen.queryByDisplayValue('synthetic-token')).toBeNull();
  expect(screen.getByRole('status')).toHaveTextContent('then activate the messaging channel and configure its webhook');
});
it('does not label a successfully tested Page as a working messaging channel', async () => {
  rows = [{ ...saved, active: true }];
  render(<IntegrationsGallery />);
  await screen.findByText('Credentials verified');
  expect(screen.queryByText('Connected', { exact: true })).toBeNull();
  expect(await screen.findByRole('button', { name: 'Activate messaging channel' })).toBeInTheDocument();
  expect(screen.getByText(/Activate the tested credentials/)).toBeInTheDocument();
});
