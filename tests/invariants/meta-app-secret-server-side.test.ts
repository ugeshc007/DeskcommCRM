import { afterAll, beforeAll, describe, expect, it } from "vitest";

import { motivoDoErro, sql } from "./psql-transporte";

const TABLE = "platform_meta_webhook";

function privileges(role: string): string {
  return sql(`
    select coalesce(string_agg(distinct privilege_type, ',' order by privilege_type), 'NONE')
      from information_schema.role_table_grants
     where table_schema='public' and table_name='${TABLE}' and grantee='${role}';
  `).trim();
}

beforeAll(() => {
  sql(`delete from public.${TABLE};`);
  sql(`
    insert into private.app_secrets(name,value)
    values ('nuvemshop_oauth_key','test-master-key-0243-at-least-thirty-two-characters')
    on conflict(name) do nothing;
  `);
});

afterAll(() => sql(`delete from public.${TABLE};`));

describe("Meta App Secret da instalação", () => {
  it("não é servido aos papéis do browser", () => {
    expect(privileges("anon")).toBe("NONE");
    expect(privileges("authenticated")).toBe("NONE");
    expect(privileges("service_role")).toContain("SELECT");
  });

  it.each(["anon", "authenticated"])("%s recebe permission denied ao tentar ler", (role) => {
    let error: string | null = null;
    try {
      sql(`set role ${role}; select count(*) from public.${TABLE};`);
    } catch (caught) {
      error = motivoDoErro(caught);
    }
    expect(error).toMatch(/permission denied/i);
  });

  it("tem RLS ligada e nenhuma policy", () => {
    expect(sql(`select relrowsecurity from pg_class where oid='public.${TABLE}'::regclass;`).trim()).toBe("t");
    expect(sql(`select count(*) from pg_policies where schemaname='public' and tablename='${TABLE}';`).trim()).toBe("0");
  });

  it("guarda somente cifra reversível pela função server-side", () => {
    const secret = "meta-secret-for-invariant-0243";
    sql(`insert into public.${TABLE}(id,app_secret_encrypted) values(1,public.fn_encrypt_oauth('${secret}'));`);
    const raw = sql(`select encode(app_secret_encrypted,'escape') from public.${TABLE} where id=1;`);
    expect(raw).not.toContain(secret);
    expect(sql(`select public.fn_decrypt_oauth(app_secret_encrypted) from public.${TABLE} where id=1;`).trim()).toBe(secret);
  });

  it("recusa uma segunda linha", () => {
    let error: string | null = null;
    try {
      sql(`insert into public.${TABLE}(id,app_secret_encrypted) values(2,public.fn_encrypt_oauth('second-secret-0243'));`);
    } catch (caught) {
      error = motivoDoErro(caught);
    }
    expect(error).not.toBeNull();
  });
});
