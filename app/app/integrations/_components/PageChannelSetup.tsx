'use client';
import { useCallback, useEffect, useState } from 'react';
import { Button } from '@/components/ui/button';
import { Input } from '@/components/ui/input';
import { Label } from '@/components/ui/label';
import type { PublicConnection } from '@/lib/integrations/catalog';

type Channel = { id: string; status: string; revision: number; callback_url: string; verified_at: string | null; received_at: string | null };

export function PageChannelSetup({ connection }: { connection: PublicConnection }) {
  const [channel, setChannel] = useState<Channel | null>(null);
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState('');
  const [notice, setNotice] = useState('');
  const load = useCallback(async (activate = false) => {
    setBusy(true); setError(''); setNotice('');
    try {
      const response = await fetch('/api/v1/integration-connections/' + connection.id + '/channel', {
        method: activate ? 'POST' : 'GET', cache: 'no-store',
        ...(activate ? { headers: { 'Content-Type': 'application/json' }, body: JSON.stringify({ revision: connection.revision }) } : {}),
      });
      const result = await response.json();
      if (!response.ok) throw new Error(result.error?.message ?? 'Unable to load channel status.');
      setChannel(result.data);
      if (activate) setNotice('Channel prepared. Complete the webhook setup below. This does not publish a bot.');
    } catch (cause) { setError(cause instanceof Error ? cause.message : 'Unable to update channel.'); }
    finally { setBusy(false); }
  }, [connection.id, connection.revision]);
  useEffect(() => { let cancelled = false; void Promise.resolve().then(() => { if (!cancelled) void load(); }); return () => { cancelled = true; }; }, [load]);
  const current = channel?.revision === connection.revision && connection.active && channel.status !== 'STOPPED';
  return <section aria-label="Page messaging setup" className="mt-4 space-y-3 rounded-md border border-border p-3 text-sm">
    <p className="font-medium">Page messaging</p>
    <p className="text-text-muted">{!current ? 'Activate the tested credentials to prepare this organization’s channel.' : channel?.received_at ? 'A signed message has reached the CRM. Check Inbox to verify the conversation and reply.' : 'Waiting for a signed message from your Page.'}</p>
    {error && <p role="alert" className="text-error-fg">{error}</p>}
    {notice && <p role="status">{notice}</p>}
    <div className="flex flex-wrap gap-2">
      {!current && <Button size="sm" disabled={busy || !connection.active} onClick={() => void load(true)}>{busy ? 'Working…' : 'Activate messaging channel'}</Button>}
      <Button size="sm" variant="secondary" disabled={busy} onClick={() => void load()}>Refresh messaging status</Button>
    </div>
    {channel && <>
      <div><Label htmlFor={'page-callback-' + connection.id}>Webhook callback URL</Label><Input id={'page-callback-' + connection.id} readOnly value={channel.callback_url} /></div>
      <ol className="list-decimal space-y-2 pl-5 text-text-muted">
        <li>In your Meta app’s Messenger webhook settings, paste this callback URL and the verification token you saved with these credentials.</li>
        <li>Subscribe your Page to messages and messaging_postbacks. The Page token needs messaging permission and the required Meta app access.</li>
        <li>Send a test message to the Page, then refresh this status and open Inbox. Configure AI access separately before enabling automated replies.</li>
      </ol>
      <p>Webhook verification: {channel.verified_at ? 'Confirmed' : 'Not received'} · Signed message: {channel.received_at ? 'Received' : 'Not received'}</p>
      <p className="text-xs text-text-muted">Replies require an open messaging window. Credential rotation or disconnection suspends this channel until you activate it again.</p>
    </>}
  </section>;
}
