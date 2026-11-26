import { randomUUID } from "node:crypto";
import { afterAll, describe, expect, it } from "vitest";
import pg from "pg";

if (!process.env.TEST_DB_CONTAINER) throw new Error("Run through scripts/test-db.sh");
const pool = new pg.Pool({
  connectionString: `postgresql://postgres:postgres@127.0.0.1:${Number(process.env.TEST_DB_PORT ?? 54329)}/postgres`,
});
afterAll(() => pool.end());

async function fixture() {
  const org = randomUUID(), manager = randomUUID(), seller = randomUUID();
  await pool.query(
    "insert into organizations(id,slug,legal_name,display_name) values($1,$2::text,$2::text,$2::text)",
    [org, `retail-${org}`],
  );
  for (const [user, role] of [[manager, "manager"], [seller, "agent"]]) {
    await pool.query("insert into auth.users(id,email) values($1,$2)", [user, `${user}@synthetic.test`]);
    await pool.query(
      "insert into user_organizations(user_id,organization_id,role,accepted_at) values($1,$2,$3,now())",
      [user, org, role],
    );
  }
  const { rows } = await pool.query(
    `select s.id stage_id,p.id pipeline_id from crm_pipelines p
     join crm_stages s on s.pipeline_id=p.id and s.organization_id=p.organization_id
     where p.organization_id=$1 and not s.is_won and not s.is_lost
     order by s.position limit 1`, [org],
  );
  expect(rows).toHaveLength(1);
  return { org, manager, seller, ...rows[0] as { stage_id: string; pipeline_id: string } };
}

async function asUser<T>(user: string, action: (client: pg.PoolClient) => Promise<T>): Promise<T> {
  const client = await pool.connect();
  try {
    await client.query("begin");
    await client.query("set local role authenticated");
    await client.query("select set_config('request.jwt.claims',$1,true)", [JSON.stringify({ sub: user })]);
    const result = await action(client);
    await client.query("commit");
    return result;
  } catch (error) {
    await client.query("rollback");
    throw error;
  } finally {
    client.release();
  }
}

function createArgs(f: Awaited<ReturnType<typeof fixture>>, phone: string) {
  return [f.org, f.pipeline_id, f.stage_id, "Synthetic Customer", phone, null,
    "synthetic@example.test", "Store visit", "Walk-in", ["Product A"], 50_000,
    "2026-12-01", "Synthetic address", new Date(Date.now() + 86_400_000).toISOString()];
}

const createSql = `select public.fn_create_retail_lead(
  $1::uuid,$2::uuid,$3::uuid,$4::text,$5::text,$6::text,$7::text,
  $8::text,$9::text,$10::text[],$11::bigint,$12::date,$13::text,$14::timestamptz) id`;

describe("retail lead Event IDs", () => {
  it("binds the current salesperson's store, requires a follow-up, and permits a repeat only after closure", async () => {
    const a = await fixture(), b = await fixture();
    await expect(asUser(a.seller, client => client.query(
      "select public.fn_assign_retail_store($1,$2,$3)", [a.org, a.seller, "Store A"],
    ))).rejects.toThrow(/retail_store_forbidden/);
    await asUser(a.manager, client => client.query(
      "select public.fn_assign_retail_store($1,$2,$3)", [a.org, a.seller, "Store A"],
    ));
    const ownStore = await asUser(a.seller, client => client.query(
      "select public.fn_my_retail_store($1) store_name", [a.org],
    ));
    expect(ownStore.rows[0].store_name).toBe("Store A");
    await asUser(b.manager, client => client.query(
      "select public.fn_assign_retail_store($1,$2,$3)", [b.org, b.seller, "Store B"],
    ));
    const foreignAssignments = await asUser(b.manager, client => client.query(
      "select user_id from crm_retail_store_assignments where organization_id=$1", [a.org],
    ));
    expect(foreignAssignments.rows).toEqual([]);

    const phone = "+971500000001";
    const args = createArgs(a, phone);
    const first = await asUser(a.seller, client => client.query(createSql, args));
    const eventId = first.rows[0].id as string;
    expect(eventId).toMatch(/^[0-9a-f-]{36}$/);
    const saved = await pool.query(`select l.id,l.owner_user_id,l.value_cents,r.store_name,
      r.primary_phone,r.next_followup_at from crm_leads l
      join crm_retail_leads r on r.lead_id=l.id where l.id=$1 and l.organization_id=$2`,
      [eventId, a.org]);
    expect(saved.rows[0]).toMatchObject({ id: eventId, owner_user_id: a.seller,
      value_cents: "50000", store_name: "Store A", primary_phone: phone });
    expect(saved.rows[0].next_followup_at).toBeTruthy();

    await expect(asUser(a.seller, client => client.query(createSql, args)))
      .rejects.toThrow(/retail_event_open/);
    expect((await pool.query("select count(*)::int n from contacts where organization_id=$1", [a.org])).rows[0].n).toBe(1);
    const withoutFollowup = [...createArgs(a, "+971500000002")];
    withoutFollowup[13] = null;
    await expect(asUser(a.seller, client => client.query(createSql, withoutFollowup)))
      .rejects.toThrow(/retail_lead_invalid/);
    await expect(asUser(a.seller, client => client.query(
      "update crm_retail_leads set active=false where lead_id=$1", [eventId],
    ))).rejects.toThrow(/permission denied/);

    const other = await asUser(b.seller, client => client.query(createSql, createArgs(b, phone)));
    expect(other.rows[0].id).not.toBe(eventId);
    const hidden = await asUser(b.seller, client => client.query(
      "select lead_id from crm_retail_leads where lead_id=$1", [eventId],
    ));
    expect(hidden.rows).toEqual([]);

    await pool.query("update crm_leads set status='won',closed_at=now() where id=$1 and organization_id=$2", [eventId, a.org]);
    expect((await pool.query("select active from crm_retail_leads where lead_id=$1", [eventId])).rows[0].active).toBe(false);
    const repeat = await asUser(a.seller, client => client.query(createSql, args));
    expect(repeat.rows[0].id).not.toBe(eventId);
  });

  it("records completed follow-ups and flags the manager after one Dubai working day", async () => {
    const f = await fixture(), other = await fixture();
    await asUser(f.manager, client => client.query(
      "select public.fn_assign_retail_store($1,$2,$3)", [f.org, f.seller, "Store C"],
    ));
    const created = await asUser(f.seller, client => client.query(createSql, createArgs(f, "+971500000003")));
    const leadId = created.rows[0].id as string;
    const friday = new Date("2026-09-25T11:00:00Z"); // Friday 15:00 Asia/Dubai
    const escalation = await pool.query(
      "select public.fn_next_retail_workday_at($1,'Asia/Dubai') utc_at",
      [friday],
    );
    expect(escalation.rows[0].utc_at.toISOString()).toBe("2026-09-28T11:00:00.000Z");

    const oldDue = new Date(Date.now() - 7 * 86_400_000);
    await pool.query("update crm_retail_leads set next_followup_at=$2 where lead_id=$1", [leadId, oldDue]);
    const overdue = await asUser(f.manager, client => client.query(
      "select public.fn_retail_overdue_followups($1,100) items", [f.org],
    ));
    expect(overdue.rows[0].items).toMatchObject([{ lead_id: leadId, escalated: true }]);
    const notManager = await asUser(f.seller, client => client.query(
      "select public.fn_retail_overdue_followups($1,100) items", [f.org],
    ));
    expect(notManager.rows[0].items).toEqual([]);

    const nextDue = new Date(Date.now() + 2 * 86_400_000);
    const completeSql = `select public.fn_complete_retail_followup(
      $1::uuid,$2::uuid,$3::timestamptz,$4::uuid,$5::timestamptz,$6::text,$7::text) result`;
    const input = [f.org, leadId, oldDue, f.stage_id, nextDue, "Customer requested another call", null];
    const done = await asUser(f.seller, client => client.query(completeSql, input));
    expect(done.rows[0].result).toMatchObject({ lead_id: leadId });
    await expect(asUser(f.seller, client => client.query(completeSql, input)))
      .rejects.toThrow(/retail_followup_changed/);
    expect((await pool.query("select count(*)::int n from crm_retail_followup_actions where lead_id=$1", [leadId])).rows[0].n).toBe(1);
    const foreignHistory = await asUser(other.manager, client => client.query(
      "select id from crm_retail_followup_actions where lead_id=$1", [leadId],
    ));
    expect(foreignHistory.rows).toEqual([]);
    expect((await pool.query("select type from crm_lead_activities where lead_id=$1 and type='retail_followup_done'", [leadId])).rows).toHaveLength(1);
    const cleared = await asUser(f.manager, client => client.query(
      "select public.fn_retail_overdue_followups($1,100) items", [f.org],
    ));
    expect(cleared.rows[0].items).toEqual([]);
  });

  it("moves the same Event ID, contact and notes only when a manager belongs to both organizations", async () => {
    const source = await fixture(), destination = await fixture();
    await pool.query("insert into user_organizations(user_id,organization_id,role,accepted_at) values($1,$2,'manager',now())",
      [source.manager, destination.org]);
    await asUser(source.manager, client => client.query(
      "select public.fn_assign_retail_store($1,$2,$3)", [source.org, source.seller, "Source store"],
    ));
    await asUser(destination.manager, client => client.query(
      "select public.fn_assign_retail_store($1,$2,$3)", [destination.org, destination.seller, "Destination store"],
    ));
    const created = await asUser(source.seller, client => client.query(createSql,
      createArgs(source, "+971500000004")));
    const eventId = created.rows[0].id as string;
    const originalContact = (await pool.query("select contact_id from crm_leads where id=$1", [eventId])).rows[0].contact_id;
    await pool.query(`insert into crm_lead_activities(organization_id,lead_id,contact_id,
      source_module,source_id,type,payload,performed_by_user_id)
      values($1,$2,$3,'crm',$2,'note','{"text":"Synthetic note"}'::jsonb,$4)`,
    [source.org,eventId,originalContact,source.seller]);
    const due = (await pool.query("select next_followup_at from crm_retail_leads where lead_id=$1",[eventId]))
      .rows[0].next_followup_at;
    await asUser(source.seller, client => client.query(`select public.fn_complete_retail_followup(
      $1::uuid,$2::uuid,$3::timestamptz,$4::uuid,$5::timestamptz,$6::text,$7::text)`,
    [source.org,eventId,due,source.stage_id,new Date(Date.now()+2*86_400_000),"Synthetic follow-up",null]));
    const transferSql = `select public.fn_transfer_retail_lead(
      $1::uuid,$2::uuid,$3::uuid,$4::uuid,$5::uuid,$6::uuid) id`;
    const args = [source.org,destination.org,eventId,destination.pipeline_id,
      destination.stage_id,destination.seller];
    await expect(asUser(source.seller, client => client.query(transferSql,args)))
      .rejects.toThrow(/retail_transfer_forbidden/);
    const linkId = randomUUID();
    await pool.query(`insert into crm_lead_links(id,organization_id,lead_id,target_kind,target_id,link_kind)
      values($1,$2,$3,'external',$4,'related')`,[linkId,source.org,eventId,randomUUID()]);
    await expect(asUser(source.manager, client => client.query(transferSql,args)))
      .rejects.toThrow(/retail_transfer_linked_records/);
    expect((await pool.query("select organization_id from crm_leads where id=$1",[eventId])).rows[0].organization_id)
      .toBe(source.org);
    await pool.query("delete from crm_lead_links where id=$1",[linkId]);
    const externalActivityId = randomUUID();
    await pool.query(`insert into crm_lead_activities(id,organization_id,lead_id,contact_id,
      source_module,source_id,type,payload,performed_by_user_id)
      values($1,$2,$3,$4,'agenda',$5,'note','{}'::jsonb,$6)`,
    [externalActivityId,source.org,eventId,originalContact,randomUUID(),source.seller]);
    await expect(asUser(source.manager, client => client.query(transferSql,args)))
      .rejects.toThrow(/retail_transfer_linked_records/);
    await pool.query("delete from crm_lead_activities where id=$1",[externalActivityId]);
    const transferred = await asUser(source.manager, client => client.query(transferSql,args));
    expect(transferred.rows[0].id).toBe(eventId);
    expect((await pool.query("select id from crm_leads where id=$1 and organization_id=$2",
      [eventId,source.org])).rows).toEqual([]);
    const saved = await pool.query(`select l.id,l.contact_id,l.owner_user_id,r.store_name
      from crm_leads l join crm_retail_leads r on r.lead_id=l.id and r.organization_id=l.organization_id
      where l.id=$1 and l.organization_id=$2`,[eventId,destination.org]);
    expect(saved.rows[0]).toMatchObject({ id:eventId,contact_id:originalContact,
      owner_user_id:destination.seller,store_name:"Destination store" });
    expect((await pool.query("select organization_id from contacts where id=$1",[originalContact])).rows[0].organization_id)
      .toBe(destination.org);
    expect((await pool.query("select organization_id from crm_lead_activities where lead_id=$1 and type='note'",
      [eventId])).rows).toEqual([{organization_id:destination.org}]);
    expect((await pool.query("select organization_id from crm_retail_followup_actions where lead_id=$1",
      [eventId])).rows).toEqual([{organization_id:destination.org}]);
    const sourceView = await asUser(source.seller, client => client.query(
      "select lead_id from crm_retail_leads where lead_id=$1",[eventId]));
    expect(sourceView.rows).toEqual([]);
    const receipts = await pool.query(`select organization_id,action from api_audit_log
      where resource_id=$1 and action like 'retail_lead.transferred_%' order by action`,[eventId]);
    expect(receipts.rows).toEqual([
      {organization_id:destination.org,action:"retail_lead.transferred_in"},
      {organization_id:source.org,action:"retail_lead.transferred_out"},
    ]);
  });
});
