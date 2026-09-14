import { notFound, redirect } from "next/navigation";
import { requireAuth, resolveActiveOrg } from "@/lib/auth/server";
import { createClient } from "@/lib/supabase/server";
import { PipelinePageClient } from "./_client";
import { moedaServidaOu } from "@/lib/money";

export const dynamic = "force-dynamic";

export default async function PipelinePage({
  params,
}: {
  params: Promise<{ id: string }>;
}) {
  const user = await requireAuth();
  const activeOrg = await resolveActiveOrg(user);
  if (!activeOrg) redirect("/app");

  const { id } = await params;
  const supabase = await createClient();
  // Mesma razão da Agenda: a RLS é piso, não escopo. Sem este filtro o funil de
  // OUTRA organização do mesmo usuário abre, e o quadro monta com as etapas de
  // um lugar e o cabeçalho de outro.
  const [{ data: pipeline }, { data: organization }] = await Promise.all([
    supabase
      .from("crm_pipelines")
      .select("id, name, vocabulary")
      .eq("organization_id", activeOrg.orgId)
      .eq("id", id)
      .maybeSingle(),
    supabase.from("organizations").select("currency").eq("id", activeOrg.orgId).maybeSingle(),
  ]);
  if (!pipeline) notFound();
  return (
    <PipelinePageClient
      pipelineId={id}
      initialName={pipeline.name}
      defaultCurrency={moedaServidaOu(organization?.currency)}
    />
  );
}
