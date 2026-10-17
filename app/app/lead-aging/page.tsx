import Link from "next/link";
import { redirect } from "next/navigation";

import { requireAuth, resolveActiveOrg } from "@/lib/auth/server";
import { ROLE_RANK } from "@/lib/auth/types";
import { traduzir } from "@/lib/i18n/dicionario";
import { createClient } from "@/lib/supabase/server";

export const dynamic = "force-dynamic";

interface AgingItem {
  id: string;
  title: string;
  pipeline_id: string;
  stage_name: string;
  stage_since: string;
}

interface AgingResult {
  total: number;
  items: AgingItem[];
}

export default async function LeadAgingPage({
  searchParams,
}: {
  searchParams: Promise<{ days?: string }>;
}) {
  const user = await requireAuth();
  const activeOrg = await resolveActiveOrg(user);
  if (!activeOrg) redirect("/app");
  if (ROLE_RANK[activeOrg.role] < ROLE_RANK.manager) redirect("/app");

  const rawDays = (await searchParams).days;
  const parsedDays = Number(rawDays ?? 30);
  const days = Number.isInteger(parsedDays) && parsedDays >= 1 && parsedDays <= 365
    ? parsedDays : 30;
  const supabase = await createClient();
  const { data, error } = await supabase.rpc("fn_lead_stage_aging" as never, {
    p_org: activeOrg.orgId,
    p_min_days: days,
    p_limit: 100,
  } as never);
  const result = data as AgingResult | null;
  const t = (texto: string) => traduzir(texto, user.idioma);

  return (
    <div className="flex h-full flex-col gap-6 p-6">
      <header>
        <h1 className="text-2xl font-semibold tracking-tight">{t("Envelhecimento de leads")}</h1>
        <p className="text-sm text-muted-foreground">
          {t("Leads abertos que permanecem na etapa atual além do prazo escolhido.")}
        </p>
      </header>
      <form method="get" className="flex items-end gap-3">
        <label className="flex flex-col gap-1 text-sm" htmlFor="days">
          {t("Dias na etapa")}
          <input id="days" name="days" type="number" min="1" max="365" defaultValue={days}
            className="h-9 w-28 rounded-md border border-input bg-background px-3" />
        </label>
        <button type="submit" className="h-9 rounded-md bg-primary px-4 text-primary-foreground">
          {t("Mostrar leads")}
        </button>
      </form>
      {error ? (
        <p role="alert">{t("Não foi possível carregar o relatório de envelhecimento.")}</p>
      ) : (
        <>
          <p className="text-sm text-muted-foreground" data-testid="lead-aging-summary">
            {result?.total ?? 0} {t("leads abertos acima de")} {days} {t("dias. Mostrando os 100 mais antigos.")}
          </p>
          <div className="overflow-x-auto rounded-lg border">
            <table className="w-full text-left text-sm">
              <thead className="bg-muted/40">
                <tr><th className="p-3">Lead</th><th className="p-3">{t("Etapa")}</th>
                  <th className="p-3">{t("Na etapa desde")}</th></tr>
              </thead>
              <tbody>
                {(result?.items ?? []).map((lead) => (
                  <tr key={lead.id} className="border-t">
                    <td className="p-3">
                      <Link className="underline" href={`/app/pipelines/${lead.pipeline_id}`}>
                        {lead.title}
                      </Link>
                    </td>
                    <td className="p-3">{lead.stage_name}</td>
                    <td className="p-3">
                      {new Date(lead.stage_since).toLocaleDateString(user.idioma)}
                    </td>
                  </tr>
                ))}
              </tbody>
            </table>
            {result?.items.length === 0 && (
              <p className="p-4 text-sm text-muted-foreground">{t("Nenhum lead ultrapassa este prazo.")}</p>
            )}
          </div>
        </>
      )}
    </div>
  );
}
