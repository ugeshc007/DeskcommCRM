"use client";

import { useState, type FormEvent } from "react";
import { useRouter } from "next/navigation";

import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { Label } from "@/components/ui/label";
import { parseReaisToCents } from "@/lib/money";

interface Pipeline { id: string; name: string }
interface Stage { id: string; pipeline_id: string; name: string }
interface Member { id: string; label: string }
interface Assignment { user_id: string; store_name: string }

interface Props {
  pipelines: Pipeline[];
  stages: Stage[];
  currency: string;
  ownStore: string | null;
  manager: boolean;
  members: Member[];
  assignments: Assignment[];
}

export function RetailLeadWorkspace({ pipelines, stages, currency, ownStore, manager, members, assignments }: Props) {
  const router = useRouter();
  const [pipelineId, setPipelineId] = useState(pipelines[0]?.id ?? "");
  const availableStages = stages.filter((stage) => stage.pipeline_id === pipelineId);
  const [stageId, setStageId] = useState(availableStages[0]?.id ?? "");
  const [products, setProducts] = useState<string[]>([]);
  const [productInput, setProductInput] = useState("");
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState("");
  const [createdId, setCreatedId] = useState("");
  const [memberId, setMemberId] = useState(members[0]?.id ?? "");
  const [storeName, setStoreName] = useState(assignments.find((item) => item.user_id === members[0]?.id)?.store_name ?? "");
  const [storeMessage, setStoreMessage] = useState("");

  function addProduct() {
    const value = productInput.trim();
    if (value && !products.includes(value)) setProducts((current) => [...current, value]);
    setProductInput("");
  }

  async function createLead(event: FormEvent<HTMLFormElement>) {
    event.preventDefault();
    const formElement = event.currentTarget;
    setError("");
    setCreatedId("");
    const form = new FormData(formElement);
    const budget = parseReaisToCents(String(form.get("budget") ?? ""));
    const chosenProducts = productInput.trim() && !products.includes(productInput.trim())
      ? [...products, productInput.trim()] : products;
    if (budget === null || chosenProducts.length === 0) {
      setError("Enter a valid budget and at least one product.");
      return;
    }
    const followup = String(form.get("next_followup_at") ?? "");
    const nextFollowupAt = new Date(followup);
    if (!followup || Number.isNaN(nextFollowupAt.getTime()) || nextFollowupAt.getTime() <= Date.now()) {
      setError("Choose a future date and time for the next follow-up.");
      return;
    }
    setBusy(true);
    try {
      const response = await fetch("/api/v1/retail-leads", {
        method: "POST", headers: { "Content-Type": "application/json" },
        body: JSON.stringify({
          pipeline_id: pipelineId, stage_id: stageId,
          customer_name: String(form.get("customer_name") ?? ""),
          primary_phone: String(form.get("primary_phone") ?? ""),
          secondary_phone: String(form.get("secondary_phone") ?? "") || null,
          email: String(form.get("email") ?? "") || null,
          source: String(form.get("source") ?? ""),
          how_known: String(form.get("how_known") ?? "") || null,
          products: chosenProducts, budget_cents: budget,
          expected_purchase_date: String(form.get("expected_purchase_date") ?? ""),
          address: String(form.get("address") ?? "") || null,
          next_followup_at: nextFollowupAt.toISOString(),
        }),
      });
      const result = await response.json() as { data?: { event_id: string }; error?: { message: string } };
      if (!response.ok) throw new Error(result.error?.message ?? "Could not create the lead.");
      setCreatedId(result.data?.event_id ?? "");
      setProducts([]);
      setProductInput("");
      formElement.reset();
      router.refresh();
    } catch (caught) {
      setError(caught instanceof Error ? caught.message : "Could not create the lead.");
    } finally {
      setBusy(false);
    }
  }

  async function assignStore(event: FormEvent<HTMLFormElement>) {
    event.preventDefault();
    setStoreMessage("");
    setBusy(true);
    try {
      const response = await fetch("/api/v1/retail-leads/stores", {
        method: "POST", headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ user_id: memberId, store_name: storeName }),
      });
      const result = await response.json() as { error?: { message: string } };
      if (!response.ok) throw new Error(result.error?.message ?? "Could not assign the store.");
      setStoreMessage("Store assignment saved.");
      router.refresh();
    } catch (caught) {
      setStoreMessage(caught instanceof Error ? caught.message : "Could not assign the store.");
    } finally {
      setBusy(false);
    }
  }

  return (
    <div className="grid gap-6 lg:grid-cols-[minmax(0,2fr)_minmax(280px,1fr)]">
      <section className="rounded-xl border p-5">
        <h2 className="mb-2 text-lg font-semibold">Create an Event ID</h2>
        <p className="mb-5 text-sm text-muted-foreground">
          Assigned salesperson: you · Store: {ownStore ?? "not assigned"}. The first status is Created.
        </p>
        {!ownStore && <p role="alert" className="mb-4 rounded-lg border p-3 text-sm">
          Ask a manager to assign your store before saving a retail lead.
        </p>}
        <form onSubmit={createLead} className="grid gap-4 sm:grid-cols-2">
          <label className="space-y-1 text-sm">Sales funnel
            <select className="block h-10 w-full rounded-md border bg-background px-3" value={pipelineId}
              onChange={(event) => { const value = event.target.value; setPipelineId(value);
                setStageId(stages.find((stage) => stage.pipeline_id === value)?.id ?? ""); }}>
              {pipelines.map((pipeline) => <option key={pipeline.id} value={pipeline.id}>{pipeline.name}</option>)}
            </select>
          </label>
          <label className="space-y-1 text-sm">First stage
            <select className="block h-10 w-full rounded-md border bg-background px-3" value={stageId}
              onChange={(event) => setStageId(event.target.value)}>
              {availableStages.map((stage) => <option key={stage.id} value={stage.id}>{stage.name}</option>)}
            </select>
          </label>
          <label className="space-y-1 text-sm">Customer name *<Input name="customer_name" required minLength={2} maxLength={200} /></label>
          <label className="space-y-1 text-sm">Primary phone *<Input name="primary_phone" required placeholder="+971501234567" pattern="\+[0-9]{8,15}" /></label>
          <label className="space-y-1 text-sm">Secondary phone<Input name="secondary_phone" placeholder="+971501234567" pattern="\+[0-9]{8,15}" /></label>
          <label className="space-y-1 text-sm">Email<Input name="email" type="email" /></label>
          <label className="space-y-1 text-sm">Lead source *<Input name="source" required placeholder="Store visit, Meta ad…" /></label>
          <label className="space-y-1 text-sm">How did you know about us?<Input name="how_known" maxLength={500} /></label>
          <div className="space-y-2 text-sm sm:col-span-2">
            <Label htmlFor="retail-product">Looking products *</Label>
            <div className="flex gap-2"><Input id="retail-product" value={productInput}
              onChange={(event) => setProductInput(event.target.value)} maxLength={120}
              placeholder="Add a product" /><Button type="button" variant="outline" onClick={addProduct}>Add</Button></div>
            <div className="flex flex-wrap gap-2">{products.map((product) => (
              <button type="button" key={product} className="rounded-full border px-3 py-1"
                aria-label={`Remove ${product}`} onClick={() => setProducts((current) => current.filter((item) => item !== product))}>
                {product} ×</button>
            ))}</div>
          </div>
          <label className="space-y-1 text-sm">Budget ({currency}) *<Input name="budget" required inputMode="decimal" placeholder="2500.00" /></label>
          <label className="space-y-1 text-sm">Expected purchase date *<Input name="expected_purchase_date" required type="date" /></label>
          <label className="space-y-1 text-sm">Next follow-up *<Input name="next_followup_at" required type="datetime-local" /></label>
          <label className="space-y-1 text-sm">Address<Input name="address" maxLength={500} /></label>
          {error && <p role="alert" className="text-sm text-destructive sm:col-span-2">{error}</p>}
          {createdId && <p role="status" className="text-sm sm:col-span-2">Created Event ID: <span className="font-mono">{createdId}</span></p>}
          <div className="sm:col-span-2"><Button type="submit" disabled={busy || !ownStore || !stageId}>
            {busy ? "Saving…" : "Create lead"}</Button></div>
        </form>
      </section>
      <aside className="space-y-5">
        <section className="rounded-xl border p-5 text-sm">
          <h2 className="mb-2 text-lg font-semibold">Event ID rule</h2>
          <p>One phone can have one open Event ID in this organization. Converted and Lost Event IDs remain in history; a new one can then be created.</p>
        </section>
        {manager && <section className="rounded-xl border p-5">
          <h2 className="mb-2 text-lg font-semibold">Assign salesperson store</h2>
          <p className="mb-4 text-sm text-muted-foreground">The selected store is filled automatically at lead entry.</p>
          <form onSubmit={assignStore} className="space-y-3">
            <label className="block space-y-1 text-sm">Team member
              <select className="block h-10 w-full rounded-md border bg-background px-3" value={memberId}
                onChange={(event) => { const value = event.target.value; setMemberId(value);
                  setStoreName(assignments.find((item) => item.user_id === value)?.store_name ?? ""); }}>
                {members.map((member) => <option key={member.id} value={member.id}>{member.label}</option>)}
              </select>
            </label>
            <label className="block space-y-1 text-sm">Store name<Input value={storeName}
              onChange={(event) => setStoreName(event.target.value)} required maxLength={120} /></label>
            {storeMessage && <p role="status" className="text-sm">{storeMessage}</p>}
            <Button type="submit" disabled={busy || !memberId}>Save store</Button>
          </form>
        </section>}
      </aside>
    </div>
  );
}
