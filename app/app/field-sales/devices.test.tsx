import { beforeEach, describe, expect, it, vi } from 'vitest';
import { screen, waitFor } from '@testing-library/react';
import userEvent from '@testing-library/user-event';
import { QueryClient, QueryClientProvider } from '@tanstack/react-query';
import { render } from '@testing-library/react';
import { FieldDevices } from './devices';

const code = '004281';

beforeEach(() => {
  vi.restoreAllMocks();
  vi.stubGlobal('fetch', vi.fn(async (_url: string, options?: RequestInit) => ({
    ok: true,
    json: async () => ({ data: options?.method === 'POST'
      ? { code, expires_at: '2026-10-21T00:00:00Z' }
      : [] }),
  })));
});

describe('manual Android device connection', () => {
  it('shows the short one-time code and copies it for entry in the Android app', async () => {
    const user = userEvent.setup();
    const writeText = vi.spyOn(navigator.clipboard, 'writeText').mockResolvedValue(undefined);
    const client = new QueryClient({ defaultOptions: { queries: { retry: false } } });
    render(<QueryClientProvider client={client}><FieldDevices organizationId="org" userId="staff" /></QueryClientProvider>);

    expect(screen.getByText(/Enter only the six-digit code/)).toBeInTheDocument();
    await user.type(screen.getByLabelText('Phone name'), 'Samsung test phone');
    await user.click(screen.getByRole('button', { name: 'Create pairing code' }));

    expect(await screen.findByRole('heading', { name: 'Six-digit pairing code' })).toBeInTheDocument();
    expect(screen.getByLabelText('Pairing code')).toHaveValue(code);
    await user.click(screen.getByRole('button', { name: 'Copy code' }));
    await waitFor(() => expect(writeText).toHaveBeenCalledWith(code));
    expect(screen.getByRole('button', { name: 'Copied' })).toBeInTheDocument();
  });

  it('keeps manual selection available when clipboard access is denied', async () => {
    const user = userEvent.setup();
    vi.spyOn(navigator.clipboard, 'writeText').mockRejectedValue(new Error('clipboard blocked'));
    const client = new QueryClient({ defaultOptions: { queries: { retry: false } } });
    render(<QueryClientProvider client={client}><FieldDevices organizationId="org" userId="staff" /></QueryClientProvider>);
    await user.type(screen.getByLabelText('Phone name'), 'Samsung test phone');
    await user.click(screen.getByRole('button', { name: 'Create pairing code' }));
    expect(await screen.findByLabelText('Pairing code')).toHaveValue(code);
    await user.click(screen.getByRole('button', { name: 'Copy code' }));
    expect(await screen.findByRole('status')).toHaveTextContent('Select the code field and copy it manually.');
  });
});
