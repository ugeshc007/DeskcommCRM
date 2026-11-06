import { createHash } from 'node:crypto';
import { z } from 'zod';
import { ConnectorRejected, type ConnectorAction } from './execution';
import { apiCredentialSchemas } from './provider-credentials';
import { providerHttp } from './provider-http';

const text = z.string().min(1).max(2000);
const memberInput = z.strictObject({ email: z.email() });
const intentInput = z.strictObject({ text, language_code: z.string().regex(/^[a-z]{2,3}(-[A-Za-z0-9]{2,8})?$/) });
const trackInput = z.strictObject({ anonymous_id: z.string().min(1).max(200), event: z.string().min(1).max(100) });
const basic = (token: string) => 'Basic ' + Buffer.from('integration:' + token).toString('base64');

export const communicationActions: readonly ConnectorAction[] = [
  {
    provider: 'mailchimp', action: 'subscription_status', retry: 'read_only', input: memberInput,
    output: z.strictObject({ status: z.enum(['subscribed', 'unsubscribed', 'cleaned', 'pending', 'transactional', 'archived', 'not_found']) }),
    async execute(raw, context) {
      const input = memberInput.parse(raw);
      const secret = apiCredentialSchemas.mailchimp.parse(JSON.parse(context.credential));
      const hash = createHash('md5').update(input.email.trim().toLowerCase()).digest('hex');
      const result = await providerHttp(`https://${secret.server}.api.mailchimp.com/3.0/lists/${secret.list_id}/members/${hash}`, 'GET', { Authorization: basic(secret.token) });
      if (result.status === 404) return { status: 'not_found' };
      if (result.status !== 200) throw new ConnectorRejected();
      // Só leitura: não inscreve, não reativa opt-out, não envia campanhas.
      return z.object({ status: z.string() }).parse(result.data);
    },
  },
  {
    provider: 'dialogflow', action: 'detect_intent', retry: 'never', input: intentInput,
    output: z.strictObject({ intent: z.string().max(2000), confidence: z.number().min(0).max(1), reply: z.string().max(2000) }),
    async execute(raw, context) {
      const input = intentInput.parse(raw);
      const secret = apiCredentialSchemas.dialogflow.parse(JSON.parse(context.credential));
      // Sessão isolada por execução. Não aceita ID arbitrário capaz de cruzar conversas.
      const session = createHash('sha256').update(context.idempotencyKey).digest('hex').slice(0, 36);
      const result = await providerHttp(`https://dialogflow.googleapis.com/v2/projects/${secret.project_id}/agent/sessions/${session}:detectIntent`, 'POST', { Authorization: 'Bearer ' + secret.token, 'Content-Type': 'application/json' }, JSON.stringify({ queryInput: { text: { text: input.text, languageCode: input.language_code } } }));
      if (result.status !== 200) throw new Error('integration_delivery_uncertain');
      const response = z.object({ queryResult: z.object({ intent: z.object({ displayName: z.string().max(2000) }).optional(), intentDetectionConfidence: z.number().min(0).max(1).optional(), fulfillmentText: z.string().max(2000).optional() }) }).parse(result.data).queryResult;
      // Não envia fulfillment automaticamente: o próximo bloco passa pelo canal guardado.
      return { intent: response.intent?.displayName ?? '', confidence: response.intentDetectionConfidence ?? 0, reply: response.fulfillmentText ?? '' };
    },
  },
  {
    provider: 'segment', action: 'track_event', retry: 'provider_idempotent', input: trackInput,
    output: z.strictObject({ accepted: z.literal(true) }),
    async execute(raw, context) {
      const input = trackInput.parse(raw);
      const secret = apiCredentialSchemas.segment.parse(JSON.parse(context.credential));
      const result = await providerHttp('https://api.segment.io/v1/track', 'POST', { Authorization: 'Basic ' + Buffer.from(secret.token + ':').toString('base64'), 'Content-Type': 'application/json' }, JSON.stringify({ anonymousId: input.anonymous_id, event: input.event, messageId: context.idempotencyKey }));
      if (result.status !== 200 || !z.object({ success: z.literal(true) }).safeParse(result.data).success) throw new Error('integration_delivery_uncertain');
      return { accepted: true };
    },
  },
];

export async function testCommunicationCredential(provider: string, credential: string): Promise<boolean> {
  if (provider === 'mailchimp') {
    const s = apiCredentialSchemas.mailchimp.parse(JSON.parse(credential));
    const r = await providerHttp(`https://${s.server}.api.mailchimp.com/3.0/lists/${s.list_id}?fields=id`, 'GET', { Authorization: basic(s.token) });
    return r.status === 200 && z.object({ id: z.literal(s.list_id) }).safeParse(r.data).success;
  }
  if (provider === 'dialogflow') {
    const s = apiCredentialSchemas.dialogflow.parse(JSON.parse(credential));
    const r = await providerHttp(`https://dialogflow.googleapis.com/v2/projects/${s.project_id}/agent`, 'GET', { Authorization: 'Bearer ' + s.token });
    return r.status === 200 && z.object({ displayName: z.string().min(1) }).safeParse(r.data).success;
  }
  if (provider === 'segment') {
    const s = apiCredentialSchemas.segment.parse(JSON.parse(credential));
    const r = await providerHttp('https://api.segment.io/v1/track', 'POST', { Authorization: 'Basic ' + Buffer.from(s.token + ':').toString('base64'), 'Content-Type': 'application/json' }, JSON.stringify({ anonymousId: 'integration-connection-test', event: 'Integration connection test' }));
    return r.status === 200 && z.object({ success: z.literal(true) }).safeParse(r.data).success;
  }
  return false;
}
