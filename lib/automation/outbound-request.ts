import { lookup } from 'node:dns/promises';
import { request as httpRequest } from 'node:http';
import { request as httpsRequest } from 'node:https';
import { isIP, type LookupFunction } from 'node:net';
import { ipEhEspecial } from './outbound-ip';
import { assertSafeOutboundUrl } from './outbound-url';

/** O socket usa ESTA resolução: não há segundo lookup entre o guard e a conexão. */
export const safeOutboundLookup: LookupFunction = (hostname, options, callback) => {
  void lookup(hostname, { all: true }).then(addresses => {
    if (!addresses.length || addresses.some(item => ipEhEspecial(item.address))) {
      callback(new Error('unsafe_url:private_ip'), '', 4); return;
    }
    const eligible = options.family ? addresses.filter(item => item.family === options.family) : addresses;
    if (!eligible.length) { callback(new Error('unsafe_url:dns_empty'), '', 4); return; }
    if (options.all) callback(null, eligible);
    else callback(null, eligible[0]!.address, eligible[0]!.family);
  }, () => callback(new Error('unsafe_url:dns_failed'), '', 4));
};

/** POST limitado; preserva Host/SNI/TLS, não segue redirects nem expõe resposta. */
export async function postOutboundWebhook(url: string, body: string, headers: Record<string, string>, options: { skipUrlCheck?: boolean; timeoutMs?: number } = {}): Promise<number> {
  const bypass = options.skipUrlCheck === true && process.env.NODE_ENV === 'test';
  if (!bypass) assertSafeOutboundUrl(url);
  const target = new URL(url);
  if (target.protocol !== 'https:' && target.protocol !== 'http:') throw new Error('unsafe_url:scheme');
  if (target.username || target.password) throw new Error('unsafe_url:credentials');
  if (!bypass && isIP(target.hostname) && ipEhEspecial(target.hostname)) throw new Error('unsafe_url:private_ip');
  if (Buffer.byteLength(body) > 262144) throw new Error('webhook_payload_too_large');
  return new Promise<number>((resolve, reject) => {
    const request = target.protocol === 'https:' ? httpsRequest : httpRequest;
    const req = request(target, {
      method: 'POST', headers, agent: false,
      ...(bypass ? {} : { lookup: safeOutboundLookup }),
      signal: AbortSignal.timeout(options.timeoutMs ?? 10000),
    }, res => {
      // O contrato usa somente o status. Destrói o stream antes de ler corpo
      // arbitrário de terceiro; nenhum conteúdo sensível vira log/histórico.
      const status = res.statusCode ?? 502;
      res.destroy(); resolve(status);
    });
    req.on('error', () => reject(new Error('webhook_request_failed')));
    req.end(body);
  });
}
