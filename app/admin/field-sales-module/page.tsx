import { redirect } from 'next/navigation';
import { requirePlatformAdmin } from '@/lib/auth/requirePlatformAdmin';
import { FieldSalesInstaller } from './installer';
export default async function FieldSalesModulePage() {
  const auth = await requirePlatformAdmin();
  if (auth.platformAdmin.scope !== 'full') redirect('/admin/forbidden');
  return <FieldSalesInstaller />;
}
