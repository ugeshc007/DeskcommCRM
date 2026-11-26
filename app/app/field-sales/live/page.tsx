import { redirect } from 'next/navigation';
import { requireRole } from '@/lib/auth/require-role';
import { FieldLiveView } from './view';

export const dynamic = 'force-dynamic';

export default async function FieldSalesLivePage({ searchParams }: { searchParams: Promise<{ employee_id?: string; date?: string }> }) {
  const auth = await requireRole('manager');
  if (!auth.ok || auth.user.support) redirect('/app/field-sales');
  const params = await searchParams;
  const employeeId = /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i.test(params.employee_id ?? '') ? params.employee_id : undefined;
  const date = /^\d{4}-\d{2}-\d{2}$/.test(params.date ?? '') ? params.date : undefined;
  return <FieldLiveView organizationId={auth.org.orgId} userId={auth.user.id} initialEmployeeId={employeeId} initialDate={date}/>;
}
