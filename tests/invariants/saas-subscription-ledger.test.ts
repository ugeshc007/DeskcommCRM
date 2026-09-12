import { describe, expect, it } from "vitest";

import { sql } from "./gov-helpers";

const adminA = "f2390000-0000-4000-8000-000000000001";
const viewerA = "f2390000-0000-4000-8000-000000000002";
const adminB = "f2390000-0000-4000-8000-000000000003";
const platformAdmin = "f2390000-0000-4000-8000-000000000004";
const orgA = "f2390000-0000-4000-8000-000000000010";
const orgB = "f2390000-0000-4000-8000-000000000020";

const seed = `begin;
insert into auth.users(id,email) values
  ('${adminA}','admin-a-0239@invariant.test'),
  ('${viewerA}','viewer-a-0239@invariant.test'),
  ('${adminB}','admin-b-0239@invariant.test'),
  ('${platformAdmin}','platform-0239@invariant.test');
insert into public.organizations(id,slug,display_name,legal_name) values
  ('${orgA}','saas-a-0239','SaaS A','SaaS A'),
  ('${orgB}','saas-b-0239','SaaS B','SaaS B');
insert into public.user_organizations(user_id,organization_id,role,accepted_at) values
  ('${adminA}','${orgA}','admin',now()),
  ('${viewerA}','${orgA}','viewer',now()),
  ('${adminB}','${orgB}','admin',now());
insert into public.platform_admins(user_id,granted_by,scope,mfa_required,reason)
  values ('${platformAdmin}','${platformAdmin}','full',false,'fixture SaaS 0239');
insert into public.organization_subscriptions
  (organization_id,plan_code,status,billing_provider,external_subscription_ref,limits) values
  ('${orgA}','pro','active','manual','sub-a-0239','{"members":5,"channels":2}'::jsonb),
  ('${orgB}','standard','past_due','manual','sub-b-0239','{}'::jsonb);
insert into public.organization_billing_events
  (organization_id,subscription_id,event_type,billing_provider,new_status) values
  ('${orgA}',(select id from public.organization_subscriptions where organization_id='${orgA}'),
   'subscription_created','manual','active'),
  ('${orgB}',(select id from public.organization_subscriptions where organization_id='${orgB}'),
   'subscription_created','manual','past_due');`;

function prove(body: string) {
  expect(sql(`${seed}\n${body}\nrollback; select 'proved';`)).toContain("proved");
}

describe("ledger SaaS — isolamento e ausência retrocompatível", () => {
  it("admin do tenant lê apenas sua assinatura e seus eventos", () =>
    prove(`
      set local role authenticated;
      select set_config('request.jwt.claims','{"sub":"${adminA}"}',true);
      do $$ begin
        if (select count(*) from public.organization_subscriptions) <> 1 then raise exception 'subscription leak'; end if;
        if (select count(*) from public.organization_billing_events) <> 1 then raise exception 'event leak'; end if;
      end $$;`));

  it("viewer não lê billing nem ganha escrita", () =>
    prove(`
      set local role authenticated;
      select set_config('request.jwt.claims','{"sub":"${viewerA}"}',true);
      do $$ begin
        if exists(select 1 from public.organization_subscriptions) then raise exception 'viewer read'; end if;
        if has_table_privilege('authenticated','public.organization_subscriptions','insert') then raise exception 'authenticated write grant'; end if;
      end $$;`));

  it("limites recusam chave desconhecida, negativo e fração", () =>
    prove(`
      do $$ begin
        begin update public.organization_subscriptions set limits='{"unknown":1}' where organization_id='${orgA}'; raise exception 'unknown accepted';
        exception when check_violation then null; end;
        begin update public.organization_subscriptions set limits='{"members":-1}' where organization_id='${orgA}'; raise exception 'negative accepted';
        exception when check_violation then null; end;
        begin update public.organization_subscriptions set limits='{"channels":1.5}' where organization_id='${orgA}'; raise exception 'fraction accepted';
        exception when check_violation then null; end;
      end $$;`));

  it("organização sem assinatura permanece estado válido e sem limite implícito", () =>
    prove(`
      insert into public.organizations(slug,display_name,legal_name) values ('selfhost-0239','Self host','Self host');
      do $$ begin
        if (select count(*) from public.organization_subscriptions s join public.organizations o on o.id=s.organization_id where o.slug='selfhost-0239') <> 0 then
          raise exception 'self-host recebeu assinatura implícita';
        end if;
      end $$;`));

  it("eventos são append-only para authenticated", () =>
    prove(`
      set local role authenticated;
      select set_config('request.jwt.claims','{"sub":"${adminA}"}',true);
      do $$ begin
        begin delete from public.organization_billing_events; raise exception 'delete accepted';
        exception when insufficient_privilege then null; end;
      end $$;`));

  it("RPC service-only atualiza assinatura e evento atomicamente com replay idempotente", () =>
    prove(`
      do $$ declare a jsonb; b jsonb; begin
        a := public.fn_set_organization_subscription('${platformAdmin}','${orgA}','f2390000-0000-4000-8000-000000000099','{"plan_code":"enterprise","status":"active","billing_provider":"manual","limits":{"members":9}}');
        b := public.fn_set_organization_subscription('${platformAdmin}','${orgA}','f2390000-0000-4000-8000-000000000099','{"plan_code":"enterprise","status":"active","billing_provider":"manual","limits":{"members":9}}');
        if (a->>'replayed')::boolean or not (b->>'replayed')::boolean then raise exception 'replay incorreto'; end if;
        if (select count(*) from public.organization_billing_events where idempotency_key='f2390000-0000-4000-8000-000000000099') <> 1 then raise exception 'evento duplicado'; end if;
      end $$;`));

  it("authenticated não executa o comando de billing", () =>
    prove(`
      set local role authenticated;
      select set_config('request.jwt.claims','{"sub":"${adminA}"}',true);
      do $$ begin
        begin perform public.fn_set_organization_subscription('${adminA}','${orgA}','f2390000-0000-4000-8000-000000000098','{"plan_code":"pro","status":"active"}'); raise exception 'authenticated executou';
        exception when insufficient_privilege then null; end;
      end $$;`));

  it("evento do provedor aplica, replay e evento antigo não regridem estado", () =>
    prove(`
      do $$ declare a jsonb; d jsonb; s jsonb; begin
        a := public.fn_apply_saas_provider_event('{"provider":"manual","external_event_ref":"evt-new","external_subscription_ref":"sub-a-0239","plan_code":"enterprise","status":"active","limits":{"members":12},"occurred_at":"2026-09-12T12:00:00Z"}');
        d := public.fn_apply_saas_provider_event('{"provider":"manual","external_event_ref":"evt-new","external_subscription_ref":"sub-a-0239","plan_code":"standard","status":"canceled","occurred_at":"2026-09-12T13:00:00Z"}');
        s := public.fn_apply_saas_provider_event('{"provider":"manual","external_event_ref":"evt-old","external_subscription_ref":"sub-a-0239","plan_code":"standard","status":"canceled","occurred_at":"2026-09-12T11:00:00Z"}');
        if a->>'outcome' <> 'applied' or d->>'outcome' <> 'duplicate' or s->>'outcome' <> 'stale' then raise exception 'outcomes incorretos'; end if;
        if (select plan_code||':'||status from public.organization_subscriptions where organization_id='${orgA}') <> 'enterprise:active' then raise exception 'estado regrediu'; end if;
      end $$;`));

  it("referência desconhecida vira recibo sem escolher tenant", () =>
    prove(`
      do $$ declare r jsonb; begin
        r := public.fn_apply_saas_provider_event('{"provider":"manual","external_event_ref":"evt-unknown","external_subscription_ref":"not-mapped","plan_code":"pro","status":"active","occurred_at":"2026-09-12T12:00:00Z"}');
        if r->>'outcome' <> 'unknown_subscription' then raise exception 'unknown não registrado'; end if;
        if (select organization_id from public.billing_webhook_receipts where external_event_ref='evt-unknown') is not null then raise exception 'tenant veio do evento'; end if;
      end $$;`));

  it("authenticated não executa ingestão nem lê recibos globais", () =>
    prove(`
      set local role authenticated;
      select set_config('request.jwt.claims','{"sub":"${adminA}"}',true);
      do $$ begin
        if exists(select 1 from public.billing_webhook_receipts) then raise exception 'recibo global vazou'; end if;
        begin perform public.fn_apply_saas_provider_event('{}'); raise exception 'authenticated executou ingestão';
        exception when insufficient_privilege then null; end;
      end $$;`));
});
