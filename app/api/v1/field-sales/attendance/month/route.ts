import { ok, fail } from '@/lib/api/wrappers';
import { requireRole } from '@/lib/auth/require-role';
import { getRequestPool } from '@/lib/agent-engine/db/request-pool';
import { fieldAudit, fieldTransaction } from '@/lib/field-sales/authority';
import { readAttendanceMonth, readAttendanceTeamMonth } from '@/lib/field-sales/attendance-calendar';
import { attendanceWorkbook, attendanceTeamWorkbook } from '@/lib/field-sales/attendance-workbook';
import { fieldError } from '../../_shared';

const headers = { 'Cache-Control': 'private, no-store' };

export async function GET(req: Request) {
  const auth = await requireRole('field_officer'); if (!auth.ok) return auth.response;
  if (auth.user.support) return fail('forbidden', 'Employee records are unavailable in support sessions.', 403, { headers });
  try {
    const query = new URL(req.url).searchParams;
    const format = query.get('format') ?? 'json';
    if (format !== 'json' && format !== 'xlsx') throw new Error('invalid_request');
    const allEmployees = query.get('scope') === 'all';
    if (query.has('scope') && !allEmployees) throw new Error('invalid_request');
    if (allEmployees && (format !== 'xlsx' || query.has('employee_id'))) throw new Error('invalid_request');
    const pool = getRequestPool();
    if (allEmployees) {
      const reports = await readAttendanceTeamMonth(pool, auth.org.orgId, auth.user.id, query.get('month') ?? '');
      if (!reports.length) throw new Error('field_employee_unavailable');
      const workbook = attendanceTeamWorkbook(reports);
      await fieldTransaction(pool, auth.org.orgId, auth.user.id, async (db, role) => {
        if (role !== 'manager' && role !== 'admin') throw new Error('field_forbidden');
        await fieldAudit(db, auth.org.orgId, auth.user.id, 'field_sales.monthly_team_attendance_exported',
          auth.user.id, { month: reports[0]!.month, employees: reports.length });
      });
      return new Response(Uint8Array.from(workbook), { headers: {
        ...headers,
        'Content-Type': 'application/vnd.openxmlformats-officedocument.spreadsheetml.sheet',
        'Content-Disposition': `attachment; filename="field-attendance-all-${reports[0]!.month}.xlsx"`,
        'X-Content-Type-Options': 'nosniff',
      } });
    }
    const report = await readAttendanceMonth(pool, auth.org.orgId, auth.user.id,
      query.get('month') ?? '', query.get('employee_id') ?? '');
    if (format === 'json') return ok(report, { headers });
    const workbook = attendanceWorkbook(report);
    await fieldTransaction(pool, auth.org.orgId, auth.user.id, async db => {
      await fieldAudit(db, auth.org.orgId, auth.user.id, 'field_sales.monthly_attendance_exported',
        report.employee.id, { month: report.month });
    });
    return new Response(Uint8Array.from(workbook), { headers: {
      ...headers,
      'Content-Type': 'application/vnd.openxmlformats-officedocument.spreadsheetml.sheet',
      'Content-Disposition': `attachment; filename="field-attendance-${report.month}.xlsx"`,
      'X-Content-Type-Options': 'nosniff',
    } });
  } catch (error) { return fieldError(error); }
}
