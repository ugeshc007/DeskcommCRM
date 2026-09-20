'use client';
import { useState } from 'react';
import Link from 'next/link';
import { Button } from '@/components/ui/button';
export function FieldSalesInstaller() {
  const [confirmed, setConfirmed] = useState(false), [busy, setBusy] = useState(false);
  const [message, setMessage] = useState(''), [error, setError] = useState('');
  async function install() {
    setBusy(true); setError('');
    try {
      const response = await fetch('/api/v1/admin/field-sales-module', { method: 'POST', headers: { 'Content-Type': 'application/json' }, body: JSON.stringify({ operation: 'install' }) });
      const body = await response.json(); if (!response.ok) throw new Error(body.error?.message ?? 'Installation failed.');
      setMessage('Module installed. Tracking remains disabled until each organization configures its policy and enrolls staff.');
    } catch (e) { setError(e instanceof Error ? e.message : 'Installation failed.'); }
    finally { setBusy(false); }
  }
  return <main className="mx-auto max-w-2xl space-y-5 p-6"><h1 className="text-2xl font-semibold">Field Sales module</h1>
    <p>Install the optional project, scheduling, attendance and location tables. Existing CRM data is preserved. This action does not enroll employees or start tracking.</p>
    <p>Before activation, configure the employee notice, location retention and organization access. Use a controlled Android pilot before a wider rollout.</p>
    <label className="flex gap-2"><input type="checkbox" checked={confirmed} onChange={e => setConfirmed(e.target.checked)}/>Install or update this optional module.</label>
    {error && <p role="alert">{error}</p>}{message && <p role="status">{message}</p>}
    <Button disabled={!confirmed || busy} onClick={() => void install()}>{busy ? 'Installing…' : 'Install Field Sales module'}</Button>
    <p><Link href="/app/field-sales" className="underline">Open Field Sales</Link></p>
  </main>;
}
