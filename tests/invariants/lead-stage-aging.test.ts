import { randomUUID } from "node:crypto";
import { afterAll, describe, expect, it } from "vitest";
import pg from "pg";

if (!process.env.TEST_DB_CONTAINER) throw new Error("Run through scripts/test-db.sh");
const pool = new pg.Pool({
  connectionString: `postgresql://postgres:postgres@127.0.0.1:${Number(process.env.TEST_DB_PORT ?? 54329)}/postgres`,
});
afterAll(() => pool.end());

async function fixture() {
  const org = randomUUID();
  const manager = randomUUID();
  await pool.query(
    "insert into organizations(id,slug,legal_name,display_name) values($1,$2::text,$2::text,$2::text)",
    [org, `aging-${org}`],
  );
  await pool.query("insert into auth.users(id,email) values($1,$2)", [manager, `${manager}@synthetic.test`]);
  await pool.query(
    "insert into user_organizations(user_id,organization_id,role,accepted_at) values($1,$2,'manager',now())",
    [manager, org],
  );
  const { rows } = await pool.query(
    "select s.id stage_id, p.id pipeline_id from crm_pipelines p join crm_stages s on s.pipeline_id=p.id and s.organization_id=p.organization_id where p.organization_id=$1 and not s.is_won and not s.is_lost order by s.position limit 1",
    [org],
  );
  expect(rows).toHaveLength(1);
  return { org, manager, ...rows[0] as { stage_id: string; pipeline_id: string } };
}

describe("lead stage aging report", () => {
  it("counts the current stage age and cannot read another organization through its RPC", async () => {
    const a = await fixture();
    const b = await fixture();
    for (const f of [a, b]) {
      await pool.query(
        "insert into crm_leads(organization_id,pipeline_id,stage_id,title,source,stage_changed_at) values($1,$2,$3,'Synthetic aging lead','manual',now()-interval '40 days')",
        [f.org, f.pipeline_id, f.stage_id],
      );
    }

    const client = await pool.connect();
    try {
      await client.query("begin");
      await client.query("set local role authenticated");
      await client.query("select set_config('request.jwt.claims',$1,true)", [JSON.stringify({ sub: a.manager })]);
      const own = await client.query("select fn_lead_stage_aging($1,30,100) result", [a.org]);
      const other = await client.query("select fn_lead_stage_aging($1,30,100) result", [b.org]);
      expect(own.rows[0].result.total).toBe(1);
      expect(own.rows[0].result.items).toHaveLength(1);
      expect(other.rows[0].result.total).toBe(0);
      await client.query("rollback");
    } finally {
      client.release();
    }
  });
});
