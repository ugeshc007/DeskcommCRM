'use client';
import { useCallback, useEffect, useState } from 'react';
import Link from 'next/link';
import { Button } from '@/components/ui/button';
import { Input } from '@/components/ui/input';
import { Label } from '@/components/ui/label';
import { Textarea } from '@/components/ui/textarea';
import { emptyStoreConfig, type StoreConfig } from '@/lib/ecommerce/config';
import type { CheckoutQuote } from '@/lib/ecommerce/checkout';

type Product = { sku: string; name: string; category: string; description: string; price_cents: number; currency: string; stock: number | null; variants: []; media: { kind: 'image' | 'video'; url: string }[]; product_link: string | null };
type Settings = { revision: number; active: boolean; automated_checkout: boolean; config: StoreConfig; prices_include_all_taxes: boolean; payment_connection_id: string | null; reservation_minutes: number };
type Data = { installed: boolean; settings: Settings | null; products: { sku: string; revision: number; active: boolean; product: Product; stock_on_hand: number | null; stock_reserved: number }[];
  orders: { id: string; status: string; currency: string; total_cents: string; created_at: string }[];
  payment_connections: { id: string; label: string; active: boolean }[]; contacts: { id: string; display_name: string | null }[];
  locale: { country_code: string | null; currency: string; timezone: string } };
const selectClass = 'mt-1 block w-full rounded-md border border-border bg-surface p-2 text-sm';
const emptyProduct = (currency: string): Product => ({ sku: '', name: '', category: '', description: '', price_cents: 0, currency, stock: null, variants: [], media: [], product_link: null });
async function request(path: string, body?: unknown) {
  const response = await fetch(path, { method: body ? 'POST' : 'GET', cache: 'no-store', ...(body ? { headers: { 'Content-Type': 'application/json' }, body: JSON.stringify(body) } : {}) });
  const json = await response.json(); if (!response.ok) throw new Error(json.error?.message ?? 'Request failed. Refresh before retrying.'); return json.data;
}

export function StoreWorkspace() {
  const [data, setData] = useState<Data | null>(null), [error, setError] = useState(''), [notice, setNotice] = useState(''), [busy, setBusy] = useState(false);
  const [settings, setSettings] = useState<Settings>({ revision: 0, active: false, automated_checkout: false, config: emptyStoreConfig(), prices_include_all_taxes: false, payment_connection_id: null, reservation_minutes: 60 });
  const [product, setProduct] = useState<Product>(emptyProduct('USD')), [revision, setRevision] = useState(0), [active, setActive] = useState(true);
  const [contact, setContact] = useState(''), [sku, setSku] = useState(''), [quantity, setQuantity] = useState(1), [destination, setDestination] = useState(''), [currency, setCurrency] = useState('');
  const [quote, setQuote] = useState<Extract<CheckoutQuote, { status: 'quoted' }> | null>(null), [requestKey, setRequestKey] = useState('');
  const [recoveryOrder, setRecoveryOrder] = useState(''), [recoverySession, setRecoverySession] = useState('');
  const load = useCallback(async () => {
    const next = await request('/api/v1/ecommerce-store') as Data;
    setData(next);
    if (next.installed) { if (next.settings) setSettings(next.settings); setCurrency(next.locale.currency); setDestination(next.locale.country_code ?? ''); setProduct(p => p.sku ? p : emptyProduct(next.locale.currency)); }
  }, []);
  useEffect(() => { let cancelled = false; void Promise.resolve().then(() => { if (!cancelled) void load().catch(e => setError(e.message)); }); return () => { cancelled = true; }; }, [load]);
  async function run(operation: () => Promise<void>) { setBusy(true); setError(''); setNotice(''); try { await operation(); } catch (e) { setError(e instanceof Error ? e.message : 'Operation failed.'); } finally { setBusy(false); } }
  function policy(patch: Partial<StoreConfig>) { setSettings(s => ({ ...s, config: { ...s.config, ...patch } })); }
  const cart = { currency, country_code: destination, items: [{ sku, quantity }] };
  return <main className="mx-auto max-w-6xl space-y-6 p-4 md:p-8">
    <header className="flex flex-wrap items-center justify-between gap-3"><div><h1 className="text-2xl font-semibold">Store</h1><p className="mt-2 text-sm text-text-muted">Catalogue, delivery rules and reviewed checkout for this organization.</p></div><Button variant="secondary" disabled={busy} onClick={() => void run(load)}>Refresh</Button></header>
    {error && <p role="alert" className="rounded-md border border-error p-3 text-error-fg">{error}</p>}
    {notice && <p role="status" className="rounded-md border border-border p-3">{notice}</p>}
    {!data && !error && <p role="status">Loading store…</p>}
    {data && !data.installed && <p>The store module is not installed on this server. Ask your installation administrator to install it. Existing CRM data and bots are unchanged.</p>}
    {data?.installed && <>
      <p className="rounded-md bg-accent-soft p-3 text-sm">Region: {data.locale.country_code ?? 'Not configured'} · {data.locale.currency} · {data.locale.timezone}. Enabling checkout does not publish a bot or send customer messages.</p>
      <details className="rounded-lg border border-border p-4"><summary className="cursor-pointer font-semibold">1. Store and delivery settings</summary>
        <form className="mt-4 space-y-4" onSubmit={e => { e.preventDefault(); void run(async () => { await request('/api/v1/ecommerce-store', { operation: 'settings', ...settings }); await load(); setNotice('Store settings saved.'); }); }}>
          <div className="grid gap-4 sm:grid-cols-2"><label className="block text-sm">Payment connection<select className={selectClass} value={settings.payment_connection_id ?? ''} onChange={e => setSettings(s => ({ ...s, payment_connection_id: e.target.value || null }))}><option value="">Choose a Stripe connection</option>{data.payment_connections.map(c => <option key={c.id} value={c.id}>{c.label}{!c.active ? ' — test required' : ''}</option>)}</select></label><label className="block text-sm">Reservation duration (minutes)<Input type="number" min={30} max={1440} required value={settings.reservation_minutes} onChange={e => setSettings(s => ({ ...s, reservation_minutes: Number(e.target.value) }))} /></label></div>
          <Link href="/app/integrations" className="text-sm underline">Manage payment connections and webhook secrets</Link>
          <label className="flex items-start gap-2 text-sm"><input type="checkbox" checked={settings.prices_include_all_taxes} onChange={e => setSettings(s => ({ ...s, prices_include_all_taxes: e.target.checked }))} />I confirm that catalogue and courier prices include all applicable taxes. Checkout will not calculate additional taxes.</label>
          <label className="flex items-start gap-2 text-sm"><input type="checkbox" checked={settings.automated_checkout ?? false} onChange={e => setSettings(s => ({ ...s, automated_checkout: e.target.checked }))} />Allow the published sales agent to prepare checkout after the customer confirms a verified quote. This reserves stock and creates a payment link; it never charges a card automatically.</label>
          <label className="flex items-center gap-2 text-sm"><input type="checkbox" checked={settings.active} onChange={e => setSettings(s => ({ ...s, active: e.target.checked }))} />Enable reviewed checkout</label>
          <label className="flex items-center gap-2 text-sm"><input type="checkbox" checked={settings.config.payment_methods.includes('card')} onChange={e => policy({ payment_methods: e.target.checked ? [...new Set([...settings.config.payment_methods, 'card' as const])] : settings.config.payment_methods.filter(m => m !== 'card') })} />Allow card payment through this Stripe connection</label>
          <label className="block text-sm">Delivery coverage<select className={selectClass} value={settings.config.delivery_scope} onChange={e => policy({ delivery_scope: e.target.value as StoreConfig['delivery_scope'] })}><option value="domestic_only">Domestic only</option><option value="domestic_and_international">Domestic and international</option></select></label>
          <label className="block text-sm">Additional selling currencies<Input value={settings.config.additional_currencies.join(', ')} onChange={e => policy({ additional_currencies: e.target.value.toUpperCase().split(',').map(v => v.trim()).filter(Boolean) })} placeholder="For example USD, EUR" /></label>
          <label className="block text-sm">Product categories (comma separated)<Input value={settings.config.categories.join(', ')} onChange={e => policy({ categories: e.target.value.split(',').map(v => v.trim()).filter(Boolean) })} placeholder="Electronics, Home, Furniture, Groceries" /></label>
          {(['products', 'delivery', 'payment', 'returns', 'warranty'] as const).map(topic => <label className="block text-sm" key={topic}>{topic[0]!.toUpperCase() + topic.slice(1)} policy / FAQs<Textarea value={settings.config.faqs[topic]} maxLength={4000} onChange={e => policy({ faqs: { ...settings.config.faqs, [topic]: e.target.value } })} placeholder="Enter this organization's actual policy. Leave unknown information blank." /></label>)}
          <p className="text-xs text-text-muted">Enter prices in the currency’s minor units. No automatic currency conversion. Missing or overlapping courier rates require human review.</p>
          {settings.config.courier_rules.map((rate, index) => <fieldset className="grid gap-3 rounded-md border border-border p-3 sm:grid-cols-2" key={rate.id}><legend className="px-1">Courier rule {index + 1}</legend>
            {(['label', 'currency', 'delivery_information'] as const).map(field => <label className="block text-sm" key={field}>{field.replaceAll('_', ' ')}<Input value={rate[field]} required={field !== 'delivery_information'} onChange={e => policy({ courier_rules: settings.config.courier_rules.map((r, i) => i === index ? { ...r, [field]: e.target.value } : r) })} /></label>)}
            <label className="block text-sm">Scope<select className={selectClass} value={rate.scope} onChange={e => policy({ courier_rules: settings.config.courier_rules.map((r, i) => i === index ? { ...r, scope: e.target.value as 'domestic' | 'international' } : r) })}><option value="domestic">Domestic</option><option value="international">International</option></select></label>
            <label className="block text-sm">Destination country codes (blank means all within scope)<Input value={rate.countries.join(', ')} placeholder="AE, SA, OM" onChange={e => policy({ courier_rules: settings.config.courier_rules.map((r, i) => i === index ? { ...r, countries: e.target.value.toUpperCase().split(',').map(v => v.trim()).filter(Boolean) } : r) })} /></label>
            <label className="block text-sm">Rate type<select className={selectClass} value={rate.mode} onChange={e => policy({ courier_rules: settings.config.courier_rules.map((r, i) => i === index ? { ...r, mode: e.target.value as 'flat' | 'manual_quote', charge_cents: null, free_above_cents: null } : r) })}><option value="flat">Fixed charge</option><option value="manual_quote">Human quotation required</option></select></label>
            {rate.mode === 'flat' && <>
              <label className="block text-sm">Charge in minor units<Input type="number" min={0} required value={rate.charge_cents ?? ''} onChange={e => policy({ courier_rules: settings.config.courier_rules.map((r, i) => i === index ? { ...r, charge_cents: e.target.value === '' ? null : Number(e.target.value) } : r) })} /></label>
              <label className="block text-sm">Free delivery above subtotal (minor units, optional)<Input type="number" min={0} value={rate.free_above_cents ?? ''} onChange={e => policy({ courier_rules: settings.config.courier_rules.map((r, i) => i === index ? { ...r, free_above_cents: e.target.value === '' ? null : Number(e.target.value) } : r) })} /></label>
            </>}
            <Button type="button" variant="secondary" onClick={() => policy({ courier_rules: settings.config.courier_rules.filter((_, i) => i !== index) })}>Remove this draft rate</Button>
          </fieldset>)}
          <Button type="button" variant="secondary" onClick={() => policy({ courier_rules: [...settings.config.courier_rules, { id: 'rate-' + crypto.randomUUID(), label: '', scope: 'domestic', countries: [], currency: data.locale.currency, mode: 'flat', charge_cents: null, free_above_cents: null, delivery_information: '' }] })}>Add courier rate</Button>
          <div><Button disabled={busy} type="submit">Save settings</Button></div>
        </form>
      </details>
      <section className="space-y-4 rounded-lg border border-border p-4"><h2 className="text-lg font-semibold">2. Product catalogue</h2><p className="text-sm text-text-muted">Give each purchasable variant its own SKU. Stock is the total on hand; pending orders reserve part of it.</p>
        <form className="grid gap-3 sm:grid-cols-2" onSubmit={e => { e.preventDefault(); void run(async () => { await request('/api/v1/ecommerce-store', { operation: 'product', revision, active, product }); setProduct(emptyProduct(data.locale.currency)); setRevision(0); setActive(true); await load(); setNotice('Product saved.'); }); }}>
          {(['sku', 'name', 'category', 'description', 'currency'] as const).map(field => <div key={field}><Label htmlFor={'store-product-' + field}>{field === 'sku' ? 'SKU' : field[0]!.toUpperCase() + field.slice(1)}</Label><Input id={'store-product-' + field} value={product[field]} required={field !== 'description'} readOnly={field === 'sku' && revision > 0} onChange={e => setProduct(p => ({ ...p, [field]: e.target.value }))} /></div>)}
          <label className="block text-sm">Price in minor units<Input type="number" min={0} required value={product.price_cents} onChange={e => setProduct(p => ({ ...p, price_cents: Number(e.target.value) }))} /></label>
          <label className="block text-sm">Stock on hand (blank means unknown)<Input type="number" min={0} value={product.stock ?? ''} onChange={e => setProduct(p => ({ ...p, stock: e.target.value === '' ? null : Number(e.target.value) }))} /></label>
          <label className="block text-sm">Product link<Input type="url" value={product.product_link ?? ''} onChange={e => setProduct(p => ({ ...p, product_link: e.target.value || null }))} /></label>
          <fieldset className="space-y-3 sm:col-span-2"><legend className="text-sm font-medium">Product media (up to 10 public HTTPS links)</legend>
            {product.media.map((media, index) => <div key={index} className="flex flex-wrap items-end gap-2">
              <label className="block text-sm">Media type<select className={selectClass} value={media.kind} onChange={e => setProduct(p => ({ ...p, media: p.media.map((m, i) => i === index ? { ...m, kind: e.target.value as 'image' | 'video' } : m) }))}><option value="image">Image</option><option value="video">Video</option></select></label>
              <label className="block min-w-0 flex-1 text-sm">Media URL<Input type="url" required value={media.url} placeholder="https://" onChange={e => setProduct(p => ({ ...p, media: p.media.map((m, i) => i === index ? { ...m, url: e.target.value } : m) }))} /></label>
              <Button type="button" variant="secondary" onClick={() => setProduct(p => ({ ...p, media: p.media.filter((_, i) => i !== index) }))}>Remove media {index + 1}</Button>
            </div>)}
            <Button type="button" variant="secondary" disabled={product.media.length >= 10} onClick={() => setProduct(p => ({ ...p, media: [...p.media, { kind: 'image', url: '' }] }))}>Add product media</Button>
          </fieldset>
          <label className="flex items-center gap-2 text-sm"><input type="checkbox" checked={active} onChange={e => setActive(e.target.checked)} />Available in catalogue</label>
          <div className="flex gap-2"><Button type="submit" disabled={busy}>{revision ? 'Save product changes' : 'Add product'}</Button><Button type="button" variant="secondary" onClick={() => { setProduct(emptyProduct(data.locale.currency)); setRevision(0); setActive(true); }}>Clear form</Button></div>
        </form>
        <div className="overflow-x-auto"><table className="w-full text-left text-sm"><thead><tr><th className="p-2">Product / SKU</th><th className="p-2">Price (minor units)</th><th className="p-2">On hand / reserved</th><th className="p-2">Action</th></tr></thead><tbody>{data.products.map(p => <tr key={p.sku} className="border-t border-border"><td className="p-2">{p.product.name}<span className="block text-xs">{p.sku}{!p.active && ' · inactive'}</span></td><td className="p-2">{p.product.price_cents} {p.product.currency}</td><td className="p-2">{p.stock_on_hand ?? 'Unknown'} / {p.stock_reserved}</td><td className="p-2"><Button size="sm" variant="secondary" onClick={() => { setProduct({ ...p.product, stock: p.stock_on_hand }); setRevision(p.revision); setActive(p.active); }}>Edit</Button></td></tr>)}</tbody></table></div>
      </section>
      <section className="space-y-4 rounded-lg border border-border p-4"><h2 className="text-lg font-semibold">3. Reviewed checkout</h2><p className="text-sm text-text-muted">Preview a quote, obtain the customer’s agreement, then reserve stock. Payment preparation does not send the link to the customer automatically.</p>
        <form className="grid gap-3 sm:grid-cols-2" onChange={() => setQuote(null)} onSubmit={e => { e.preventDefault(); void run(async () => { setQuote(await request('/api/v1/ecommerce-checkout', { operation: 'preview', cart })); setRequestKey(crypto.randomUUID()); }); }}>
          <label className="block text-sm">Customer<select className={selectClass} required value={contact} onChange={e => setContact(e.target.value)}><option value="">Select customer</option>{data.contacts.map(c => <option key={c.id} value={c.id}>{c.display_name ?? 'Unnamed customer'}</option>)}</select></label>
          <label className="block text-sm">Product<select className={selectClass} required value={sku} onChange={e => setSku(e.target.value)}><option value="">Select SKU</option>{data.products.filter(p => p.active).map(p => <option key={p.sku} value={p.sku}>{p.product.name} · {p.sku}</option>)}</select></label>
          <label className="block text-sm">Quantity<Input type="number" min={1} max={10000} required value={quantity} onChange={e => setQuantity(Number(e.target.value))} /></label>
          <label className="block text-sm">Delivery country code<Input required minLength={2} maxLength={2} value={destination} onChange={e => setDestination(e.target.value.toUpperCase())} /></label>
          <label className="block text-sm">Currency<Input required minLength={3} maxLength={3} value={currency} onChange={e => setCurrency(e.target.value.toUpperCase())} /></label><Button disabled={busy} type="submit">Preview verified quote</Button>
        </form>
        {quote && <div className="space-y-3 rounded-md bg-accent-soft p-3"><p>Subtotal: {quote.subtotal_cents} · Delivery: {quote.delivery_cents} · Total: {quote.total_cents} {quote.currency} (minor units)</p><Button disabled={busy} onClick={() => void run(async () => { await request('/api/v1/ecommerce-checkout', { operation: 'reserve', order: { contact_id: contact, request_key: requestKey, confirmed_quote: quote.fingerprint, cart } }); setQuote(null); await load(); setNotice('Order reserved. Prepare its payment link below. No payment has been confirmed.'); })}>Customer agreed — reserve this order</Button></div>}
        <h3 className="font-medium">Latest 100 orders</h3><div className="space-y-3">{data.orders.map(order => <article key={order.id} className="flex flex-wrap items-center justify-between gap-3 rounded-md border border-border p-3"><div><p className="font-medium">{order.total_cents} {order.currency} (minor units)</p><p className="text-sm">{order.status.replaceAll('_', ' ')} · {new Date(order.created_at).toLocaleString('en')}</p></div>{['reserved', 'payment_review'].includes(order.status) && <Button size="sm" disabled={busy} onClick={() => void run(async () => { await request('/api/v1/ecommerce-checkout', { operation: 'payment', order_id: order.id }); await load(); setNotice('Payment status refreshed. Share only the verified link for this order.'); })}>Prepare / reconcile payment</Button>}{order.status === 'awaiting_payment' && <Button variant="secondary" size="sm" disabled={busy} onClick={() => void run(async () => {
          const current = await request('/api/v1/ecommerce-checkout', { operation: 'payment', order_id: order.id }) as { status: string; payment_url: string | null };
          if (current.status !== 'awaiting_payment' || !current.payment_url) { await load(); setNotice('Payment status changed. Review the order before sending anything.'); return; }
          await navigator.clipboard.writeText(current.payment_url); setNotice('Current payment link copied.');
        })}>Copy verified payment link</Button>}</article>)}</div>
        {data.orders.some(o => o.status === 'payment_review') && <details className="rounded-md border border-border p-3"><summary className="cursor-pointer font-medium">Recover an uncertain payment</summary><p className="my-3 text-sm">Find the existing Checkout Session in your payment provider dashboard using this order ID as the client reference. Paste its session ID below. The server verifies the organization, order, amount and currency; this never creates a new payment or charges a card.</p><form className="space-y-3" onSubmit={e => { e.preventDefault(); void run(async () => { await request('/api/v1/ecommerce-checkout', { operation: 'recover', order_id: recoveryOrder, session_id: recoverySession }); await load(); setNotice('Existing payment session verified. Review the refreshed order status.'); }); }}><label className="block text-sm">Order requiring review<select className={selectClass} required value={recoveryOrder} onChange={e => setRecoveryOrder(e.target.value)}><option value="">Select order</option>{data.orders.filter(o => o.status === 'payment_review').map(o => <option key={o.id} value={o.id}>{o.id}</option>)}</select></label><label className="block text-sm">Existing payment session ID<Input required value={recoverySession} onChange={e => setRecoverySession(e.target.value.trim())} placeholder="cs_…" /></label><Button type="submit" disabled={busy}>Verify existing payment</Button></form></details>}
      </section>
    </>}
  </main>;
}
