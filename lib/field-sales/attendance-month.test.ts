import { describe, expect, it, vi } from 'vitest';
import { strFromU8, unzipSync } from 'fflate';
import { readAttendanceMonth } from './attendance-calendar';
import { attendanceWorkbook } from './attendance-workbook';

const org = '11111111-1111-4111-8111-111111111111';
const officer = '22222222-2222-4222-8222-222222222222';
const manager = '33333333-3333-4333-8333-333333333333';

function fakePool(role: 'manager' | 'field_officer', name = 'Officer') {
  const query = vi.fn(async (sql: string, params: unknown[] = []) => {
    if (sql.includes('from public.user_organizations')) return { rows: [{ role }], rowCount: 1 };
    if (sql.includes('from public.field_sales_employees')) return { rows: [{ user_id: officer, display_name: name, active: true }] };
    if (sql.includes('from public.organizations')) return { rows: [{ timezone: 'Asia/Dubai', onboarding_state: { welcome: { country_code: 'AE' } } }] };
    if (sql.includes('from public.field_sales_sessions')) return { rows: [{ id: 'shift', employee_id: officer,
      punched_in_at: '2026-09-24T18:00:00Z', punched_out_at: '2026-09-24T22:00:00Z', corrected_in: null, corrected_out: null }] };
    if (sql.includes('from public.field_sales_attendance_events')) return { rows: [] };
    if (sql.includes('from public.field_sales_leave_days')) return { rows: [] };
    if (sql === 'begin' || sql === 'commit' || sql === 'rollback' || sql.startsWith('set local')) return { rows: [] };
    throw new Error(`Unexpected query: ${sql} ${params.length}`);
  });
  return { pool: { connect: async () => ({ query, release: vi.fn() }) }, query };
}

describe('employee monthly attendance', () => {
  it('includes each local day, splitting an overnight session, and produces a safe Excel workbook', async () => {
    const { pool, query } = fakePool('manager', '=Officer <East>');
    const month = await readAttendanceMonth(pool as never, org, manager, '2026-09', officer);
    expect(month.rows).toHaveLength(30);
    expect(month.rows[0]?.date).toBe('2026-09-01');
    expect(month.rows[29]?.date).toBe('2026-09-30');
    expect(month.rows.find(day => day.date === '2026-09-24')).toMatchObject({ status: 'present', working_minutes: 120 });
    expect(month.rows.find(day => day.date === '2026-09-25')).toMatchObject({ status: 'present', working_minutes: 120 });
    const sessionsQuery = query.mock.calls.find(([sql]) => sql.includes('from public.field_sales_sessions'))!;
    expect(sessionsQuery[1]).toEqual([org, officer, '2026-08-31T20:00:00.000Z', '2026-09-30T20:00:00.000Z']);
    const archive = unzipSync(attendanceWorkbook(month));
    const sheet = strFromU8(archive['xl/worksheets/sheet1.xml']!);
    expect(sheet.match(/<row r="\d+">/g)).toHaveLength(35);
    expect(sheet).toContain('=Officer &lt;East&gt;');
    expect(sheet).toContain('2026-09-24 22:00');
    expect(sheet).toContain('2026-09-25 02:00');
    expect(sheet).not.toContain('<f>');
    expect(archive['xl/workbook.xml']).toBeDefined();
  });

  it('does not allow a field officer to export another employee', async () => {
    const { pool, query } = fakePool('field_officer');
    await expect(readAttendanceMonth(pool as never, org, manager, '2026-09', officer)).rejects.toThrow('field_forbidden');
    expect(query.mock.calls.some(([sql]) => sql.includes('from public.field_sales_employees'))).toBe(false);
  });

  it('allows a field officer to see only their own month', async () => {
    const { pool, query } = fakePool('field_officer');
    const month = await readAttendanceMonth(pool as never, org, officer, '2026-09', officer);
    expect(month.employee.id).toBe(officer);
    const employeeQuery = query.mock.calls.find(([sql]) => sql.includes('from public.field_sales_employees'))!;
    expect(employeeQuery[1]).toEqual([org, officer]);
  });

  it('rejects invalid month and employee identifiers before querying', async () => {
    const { pool, query } = fakePool('manager');
    await expect(readAttendanceMonth(pool as never, org, manager, '2026-13', officer)).rejects.toThrow();
    await expect(readAttendanceMonth(pool as never, org, manager, '2026-09', 'not-an-id')).rejects.toThrow();
    expect(query).not.toHaveBeenCalled();
  });
});
