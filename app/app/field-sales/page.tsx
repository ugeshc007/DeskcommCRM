import { redirect } from 'next/navigation';
import { requireRole } from '@/lib/auth/require-role';
import { FieldSalesWorkspace } from './workspace';
export const dynamic = 'force-dynamic';
export default async function FieldSalesPage() {
  const auth = await requireRole('field_officer');
  if (!auth.ok || auth.user.support) redirect('/app');
  return <FieldSalesWorkspace key={`${auth.org.orgId}:${auth.user.id}`} organizationId={auth.org.orgId} userId={auth.user.id} />;
}
