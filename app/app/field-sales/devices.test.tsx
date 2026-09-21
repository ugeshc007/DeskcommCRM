import { beforeEach, describe, expect, it, vi } from 'vitest';
import { screen, waitFor } from '@testing-library/react';
import userEvent from '@testing-library/user-event';
import { QueryClient, QueryClientProvider } from '@tanstack/react-query';
import { render } from '@testing-library/react';
import { FieldDevices } from './devices';

const token = `fld_${'a'.repeat(64)}`;

beforeEach(() => {
  vi.restoreAllMocks();
  vi.stubGlobal('fetch', vi.fn(async (_url: string, options?: RequestInit) => ({
    ok: true,
    json: async () => ({ data: options?.method === 'POST'
      ? { token, expires_at: '2026-10-21T00:00:00Z' }
      : [] }),
  })));
});

describe('manual Android device connection', () => {
  it('shows the one-time key and copies it for entry in the Android app', async () => {
    const user = userEvent.setup();
    const writeText = vi.spyOn(navigator.clipboard, 'writeText').mockResolvedValue(undefined);
    const client = new QueryClient({ defaultOptions: { queries: { retry: false } } });
    render(<QueryClientProvider client={client}><FieldDevices organizationId="org" userId="staff" /></QueryClientProvider>);

    expect(screen.getByText(/not a short login PIN/)).toBeInTheDocument();
    await user.type(screen.getByLabelText('Phone name'), 'Samsung test phone');
    await user.click(screen.getByRole('button', { name: 'Create device key' }));

    expect(await screen.findByRole('heading', { name: 'One-time device key' })).toBeInTheDocument();
    expect(screen.getByLabelText('Device key')).toHaveValue(token);
    await user.click(screen.getByRole('button', { name: 'Copy device key' }));
    await waitFor(() => expect(writeText).toHaveBeenCalledWith(token));
    expect(screen.getByRole('button', { name: 'Copied' })).toBeInTheDocument();
  });

  it('keeps manual selection available when clipboard access is denied', async () => {
    const user = userEvent.setup();
    vi.spyOn(navigator.clipboard, 'writeText').mockRejectedValue(new Error('clipboard blocked'));
    const client = new QueryClient({ defaultOptions: { queries: { retry: false } } });
    render(<QueryClientProvider client={client}><FieldDevices organizationId="org" userId="staff" /></QueryClientProvider>);
    await user.type(screen.getByLabelText('Phone name'), 'Samsung test phone');
    await user.click(screen.getByRole('button', { name: 'Create device key' }));
    expect(await screen.findByLabelText('Device key')).toHaveValue(token);
    await user.click(screen.getByRole('button', { name: 'Copy device key' }));
    expect(await screen.findByRole('status')).toHaveTextContent('Select the key field and copy it manually.');
  });
});
