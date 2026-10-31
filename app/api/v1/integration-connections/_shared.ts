import { z } from 'zod';
import { fail } from '@/lib/api/wrappers';
export async function readIntegrationJson(req:Request):Promise<unknown> {
 if(!req.body) throw new Error('invalid_request');
 const reader=req.body.getReader(); const chunks:Uint8Array[]=[]; let size=0;
 try { while(true){const part=await reader.read();if(part.done)break;size+=part.value.length;if(size>70000)throw new Error('invalid_request');chunks.push(part.value);} }
 finally {await reader.cancel().catch(()=>undefined);}
 return JSON.parse(Buffer.concat(chunks).toString('utf8'));
}
export function integrationError(error:unknown):Response {
 const code=error instanceof Error?error.message:'';
 if(error instanceof z.ZodError || error instanceof SyntaxError || code==='invalid_request') return fail('validation_failed','Review the required connection fields.',422);
 if(code==='integration_conflict')return fail('conflict','This connection changed. Refresh and try again.',409);
 if(code==='integration_forbidden')return fail('forbidden','Only a current organization administrator can manage connections.',403);
 if(code==='oauth_not_configured')return fail('not_configured','The installation administrator must configure the Google OAuth app.',503);
 return fail('integration_unavailable','The connection could not be updated. Check encryption and provider configuration, then retry.',503);
}
