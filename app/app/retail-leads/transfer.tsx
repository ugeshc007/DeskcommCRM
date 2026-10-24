"use client";

import { useState, type FormEvent } from "react";
import { useRouter } from "next/navigation";

import { Button } from "@/components/ui/button";

export interface TransferDestination {
  id: string;
  name: string;
  pipelines: Array<{ id: string; name: string }>;
  stages: Array<{ id: string; pipeline_id: string; name: string }>;
  owners: Array<{ id: string; name: string; store: string }>;
}

interface Props {
  leads: Array<{ id: string; name: string }>;
  destinations: TransferDestination[];
}

export function RetailLeadTransfer({ leads, destinations }: Props) {
  const router = useRouter();
  const [leadId, setLeadId] = useState(leads[0]?.id ?? "");
  const [destinationId, setDestinationId] = useState(destinations[0]?.id ?? "");
  const destination = destinations.find((item) => item.id === destinationId);
  const [pipelineId, setPipelineId] = useState(destination?.pipelines[0]?.id ?? "");
  const [stageId, setStageId] = useState(destination?.stages.find((stage) =>
    stage.pipeline_id === pipelineId)?.id ?? "");
  const [ownerId, setOwnerId] = useState(destination?.owners[0]?.id ?? "");
  const [busy, setBusy] = useState(false);
  const [message, setMessage] = useState("");
  const stages = destination?.stages.filter((stage) => stage.pipeline_id === pipelineId) ?? [];

  async function transfer(event: FormEvent<HTMLFormElement>) {
    event.preventDefault();
    setBusy(true);
    setMessage("");
    try {
      const response = await fetch(`/api/v1/retail-leads/${leadId}/transfer`, {
        method: "POST", headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ destination_org_id: destinationId,
          destination_pipeline_id: pipelineId, destination_stage_id: stageId,
          destination_owner_user_id: ownerId }),
      });
      const result = await response.json() as { error?: { message: string } };
      if (!response.ok) throw new Error(result.error?.message ?? "Could not move the Event ID.");
      setMessage("Event ID moved to the destination organization with its history.");
      router.refresh();
    } catch (caught) {
      setMessage(caught instanceof Error ? caught.message : "Could not move the Event ID.");
    } finally {
      setBusy(false);
    }
  }

  return <section className="space-y-3 rounded-xl border p-5">
    <h2 className="text-lg font-semibold">Move an Event ID to another brand</h2>
    <p className="text-sm text-muted-foreground">Only a manager or admin in both organizations can move an open Event ID.
      The Event ID stays the same; its customer and notes move with it. Some linked records need manager review before a move.</p>
    <form onSubmit={transfer} className="grid gap-3 sm:grid-cols-2 lg:grid-cols-5">
      <label className="block space-y-1 text-sm">Event ID
        <select className="block h-10 w-full rounded-md border bg-background px-3" value={leadId}
          onChange={(event) => setLeadId(event.target.value)}>
          {leads.map((lead) => <option key={lead.id} value={lead.id}>{lead.name} · {lead.id.slice(0, 8)}</option>)}
        </select>
      </label>
      <label className="block space-y-1 text-sm">Destination brand
        <select className="block h-10 w-full rounded-md border bg-background px-3" value={destinationId}
          onChange={(event) => { const next = destinations.find((item) => item.id === event.target.value);
            const pipeline = next?.pipelines[0]?.id ?? "";
            setDestinationId(event.target.value); setPipelineId(pipeline);
            setStageId(next?.stages.find((stage) => stage.pipeline_id === pipeline)?.id ?? "");
            setOwnerId(next?.owners[0]?.id ?? ""); }}>
          {destinations.map((item) => <option key={item.id} value={item.id}>{item.name}</option>)}
        </select>
      </label>
      <label className="block space-y-1 text-sm">Destination funnel
        <select className="block h-10 w-full rounded-md border bg-background px-3" value={pipelineId}
          onChange={(event) => { setPipelineId(event.target.value);
            setStageId(destination?.stages.find((stage) => stage.pipeline_id === event.target.value)?.id ?? ""); }}>
          {destination?.pipelines.map((pipeline) => <option key={pipeline.id} value={pipeline.id}>{pipeline.name}</option>)}
        </select>
      </label>
      <label className="block space-y-1 text-sm">First stage
        <select className="block h-10 w-full rounded-md border bg-background px-3" value={stageId}
          onChange={(event) => setStageId(event.target.value)}>
          {stages.map((stage) => <option key={stage.id} value={stage.id}>{stage.name}</option>)}
        </select>
      </label>
      <label className="block space-y-1 text-sm">Destination salesperson
        <select className="block h-10 w-full rounded-md border bg-background px-3" value={ownerId}
          onChange={(event) => setOwnerId(event.target.value)}>
          {destination?.owners.map((owner) => <option key={owner.id} value={owner.id}>{owner.name} · {owner.store}</option>)}
        </select>
      </label>
      <div className="sm:col-span-2 lg:col-span-5">
        <Button type="submit" disabled={busy || !leadId || !destinationId || !pipelineId || !stageId || !ownerId}>
          {busy ? "Moving…" : "Move Event ID"}</Button>
      </div>
    </form>
    {message && <p role="status" className="text-sm">{message}</p>}
  </section>;
}
