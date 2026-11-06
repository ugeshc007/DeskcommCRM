import { redirect } from 'next/navigation';
import { requireRole } from '@/lib/auth/require-role';
import { StoreWorkspace } from './workspace';
export const dynamic = 'force-dynamic';
export default async function StorePage() {
  const auth = await requireRole('admin'); if (!auth.ok) redirect('/app');
  return <StoreWorkspace key={auth.org.orgId} />;
}
