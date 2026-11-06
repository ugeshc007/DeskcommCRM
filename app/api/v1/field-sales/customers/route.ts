import { z } from 'zod';
import { requireRole } from '@/lib/auth/require-role';
import { requireSupportWrite } from '@/lib/impersonate/support';
import { ok, fail } from '@/lib/api/wrappers';
import { getRequestPool } from '@/lib/agent-engine/db/request-pool';
import { manageProjectCustomers, readProjectCustomers, removeProjectCustomer, voidCustomerCollection } from '@/lib/field-sales/collections';
import { decodificarCsv, parseCsv } from '@/lib/contacts/csv';
import { readIntegrationJson } from '../../integration-connections/_shared';
import { fieldError } from '../_shared';

export const dynamic = 'force-dynamic';
const headers = { 'Cache-Control': 'private, no-store' };

export async function GET(req: Request) {
  const auth = await requireRole('manager'); if (!auth.ok) return auth.response;
  if (auth.user.support) return fail('forbidden', 'Use your own organization account.', 403);
  try {
    const projectId = z.uuid().parse(new URL(req.url).searchParams.get('project_id'));
    return ok(await readProjectCustomers(getRequestPool(), auth.org.orgId, auth.user.id, projectId), { headers });
  } catch (error) { return fieldError(error); }
}

function parseDue(value: string): number | null {
  const clean = value.trim();
  if (!clean) return null;
  if (!/^-?\d{1,10}(?:\.\d{1,2})?$/.test(clean)) throw new Error('field_invalid_due_amount');
  const [whole, fraction = ''] = clean.split('.');
  const sign = whole!.startsWith('-') ? -1 : 1;
  return sign * (Math.abs(Number(whole)) * 100 + Number(fraction.padEnd(2, '0')));
}

export async function POST(req: Request) {
  const denied = await requireSupportWrite(); if (denied) return denied;
  const auth = await requireRole('manager'); if (!auth.ok) return auth.response;
  if (auth.user.support) return fail('forbidden', 'Use your own organization account.', 403);
  try {
    let input: unknown;
    if (req.headers.get('content-type')?.startsWith('multipart/form-data')) {
      const form = await req.formData(), file = form.get('file');
      const projectId = z.uuid().parse(form.get('project_id'));
      if (!(file instanceof File) || file.size > 512_000 || !file.name.toLowerCase().endsWith('.csv'))
        return fail('validation_failed', 'Choose a CSV file up to 500 KiB.', 422, { headers });
      const decoded = decodificarCsv(await file.arrayBuffer());
      if ('erro' in decoded) return fail('validation_failed', decoded.erro, 422, { headers });
      const rows = parseCsv(decoded.texto);
      const header = rows.shift()?.map(column => column.trim().toLowerCase());
      if (!header || ['customer_code','shop_name','address','due_amount'].some((column, index) => header[index] !== column) || rows.length < 1 || rows.length > 500)
        return fail('validation_failed', 'CSV must contain customer_code,shop_name,address,due_amount and 1–500 rows.', 422, { headers });
      input = { operation: 'bulk', project_id: projectId, customers: rows.map(row => ({
        customer_code: row[0]?.trim() ?? '', shop_name: row[1]?.trim() ?? '',
        address: row[2]?.trim() ?? '', balance_cents: parseDue(row[3] ?? ''),
      })) };
    } else input = await readIntegrationJson(req);
    if (input && typeof input === 'object' && 'operation' in input && input.operation === 'void')
      return ok(await voidCustomerCollection(getRequestPool(), auth.org.orgId, auth.user.id, input), { headers });
    if (input && typeof input === 'object' && 'operation' in input && input.operation === 'remove')
      return ok(await removeProjectCustomer(getRequestPool(), auth.org.orgId, auth.user.id, input), { headers });
    return ok(await manageProjectCustomers(getRequestPool(), auth.org.orgId, auth.user.id, input), { headers });
  } catch (error) {
    if (error instanceof Error && error.message === 'field_invalid_due_amount')
      return fail('validation_failed', 'Use a plain amount with up to two decimal places, or leave due blank.', 422, { headers });
    return fieldError(error);
  }
}
