'use client';

import { useState, type FormEvent } from 'react';
import { useQuery, useQueryClient } from '@tanstack/react-query';
import { Button } from '@/components/ui/button';
import { Input } from '@/components/ui/input';
import { Dialog, DialogContent, DialogHeader, DialogTitle, DialogDescription } from '@/components/ui/dialog';
import { copyToClipboard } from '@/lib/clipboard';

type Device = { id: string; label: string; expires_at: string | null; revoked_at: string | null; paired: boolean };
export function FieldDevices({ organizationId, userId }: { organizationId: string; userId: string }) {
  const cache = useQueryClient(), key = ['field-devices', organizationId, userId];
  const [busy, setBusy] = useState(false), [error, setError] = useState('');
  const [issued, setIssued] = useState<{ code: string; expires_at: string } | null>(null);
  const [copied, setCopied] = useState(false), [copyError, setCopyError] = useState('');
  const [revoke, setRevoke] = useState<Device | null>(null);
  const devices = useQuery({ queryKey: key, gcTime: 0, queryFn: async (): Promise<Device[]> => {
    const response = await fetch('/api/v1/field-sales/devices', { cache: 'no-store' });
    const body = await response.json();
    if (!response.ok) throw new Error(body.error?.message ?? 'Unable to load your devices.');
    return body.data;
  } });
  async function mutate(input: unknown) {
    if (busy) return;
    setBusy(true); setError('');
    try {
      const response = await fetch('/api/v1/field-sales/devices', { method: 'POST', headers: { 'Content-Type': 'application/json' }, body: JSON.stringify(input) });
      const body = await response.json();
      if (!response.ok) throw new Error(body.error?.message ?? 'Device change failed. Refresh the list before retrying.');
      if (body.data.code) { setIssued(body.data); setCopied(false); setCopyError(''); }
      setRevoke(null); await cache.invalidateQueries({ queryKey: key });
    } catch (failure) { setError(failure instanceof Error ? failure.message : 'Device change failed.'); }
    finally { setBusy(false); }
  }
  function connect(event: FormEvent<HTMLFormElement>) {
    event.preventDefault(); const form = new FormData(event.currentTarget);
    void mutate({ operation: 'connect', label: String(form.get('label') ?? '') });
  }
  async function copyDeviceKey() {
    if (!issued) return;
    if (await copyToClipboard(issued.code)) {
      setCopied(true); setCopyError('');
    } else {
      setCopyError('Copy failed. Select the code field and copy it manually.');
    }
  }
  return <section className="max-w-3xl space-y-5">
    <div><h2 className="text-lg font-semibold">Connect your Android phone</h2>
      <p className="mt-2 text-sm text-muted-foreground">Sign in as the enrolled salesperson. Device keys access only that person’s assignments and work sessions, even if their CRM account is a manager.</p></div>
    {(error || devices.error) && <p role="alert" className="rounded-lg border border-destructive p-3">{error || devices.error?.message}</p>}
    <form onSubmit={connect} className="flex flex-wrap items-end gap-3 rounded-xl border p-4">
      <label className="grid min-w-0 flex-1 gap-2 text-sm font-medium">Phone name<Input name="label" required maxLength={100} placeholder="My work phone" autoComplete="off"/></label>
      <Button disabled={busy || !!issued}>Create pairing code</Button>
    </form>
    <p className="text-sm text-muted-foreground">The Android app already has this CRM address. Enter only the six-digit code. It expires after five minutes and can pair one phone; the phone stays signed in until sign-out or revocation. Pairing never starts GPS tracking.</p>
    {devices.isPending && <p role="status">Loading your devices…</p>}
    {devices.data?.length === 0 && <p>No devices connected yet.</p>}
    {devices.data?.map(device => <article className="flex flex-wrap items-center justify-between gap-3 rounded-xl border p-4" key={device.id}>
      <div><h3 className="font-medium">{device.label}</h3><p className="text-sm text-muted-foreground">{device.revoked_at ? 'Revoked' : device.paired ? 'Connected · valid until sign-out or revocation' : device.expires_at ? `Pairing code expires ${new Date(device.expires_at).toLocaleString()}` : 'Pairing unavailable'}</p></div>
      {!device.revoked_at && <Button variant="outline" disabled={busy} onClick={() => setRevoke(device)}>Revoke access</Button>}
    </article>)}
    <Dialog open={!!issued} onOpenChange={open => { if (!open) setIssued(null); }}><DialogContent><DialogHeader><DialogTitle>Six-digit pairing code</DialogTitle><DialogDescription>Enter this code in your own Android app within five minutes. It works once and is not a CRM password.</DialogDescription></DialogHeader>
      <label className="grid gap-2 text-sm">Pairing code<Input readOnly inputMode="numeric" autoComplete="off" className="text-center font-mono text-2xl tracking-[0.3em]" value={issued?.code ?? ''} onFocus={event => event.target.select()}/></label>
      <div className="flex flex-wrap items-center gap-3"><Button type="button" variant="outline" onClick={() => void copyDeviceKey()}>{copied ? 'Copied' : 'Copy code'}</Button><span role="status" className="text-sm">{copyError}</span></div>
      <p className="text-sm text-muted-foreground">Share it privately with the employee using this phone. It cannot be displayed again. If it expires, create a new code.</p>
      <Button onClick={() => setIssued(null)}>Done — hide code</Button>
    </DialogContent></Dialog>
    <Dialog open={!!revoke} onOpenChange={open => { if (!open) setRevoke(null); }}><DialogContent><DialogHeader><DialogTitle>Revoke {revoke?.label}?</DialogTitle><DialogDescription>The phone will lose server access. It stops collection when its next sync detects revocation; an offline phone cannot receive this immediately. Ask the employee to punch out first.</DialogDescription></DialogHeader>
      <div className="flex justify-end gap-3"><Button variant="outline" onClick={() => setRevoke(null)}>Cancel</Button><Button variant="destructive" disabled={busy} onClick={() => void mutate({ operation: 'revoke', id: revoke?.id })}>Revoke access</Button></div>
    </DialogContent></Dialog>
  </section>;
}
