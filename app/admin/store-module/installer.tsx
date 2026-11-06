'use client';
import { useState } from 'react';
import Link from 'next/link';
import { Button } from '@/components/ui/button';

export function StoreModuleInstaller() {
  const [confirmed, setConfirmed] = useState(false), [busy, setBusy] = useState(false), [message, setMessage] = useState(''), [error, setError] = useState('');
  async function install() {
    setBusy(true); setError(''); setMessage('');
    try {
      const response = await fetch('/api/v1/admin/store-module', { method: 'POST', headers: { 'Content-Type': 'application/json' }, body: JSON.stringify({ operation: 'install' }) });
      const result = await response.json(); if (!response.ok) throw new Error(result.error?.message ?? 'Installation failed.');
      setMessage('Store module installed. Each organization must configure and enable its own store. Existing data was preserved.');
    } catch (e) { setError(e instanceof Error ? e.message : 'Installation failed.'); }
    finally { setBusy(false); }
  }
  return <main className="mx-auto max-w-2xl space-y-5 p-6"><h1 className="text-2xl font-semibold">Store module</h1>
    <p>Install the optional catalogue, order and inventory tables on this server. This does not activate checkout for any organization, publish a bot, send messages or charge a customer.</p>
    <p>Running installation again preserves existing data. Removing store data is not part of this operation.</p>
    {error && <p role="alert" className="text-error-fg">{error}</p>}{message && <p role="status">{message}</p>}
    <label className="flex items-start gap-2"><input type="checkbox" checked={confirmed} onChange={e => setConfirmed(e.target.checked)} />Install or update the store module on this server.</label>
    <Button disabled={!confirmed || busy} onClick={() => void install()}>{busy ? 'Installing…' : 'Install store module'}</Button>
    <div><Link className="underline" href="/app/store">Open the current organization’s store</Link></div>
  </main>;
}
