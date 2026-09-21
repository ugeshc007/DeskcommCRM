import { redirect } from 'next/navigation';
import { requireRole } from '@/lib/auth/require-role';
import { FieldLiveView } from './view';

export const dynamic = 'force-dynamic';

export default async function FieldSalesLivePage() {
  const auth = await requireRole('admin');
  if (!auth.ok || auth.user.support) redirect('/app/field-sales');
  return <FieldLiveView organizationId={auth.org.orgId} userId={auth.user.id}/>;
}
