"use client";

import { useState, type FormEvent } from "react";
import { useRouter } from "next/navigation";

import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";

interface Stage {
  id: string;
  name: string;
  is_won: boolean;
  is_lost: boolean;
}

export function RetailFollowupAction({ leadId, expectedDueAt, stageId, stages }: {
  leadId: string;
  expectedDueAt: string;
  stageId: string;
  stages: Stage[];
}) {
  const router = useRouter();
  const [selected, setSelected] = useState(stageId);
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState("");
  const stage = stages.find((item) => item.id === selected);
  const closing = !!stage?.is_won || !!stage?.is_lost;

  async function complete(event: FormEvent<HTMLFormElement>) {
    event.preventDefault();
    setError("");
    const form = new FormData(event.currentTarget);
    const nextRaw = String(form.get("next_followup_at") ?? "");
    const nextDate = nextRaw ? new Date(nextRaw) : null;
    if (!closing && (!nextDate || Number.isNaN(nextDate.getTime()) || nextDate.getTime() <= Date.now())) {
      setError("Choose a future next follow-up for an open lead.");
      return;
    }
    setBusy(true);
    try {
      const response = await fetch(`/api/v1/retail-leads/${leadId}/followups`, {
        method: "POST", headers: { "Content-Type": "application/json" },
        body: JSON.stringify({
          expected_due_at: new Date(expectedDueAt).toISOString(),
          next_stage_id: selected,
          next_followup_at: closing ? null : nextDate!.toISOString(),
          note: String(form.get("note") ?? "") || null,
          lost_reason: stage?.is_lost ? String(form.get("lost_reason") ?? "") : null,
        }),
      });
      const result = await response.json() as { error?: { message: string } };
      if (!response.ok) throw new Error(result.error?.message ?? "Could not complete follow-up.");
      router.refresh();
    } catch (caught) {
      setError(caught instanceof Error ? caught.message : "Could not complete follow-up.");
    } finally {
      setBusy(false);
    }
  }

  return (
    <details className="min-w-64">
      <summary className="cursor-pointer font-medium underline">Mark follow-up done</summary>
      <form onSubmit={complete} className="mt-3 space-y-3 rounded-lg border bg-background p-3">
        <label className="block space-y-1">Next lead status
          <select className="block h-9 w-full rounded-md border bg-background px-2" value={selected}
            onChange={(event) => setSelected(event.target.value)}>
            {stages.map((item) => <option key={item.id} value={item.id}>
              {item.is_won ? "Converted" : item.is_lost ? "Lost" : item.name}</option>)}
          </select>
        </label>
        {!closing && <label className="block space-y-1">Next follow-up
          <Input name="next_followup_at" type="datetime-local" required /></label>}
        {stage?.is_lost && <label className="block space-y-1">Lost reason
          <Input name="lost_reason" required maxLength={500} /></label>}
        <label className="block space-y-1">Note
          <Input name="note" maxLength={2000} /></label>
        {error && <p role="alert" className="text-destructive">{error}</p>}
        <Button type="submit" disabled={busy || !selected}>{busy ? "Saving…" : "Done"}</Button>
      </form>
    </details>
  );
}
