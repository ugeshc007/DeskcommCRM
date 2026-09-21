"use client";

import { useEffect, useState, type FormEvent } from "react";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { Dialog, DialogContent, DialogDescription, DialogHeader, DialogTitle } from "@/components/ui/dialog";
import { copyToClipboard } from "@/lib/clipboard";
import type { TeamMember } from "@/hooks/team/useTeamMembers";

type Device = { id: string; label: string; expires_at: string; revoked_at: string | null };

export function OfficerDevicesDialog({ member, onClose }: { member: TeamMember; onClose: () => void }) {
  const [devices, setDevices] = useState<Device[]>([]);
  const [issued, setIssued] = useState<string | null>(null);
  const [error, setError] = useState("");
  const [busy, setBusy] = useState(false);
  const [loading, setLoading] = useState(true);
  const base = `/api/v1/team/${member.user_id}/field-devices`;

  useEffect(() => {
    let active = true;
    void fetch(base, { cache: "no-store" }).then(async response => {
      const body = await response.json();
      if (!response.ok) throw new Error(body.error?.message ?? "Could not load devices.");
      if (active) setDevices(body.data);
    }).catch(failure => { if (active) setError(failure instanceof Error ? failure.message : "Could not load devices."); })
      .finally(() => { if (active) setLoading(false); });
    return () => { active = false; };
  }, [base]);

  async function create(event: FormEvent<HTMLFormElement>) {
    event.preventDefault(); if (busy) return;
    const label = String(new FormData(event.currentTarget).get("label") ?? "");
    setBusy(true); setError("");
    try {
      const response = await fetch(base, { method: "POST", headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ label, display_name: member.full_name ?? member.email ?? "Field Officer" }) });
      const body = await response.json();
      if (!response.ok) throw new Error(body.error?.message ?? "Could not create key.");
      setIssued(body.data.token);
      setDevices(old => [{ id: body.data.id, label, expires_at: body.data.expires_at, revoked_at: null }, ...old]);
    } catch (failure) { setError(failure instanceof Error ? failure.message : "Could not create key."); }
    finally { setBusy(false); }
  }

  async function revoke(device: Device) {
    if (!window.confirm(`Revoke ${device.label}? The phone will lose server access when it next connects. Ask the employee to punch out first.`)) return;
    setBusy(true); setError("");
    try {
      const response = await fetch(base, { method: "DELETE", headers: { "Content-Type": "application/json" }, body: JSON.stringify({ id: device.id }) });
      const body = await response.json();
      if (!response.ok) throw new Error(body.error?.message ?? "Could not revoke device.");
      setDevices(old => old.map(item => item.id === device.id ? { ...item, revoked_at: new Date().toISOString() } : item));
    } catch (failure) { setError(failure instanceof Error ? failure.message : "Could not revoke device."); }
    finally { setBusy(false); }
  }

  return <Dialog open onOpenChange={open => { if (!open && !busy) onClose(); }}><DialogContent className="max-h-[85vh] overflow-y-auto">
    <DialogHeader><DialogTitle>Android access — {member.full_name ?? member.email ?? "Field Officer"}</DialogTitle>
      <DialogDescription>Each key works only for this employee’s projects and work sessions. Creating one enrolls this Field Officer, but GPS starts only after punch-in. Keys expire after 30 days.</DialogDescription></DialogHeader>
    {error && <p role="alert" className="text-sm text-destructive">{error}</p>}
    {issued ? <div className="space-y-3 rounded-lg border p-3"><p className="font-medium">One-time key — transfer privately to the employee’s Android phone</p>
      <Input aria-label="One-time device key" readOnly type="password" autoComplete="off" value={issued} onFocus={event => event.target.select()}/>
      <Button variant="outline" onClick={async () => { if (!await copyToClipboard(issued)) setError("Copy failed; select the key field and copy manually."); }}>Copy key</Button>
      <Button onClick={() => setIssued(null)}>Done — hide key</Button>
      <p className="text-xs text-muted-foreground">The key cannot be displayed again. It is not a CRM password or short PIN.</p></div>
      : <form onSubmit={create} className="flex flex-wrap items-end gap-2"><label className="min-w-0 flex-1 text-sm">Phone name<Input name="label" required maxLength={100} placeholder="Work phone" autoComplete="off"/></label><Button disabled={busy}>Create device key</Button></form>}
    {loading ? <p>Loading devices…</p> : devices.length === 0 ? <p className="text-sm">No keys created yet.</p> : devices.map(device => <div key={device.id} className="flex items-center justify-between gap-2 rounded-lg border p-3 text-sm">
      <span>{device.label}<br/><span className="text-muted-foreground">{device.revoked_at ? "Revoked" : `Expires ${new Date(device.expires_at).toLocaleString()}`}</span></span>
      {!device.revoked_at && <Button variant="outline" disabled={busy} onClick={() => void revoke(device)}>Revoke</Button>}
    </div>)}
  </DialogContent></Dialog>;
}
