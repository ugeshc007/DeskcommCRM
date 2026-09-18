import { request } from 'node:https';
import { safeOutboundLookup } from '@/lib/automation/outbound-request';
import { assertSafeOutboundUrl } from '@/lib/automation/outbound-url';

/** Transporte limitado e DNS fixado, sem redirects nem mensagens remotas no erro. */
export async function providerHttp(url:string, method:'GET'|'POST'|'PUT', headers:Record<string,string>, body?:string):Promise<{status:number;data:unknown}> {
 assertSafeOutboundUrl(url);
 const target=new URL(url);
 if(target.protocol!=='https:'||target.username||target.password||target.hash)throw new Error('integration_url_invalid');
 if(body&&Buffer.byteLength(body)>65536)throw new Error('integration_payload_too_large');
 return new Promise((resolve,reject)=>{
  const req=request(target,{method,headers,agent:false,lookup:safeOutboundLookup,signal:AbortSignal.timeout(10000)},res=>{
   const parts:Buffer[]=[];let bytes=0;
   res.on('data',(part:Buffer)=>{bytes+=part.length;if(bytes>65536){res.destroy();reject(new Error('integration_response_too_large'));}else parts.push(part);});
   res.on('error',()=>reject(new Error('integration_request_failed')));
   res.on('end',()=>{try{const raw=Buffer.concat(parts).toString('utf8');resolve({status:res.statusCode??502,data:raw?JSON.parse(raw):null});}catch{reject(new Error('integration_response_invalid'));}});
  });
  req.on('error',()=>reject(new Error('integration_request_failed')));req.end(body);
 });
}
