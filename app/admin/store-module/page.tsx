import { redirect } from 'next/navigation';
import { requirePlatformAdmin } from '@/lib/auth/requirePlatformAdmin';
import { StoreModuleInstaller } from './installer';
import Link from 'next/link';
export default async function StoreModulePage() {
  const auth = await requirePlatformAdmin();
  if (auth.platformAdmin.scope !== 'full') redirect('/admin/forbidden');
  return <><div className="p-4"><Link className="underline" href="/admin/dashboard">Back to administration</Link></div><StoreModuleInstaller /></>;
}
