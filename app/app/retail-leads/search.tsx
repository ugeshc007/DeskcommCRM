"use client";

import { useState, type FormEvent } from "react";
import Link from "next/link";

import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { retailEventStatus } from "@/lib/retail/event-status";

interface EventResult {
  event_id: string;
  customer_name: string;
  phone: string;
  store_name: string;
  pipeline_id: string;
  status: string;
  custom_fields: unknown;
  created_at: string;
}

export function RetailEventSearch() {
  const [phone, setPhone] = useState("");
  const [events, setEvents] = useState<EventResult[] | null>(null);
  const [hasMore, setHasMore] = useState(false);
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState("");

  async function search(event: FormEvent<HTMLFormElement>) {
    event.preventDefault();
    setBusy(true);
    setError("");
    setEvents(null);
    try {
      const response = await fetch("/api/v1/retail-leads/search", {
        method: "POST", headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ phone: phone.trim() }),
      });
      const result = await response.json() as { data?: { events: EventResult[]; has_more: boolean };
        error?: { message: string } };
      if (!response.ok) throw new Error(result.error?.message ?? "Could not search Event IDs.");
      setEvents(result.data?.events ?? []);
      setHasMore(result.data?.has_more ?? false);
    } catch (caught) {
      setError(caught instanceof Error ? caught.message : "Could not search Event IDs.");
    } finally {
      setBusy(false);
    }
  }

  return <section className="space-y-3 rounded-xl border p-5">
    <h2 className="text-lg font-semibold">Find Event IDs by phone</h2>
    <p className="text-sm text-muted-foreground">Search open and historical Event IDs in this organization.</p>
    <form onSubmit={search} className="flex flex-wrap items-end gap-3">
      <label className="block min-w-64 space-y-1 text-sm">Customer phone
        <Input value={phone} onChange={(event) => setPhone(event.target.value)}
          required pattern="\+[0-9]{8,15}" placeholder="+971501234567" />
      </label>
      <Button type="submit" disabled={busy}>{busy ? "Searching…" : "Search Event IDs"}</Button>
    </form>
    {error && <p role="alert" className="text-sm text-destructive">{error}</p>}
    {events && <div role="status" className="space-y-2 text-sm">
      <p>{events.length} Event ID{events.length === 1 ? "" : "s"} found.</p>
      {events.map((item) => <div key={item.event_id} className="rounded-lg border p-3">
        <Link href={`/app/pipelines/${item.pipeline_id}`} className="font-medium underline">{item.customer_name}</Link>
        <span className="ml-2">{retailEventStatus(item.status, item.custom_fields)} · {item.store_name}</span>
        <span className="block font-mono text-xs text-muted-foreground">{item.event_id}</span>
      </div>)}
      {hasMore && <p>More than 200 Event IDs match this phone. Ask a manager to review the complete history.</p>}
    </div>}
  </section>;
}
