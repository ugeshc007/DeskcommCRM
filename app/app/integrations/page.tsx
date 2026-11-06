import { redirect } from 'next/navigation';
import { requireRole } from '@/lib/auth/require-role';
import { IntegrationsGallery } from './_components/IntegrationsGallery';
export const dynamic='force-dynamic';
export default async function IntegrationsPage(){
 const auth=await requireRole('manager');if(!auth.ok)redirect('/app');
 return <IntegrationsGallery key={auth.org.orgId} />;
}
