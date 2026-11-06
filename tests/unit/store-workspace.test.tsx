import { afterEach, beforeEach, expect, it, vi } from 'vitest';
import { cleanup, fireEvent, render, screen, waitFor } from '@testing-library/react';
import { StoreWorkspace } from '@/app/app/store/workspace';
import { emptyStoreConfig } from '@/lib/ecommerce/config';

const fetchMock = vi.fn(), copy = vi.fn();
const data = { installed: true, settings: { revision: 1, active: false, config: emptyStoreConfig(), prices_include_all_taxes: false, payment_connection_id: null, reservation_minutes: 60 }, products: [], orders: [{ id: 'synthetic-order', status: 'awaiting_payment', currency: 'AED', total_cents: '1000', created_at: '2026-09-18T12:00:00Z' }], payment_connections: [], contacts: [], locale: { country_code: 'AE', currency: 'AED', timezone: 'Asia/Dubai' } };
beforeEach(() => {
  vi.clearAllMocks(); vi.stubGlobal('fetch', fetchMock);
  Object.defineProperty(navigator, 'clipboard', { configurable: true, value: { writeText: copy } });
  fetchMock.mockImplementation(async (_url: string, options: { method: string }) => options.method === 'GET'
    ? { ok: true, json: async () => ({ data: structuredClone(data) }) }
    : { ok: true, json: async () => ({ data: { status: 'awaiting_payment', payment_url: 'https://checkout.stripe.com/c/pay/synthetic' } }) });
});
afterEach(() => { cleanup(); vi.unstubAllGlobals(); });
async function open() { render(<StoreWorkspace />); await screen.findByRole('heading', { name: '2. Product catalogue' }); }
it('uses the organization currency and does not activate checkout by default', async () => {
  await open();
  expect(document.getElementById('store-product-currency')).toHaveValue('AED');
  expect(screen.getByLabelText('Enable reviewed checkout')).not.toBeChecked();
  expect(fetchMock.mock.calls.every(([, options]) => options.method === 'GET')).toBe(true);
});
it('does not copy an old link when the current connection check fails', async () => {
  await open();
  fetchMock.mockResolvedValueOnce({ ok: false, json: async () => ({ error: { message: 'Connection disconnected.' } }) });
  fireEvent.click(screen.getByRole('button', { name: 'Copy verified payment link' }));
  await screen.findByText('Connection disconnected.');
  expect(copy).not.toHaveBeenCalled();
});
it('revalidates an existing order before copying its payment link', async () => {
  await open(); fireEvent.click(screen.getByRole('button', { name: 'Copy verified payment link' }));
  await waitFor(() => expect(copy).toHaveBeenCalledWith('https://checkout.stripe.com/c/pay/synthetic'));
  const request = fetchMock.mock.calls.find(([url]) => url === '/api/v1/ecommerce-checkout')!;
  expect(JSON.parse(request[1].body)).toEqual({ operation: 'payment', order_id: 'synthetic-order' });
});
it('supports manual courier review without accidentally setting a free charge', async () => {
  await open(); fireEvent.click(screen.getByRole('button', { name: 'Add courier rate' }));
  fireEvent.change(screen.getByLabelText('Rate type'), { target: { value: 'manual_quote' } });
  expect(screen.queryByLabelText('Charge in minor units')).not.toBeInTheDocument();
  expect(screen.getByLabelText('Destination country codes (blank means all within scope)')).toHaveValue('');
});
it('provides image/video media editing without sending media to customers', async () => {
  await open(); fireEvent.click(screen.getByRole('button', { name: 'Add product media' }));
  expect(screen.getByLabelText('Media type')).toHaveValue('image');
  fireEvent.change(screen.getByLabelText('Media type'), { target: { value: 'video' } });
  expect(screen.getByLabelText('Media type')).toHaveValue('video');
  expect(fetchMock.mock.calls.every(([, options]) => options.method === 'GET')).toBe(true);
});
