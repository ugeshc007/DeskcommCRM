import { createHmac } from 'node:crypto';
import { z } from 'zod';
import { postOutboundWebhook } from '@/lib/automation/outbound-request';
import { assertSafeOutboundUrl } from '@/lib/automation/outbound-url';
import type { ConnectorAction } from './execution';
import { dataActions } from './data-actions';
import { salesActions } from './sales-actions';
import { automationActions } from './automation-actions';
import { communicationActions } from './communication-actions';
import { inboundActions } from './inbound';

export const webhookCredentialSchema = z.strictObject({
 url: z.url().max(2048).refine(value => { try { const url = new URL(value); assertSafeOutboundUrl(value); return url.protocol === 'https:' && !url.search; } catch { return false; } }),
 secret: z.string().min(16).max(2048),
});
export const eventInputSchema = z.strictObject({ event: z.string().min(1).max(100), value: z.union([z.string().max(4000),z.number().finite(),z.boolean()]) });
export const integrationActions: readonly ConnectorAction[] = [{
 provider: 'webhook', action: 'send_event', retry: 'never', input: eventInputSchema, output: z.strictObject({ accepted: z.literal(true) }),
 async execute(input, context) {
  const credential = webhookCredentialSchema.parse(JSON.parse(context.credential));
  const body = JSON.stringify({ id: context.idempotencyKey, data: eventInputSchema.parse(input) });
  const signature = createHmac('sha256',credential.secret).update(body).digest('hex');
  const status = await postOutboundWebhook(credential.url,body,{ 'Content-Type':'application/json', 'X-Integration-Signature': 'sha256='+signature, 'X-Idempotency-Key':context.idempotencyKey });
  // HTTP falho não prova ausência de efeito no receiver: sem retry cego.
  if (status < 200 || status >= 300) throw new Error('integration_delivery_uncertain');
  return { accepted: true };
 }
},...dataActions,...salesActions,...automationActions,...communicationActions,...inboundActions];
