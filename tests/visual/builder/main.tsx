import React from "react";
import { createRoot } from "react-dom/client";
import { QueryClient, QueryClientProvider } from "@tanstack/react-query";
import { Toaster } from "sonner";
import { FlowCanvas } from "@/app/app/ai/followups/[id]/_components/FlowCanvas";
import { createFlowStarter } from "@/lib/followup/builder-library";
import { IdiomaProvider } from "@/lib/i18n/IdiomaProvider";
import { validateFlowForPublish } from "@/lib/followup/validate-publish";
import { IntegrationsGallery } from '@/app/app/integrations/_components/IntegrationsGallery';
import { StoreTemplateInstaller } from '@/app/app/ai/followups/_components/StoreTemplateInstaller';
import "@/app/globals.css";

// Isolated component fixture. These synthetic requests never leave this browser.
// This proves rendering/interactions, NOT authentication or provider delivery.
const flow = {
  id: "22222222-2222-4222-8222-222222222222", name: "E-commerce demo (local fixture)", status: "draft" as const,
  active_version_id: null, draft_graph: createFlowStarter("welcome"), handoff_policy: "pause" as const,
  trigger_config: { kind: "manual" }, created_at: new Date().toISOString(), updated_at: new Date().toISOString(),
  versions_count: 0, previous_version_id: null,
};
const nativeFetch = window.fetch.bind(window);
window.fetch = async (input, options) => {
  const url = String(input);
  if (!url.startsWith("/api/")) return nativeFetch(input, options);
  if (url === '/api/v1/ecommerce-template') return Response.json(options?.method === 'POST'
    ? { data: { receipt: { agent_id: flow.id, flow_id: flow.id, pipeline_id: flow.id } } }
    : { data: { locale: { country_code: 'AE', currency: 'AED', timezone: 'Asia/Dubai' }, channels: [{ id: flow.id, display_name: 'Synthetic store channel' }], credentials: [] } });
  if (url==='/api/v1/integration-connections') return Response.json({data:{connections:[{id:'33333333-3333-4333-8333-333333333333',provider:'webhook',label:'Synthetic inventory endpoint',revision:1,active:true,auth_kind:'api_key',validated_at:null,failure_code:null}],runs:[],can_manage:true,google_oauth_configured:false}});
  if (url.endsWith("/publish")) {
    const validation = validateFlowForPublish(flow.draft_graph);
    return Response.json(validation.ok ? { data: flow } : { error: { code: "validation_failed", message: "Review draft", details: { errors: validation.errors } } }, { status: validation.ok ? 200 : 422 });
  }
  if (url.includes(`/followup-flows/${flow.id}`)) {
    if (options?.method === "PATCH") Object.assign(flow, JSON.parse(String(options.body)));
    return Response.json({ data: flow });
  }
  return Response.json({ data: [] });
};
const client = new QueryClient({ defaultOptions: { queries: { retry: false, staleTime: Infinity } } });
createRoot(document.getElementById("root")!).render(<React.StrictMode><IdiomaProvider locale="en"><QueryClientProvider client={client}>
  <div style={{ padding: "10px 16px", background: "#eef2ff", color: "#24335a", font: "13px system-ui" }}>LOCAL TEST FIXTURE — synthetic data only. No customer messages, credentials or live changes.</div>
  {window.location.pathname==='/store'?<div className="p-6"><StoreTemplateInstaller /></div>:window.location.pathname==='/integrations'?<IntegrationsGallery/>:<FlowCanvas flowId={flow.id} initialData={flow} />}<Toaster />
</QueryClientProvider></IdiomaProvider></React.StrictMode>);
