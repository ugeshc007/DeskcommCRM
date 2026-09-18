'use client';

import { useState } from 'react';
import Link from 'next/link';
import { apiClient } from '@/lib/api/client';
import { Button } from '@/components/ui/button';
import { Input } from '@/components/ui/input';
import { Textarea } from '@/components/ui/textarea';
import { Dialog, DialogContent, DialogHeader, DialogTitle, DialogDescription } from '@/components/ui/dialog';
import { ShoppingBag } from '@/lib/ui/icons';
import { PROVEDORES } from '@/lib/ai/pontos/provedores';
import { emptyStoreConfig, storeConfigSchema, type StoreConfig, type StoreLocale } from '@/lib/ecommerce/config';
import type { StoreReceipt } from '@/lib/ecommerce/install';
import { quoteDelivery } from '@/lib/ecommerce/delivery';

type Setup = { locale: StoreLocale | null; channels: { id: string; display_name: string | null }[]; credentials: { id: string; label: string; provider: string }[] };
const selectClass = 'min-h-10 w-full rounded-md border border-border bg-surface px-3 text-sm';
const PAYMENT_OPTIONS = [
  ['card', 'Card'], ['bank_transfer', 'Bank transfer'], ['cash_on_delivery', 'Cash on delivery'],
  ['payment_link', 'Payment link'], ['wallet', 'Wallet'], ['buy_now_pay_later', 'Buy now, pay later'], ['custom', 'Other'],
] as const;

export function StoreTemplateInstaller() {
  const [open, setOpen] = useState(false), [busy, setBusy] = useState(false);
  const [setup, setSetup] = useState<Setup | null>(null), [error, setError] = useState('');
  const [receipt, setReceipt] = useState<StoreReceipt | null>(null);
  const [config, setConfig] = useState<StoreConfig>(emptyStoreConfig);
  const [categories, setCategories] = useState(''), [currencies, setCurrencies] = useState('');
  const [channel, setChannel] = useState(''), [provider, setProvider] = useState('anthropic');
  const [model, setModel] = useState(''), [credential, setCredential] = useState('');
  const [destination, setDestination] = useState(''), [quoteCurrency, setQuoteCurrency] = useState('');
  const [subtotal, setSubtotal] = useState(''), [quoteResult, setQuoteResult] = useState('');
  async function load() {
    setOpen(true); setBusy(true); setError(''); setSetup(null); setReceipt(null);
    setConfig(emptyStoreConfig()); setCategories(''); setCurrencies('');
    setChannel(''); setProvider('anthropic'); setModel(''); setCredential(''); setSubtotal('');
    try {
      const { data: loaded } = await apiClient.get<{ data: Setup }>('/api/v1/ecommerce-template'); setSetup(loaded);
      setDestination(loaded.locale?.country_code ?? ''); setQuoteCurrency(loaded.locale?.currency ?? ''); setQuoteResult('');
    }
    catch (e) { setError(e instanceof Error ? e.message : 'Store setup could not be loaded.'); }
    finally { setBusy(false); }
  }
  async function install(e: React.FormEvent) {
    e.preventDefault(); setError('');
    const parsed = storeConfigSchema.safeParse({ ...config,
      categories: categories.split(',').map(s => s.trim()).filter(Boolean),
      additional_currencies: currencies.split(',').map(s => s.trim().toUpperCase()).filter(Boolean),
    });
    if (!parsed.success) { setError(parsed.error.issues.map(i => `${i.path.join('.')}: ${i.message}`).join(' ')); return; }
    setBusy(true);
    try {
      const result = await apiClient.post<{ data: { receipt: StoreReceipt } }>('/api/v1/ecommerce-template', {
        config: parsed.data, channel_session_id: channel, provider, model, credential_id: credential || null,
      });
      setReceipt(result.data.receipt);
    } catch (e) { setError(e instanceof Error ? e.message : 'Installation could not be confirmed. Retry safely.'); }
    finally { setBusy(false); }
  }
  function rate(index: number, patch: Partial<StoreConfig['courier_rules'][number]>) {
    setConfig(c => ({ ...c, courier_rules: c.courier_rules.map((r, i) => i === index ? { ...r, ...patch } : r) }));
  }
  function previewQuote() {
    if (!setup?.locale) return;
    const result = quoteDelivery({ ...config, additional_currencies: currencies.split(',').map(s => s.trim().toUpperCase()).filter(Boolean) }, setup.locale, {
      country_code: destination, currency: quoteCurrency, subtotal_cents: subtotal.trim() === '' ? NaN : Number(subtotal),
    });
    setQuoteResult(result.status === 'quoted' ? `Courier charge: ${result.charge_cents} minor units (${result.currency}). ${result.information}`
      : result.status === 'not_available' ? 'Delivery is not available for this destination.'
        : `Human review required: ${result.reason.replaceAll('_', ' ')}. No charge has been quoted.`);
  }
  return <>
    <Button variant="outline" onClick={load}><ShoppingBag size={16} aria-hidden className="mr-2" />E-commerce template</Button>
    <Dialog open={open} onOpenChange={next => { if (!busy) setOpen(next); }}>
      <DialogContent className="max-h-[90dvh] overflow-y-auto sm:max-w-3xl">
        <DialogHeader><DialogTitle>Set up your store draft</DialogTitle>
          <DialogDescription>Create a Sales pipeline, an inactive sales agent and a draft enquiry flow. Existing resources are never overwritten. Nothing is published or sent.</DialogDescription>
        </DialogHeader>
        {error && <p role="alert" className="rounded-md border border-error-300 p-3 text-sm">{error}</p>}
        {busy && !setup && <p role="status">Loading organization settings…</p>}
        {!busy && !setup && <Button variant="outline" onClick={load}>Retry setup</Button>}
        {receipt ? <div className="space-y-3" role="status">
          <p>Store draft is ready for review. An existing installation is reused if you click twice.</p>
          <div className="flex flex-wrap gap-4 underline">
            <Link href={`/app/ai/agents/${receipt.agent_id}`}>Review sales agent</Link>
            <Link href={`/app/ai/followups/${receipt.flow_id}`}>Open enquiry flow</Link>
            <Link href="/app/settings/tenant/pipelines">Review Sales pipeline</Link>
          </div>
          <p className="text-sm text-text-muted">Add real products in your catalogue and test the bot before publication. This draft does not create orders, reserve stock, charge payments or start cart reminders.</p>
        </div> : setup && <form onSubmit={install} className="space-y-6">
          {setup.locale ? <p className="rounded-md bg-surface-subtle p-3 text-sm">Account region: {setup.locale.country_code} · {setup.locale.currency} · {setup.locale.timezone}</p>
            : <p role="alert">Set your organization country, currency and time zone before installation.</p>}
          <fieldset disabled={busy} className="grid gap-4 sm:grid-cols-2">
            <legend className="mb-3 font-medium">1. Agent and catalogue</legend>
            <label className="space-y-1 text-sm">Messaging channel<select className={selectClass} required value={channel} onChange={e => setChannel(e.target.value)}><option value="">Choose a channel</option>{setup.channels.map((c, i) => <option key={c.id} value={c.id}>{c.display_name || `Messaging channel ${i + 1}`}</option>)}</select></label>
            <label className="space-y-1 text-sm">AI provider<select className={selectClass} value={provider} onChange={e => { setProvider(e.target.value); setCredential(''); setModel(''); }}>{PROVEDORES.map(p => <option key={p.id} value={p.id}>{p.rotulo}</option>)}</select></label>
            <label className="space-y-1 text-sm">Model ID<Input required value={model} maxLength={120} onChange={e => setModel(e.target.value)} placeholder="Use a model supported by your provider" /></label>
            <label className="space-y-1 text-sm">AI credential<select className={selectClass} value={credential} onChange={e => setCredential(e.target.value)}><option value="">Installation key (verified before publication)</option>{setup.credentials.filter(c => c.provider === provider).map(c => <option key={c.id} value={c.id}>{c.label}</option>)}</select></label>
            <label className="space-y-1 text-sm">Product categories<Input value={categories} onChange={e => setCategories(e.target.value)} placeholder="Electronics, home items, furniture, groceries" /></label>
            <label className="space-y-1 text-sm">Additional currencies<Input value={currencies} onChange={e => setCurrencies(e.target.value)} placeholder="Comma-separated currency codes" /></label>
            <p className="text-xs text-text-muted sm:col-span-2">Categories and currencies do not create products or convert prices. Add actual catalogue prices and stock separately.</p>
          </fieldset>
          <fieldset disabled={busy} className="space-y-3">
            <legend className="mb-3 font-medium">2. Delivery and courier charges</legend>
            <label className="block space-y-1 text-sm">Delivery coverage<select className={selectClass} value={config.delivery_scope} onChange={e => setConfig(c => ({ ...c, delivery_scope: e.target.value as StoreConfig['delivery_scope'] }))}><option value="domestic_only">Domestic only</option><option value="domestic_and_international">Domestic and international</option></select></label>
            <p className="text-xs text-text-muted">No rate means a human quote is required, not free shipping. Enter charges in minor units (for AED, 100 = AED 1.00). International rules require international coverage.</p>
            {config.courier_rules.map((r, i) => <fieldset key={r.id} className="grid min-w-0 gap-3 rounded-md border border-border p-3 sm:grid-cols-2">
              <legend className="px-1 text-sm">Courier rule {i + 1}</legend>
              <label className="text-sm">Rule name<Input required value={r.label} onChange={e => rate(i, { label: e.target.value })} /></label>
              <label className="text-sm">Scope<select className={selectClass} value={r.scope} onChange={e => rate(i, { scope: e.target.value as 'domestic' | 'international' })}><option value="domestic">Domestic</option><option value="international">International</option></select></label>
              <label className="text-sm">Destination country codes (blank = all in scope)<Input defaultValue={r.countries.join(', ')} onBlur={e => rate(i, { countries: e.target.value.toUpperCase().split(',').map(s => s.trim()).filter(Boolean) })} placeholder="AE,IN" /></label>
              <label className="text-sm">Currency<Input required value={r.currency} maxLength={3} onChange={e => rate(i, { currency: e.target.value.toUpperCase() })} /></label>
              <label className="text-sm">Pricing<select className={selectClass} value={r.mode} onChange={e => rate(i, { mode: e.target.value as 'flat' | 'manual_quote', charge_cents: null, free_above_cents: null })}><option value="manual_quote">Human quote</option><option value="flat">Flat charge</option></select></label>
              {r.mode === 'flat' && <><label className="text-sm">Charge in minor units<Input type="number" min={0} step={1} required value={r.charge_cents ?? ''} onChange={e => rate(i, { charge_cents: e.target.value === '' ? null : Number(e.target.value) })} /></label>
                <label className="text-sm">Free delivery above (minor units, optional)<Input type="number" min={0} step={1} value={r.free_above_cents ?? ''} onChange={e => rate(i, { free_above_cents: e.target.value === '' ? null : Number(e.target.value) })} /></label></>}
              <label className="text-sm">Delivery information<Input value={r.delivery_information} maxLength={1000} onChange={e => rate(i, { delivery_information: e.target.value })} placeholder="Your confirmed delivery terms" /></label>
              <Button type="button" variant="outline" onClick={() => setConfig(c => ({ ...c, courier_rules: c.courier_rules.filter((_, index) => index !== i) }))}>Remove rule {i + 1}</Button>
            </fieldset>)}
            <Button type="button" variant="outline" disabled={!setup.locale || config.courier_rules.length >= 50} onClick={() => setConfig(c => ({ ...c, courier_rules: [...c.courier_rules, { id: `rate-${crypto.randomUUID()}`, label: '', scope: 'domestic', countries: [], currency: setup.locale!.currency, mode: 'manual_quote', charge_cents: null, free_above_cents: null, delivery_information: '' }] }))}>Add courier rule</Button>
            <details className="rounded-md border border-border p-3"><summary className="cursor-pointer text-sm font-medium">Test a delivery quote (no order or payment)</summary>
              <div className="mt-3 grid gap-3 sm:grid-cols-3">
                <label className="text-sm">Test destination country<Input value={destination} maxLength={2} onChange={e => setDestination(e.target.value.toUpperCase())} /></label>
                <label className="text-sm">Test currency<Input value={quoteCurrency} maxLength={3} onChange={e => setQuoteCurrency(e.target.value.toUpperCase())} /></label>
                <label className="text-sm">Test subtotal in minor units<Input type="number" min={0} step={1} value={subtotal} onChange={e => setSubtotal(e.target.value)} /></label>
              </div>
              <Button type="button" variant="outline" className="mt-3" onClick={previewQuote}>Calculate preview</Button>
              {quoteResult && <p role="status" className="mt-3 text-sm">{quoteResult} Recalculate after changing settings.</p>}
            </details>
          </fieldset>
          <fieldset disabled={busy} className="space-y-3"><legend className="mb-3 font-medium">3. Payment options and policies</legend>
            <div className="grid gap-3 sm:grid-cols-2">{PAYMENT_OPTIONS.map(([id, label]) => <label key={id} className="flex min-h-10 items-center gap-2 text-sm"><input type="checkbox" checked={config.payment_methods.includes(id)} onChange={e => setConfig(c => ({ ...c, payment_methods: e.target.checked ? [...c.payment_methods, id] : c.payment_methods.filter(p => p !== id) }))} />{label}</label>)}</div>
            {(['products', 'delivery', 'payment', 'returns', 'warranty'] as const).map(key => <label key={key} className="block space-y-1 text-sm"><span className="capitalize">{key} FAQ</span><Textarea maxLength={4000} value={config.faqs[key]} onChange={e => setConfig(c => ({ ...c, faqs: { ...c.faqs, [key]: e.target.value } }))} placeholder="Your actual policy. Leave blank if not configured." /></label>)}
          </fieldset>
          <p className="text-sm text-text-muted">These policies become the draft agent prompt. Review and edit them in the agent editor after installation. Payment options here do not connect a payment provider.</p>
          <Button type="submit" disabled={busy || !setup.locale || !channel || !model}>{busy ? 'Installing draft…' : 'Install draft — do not publish'}</Button>
        </form>}
      </DialogContent>
    </Dialog>
  </>;
}
