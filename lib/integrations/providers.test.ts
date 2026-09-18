import { createHmac } from 'node:crypto';
import { beforeEach, describe, expect, it, vi } from 'vitest';
vi.mock('@/lib/automation/outbound-request',()=>({postOutboundWebhook:vi.fn()}));
import { postOutboundWebhook } from '@/lib/automation/outbound-request';
import { integrationActions,webhookCredentialSchema } from './providers';
const webhookAction = integrationActions.find(action => action.provider === 'webhook' && action.action === 'send_event');
if (!webhookAction) throw new Error('Missing signed webhook action');
describe('signed webhook adapter',()=>{
 beforeEach(()=>vi.resetAllMocks());
 it('rejects local, insecure and query-bearing credential URLs',()=>{
  for(const url of ['http://example.com','https://127.0.0.1','https://example.com?token=secret'])expect(webhookCredentialSchema.safeParse({url,secret:'synthetic-signing-secret'}).success).toBe(false);
 });
 it('signs the exact body and passes a stable deduplication identifier',async()=>{
  vi.mocked(postOutboundWebhook).mockResolvedValue(204);
  await expect(webhookAction.execute({event:'lead',value:'synthetic'},{credential:JSON.stringify({url:'https://example.com/hook',secret:'synthetic-signing-secret'}),idempotencyKey:'stable-id'})).resolves.toEqual({accepted:true});
  const call = vi.mocked(postOutboundWebhook).mock.calls[0];
  if (!call) throw new Error('Expected outbound request');
  const [,body,headers]=call;
  expect(headers).toMatchObject({'X-Idempotency-Key':'stable-id','X-Integration-Signature':'sha256='+createHmac('sha256','synthetic-signing-secret').update(body).digest('hex')});
 });
 it('does not treat a failed remote response as safe to resend',async()=>{
  vi.mocked(postOutboundWebhook).mockResolvedValue(500);
  await expect(webhookAction.execute({event:'lead',value:true},{credential:JSON.stringify({url:'https://example.com/hook',secret:'synthetic-signing-secret'}),idempotencyKey:'stable-id'})).rejects.toThrow('integration_delivery_uncertain');
  expect(webhookAction.retry).toBe('never');
 });
});
