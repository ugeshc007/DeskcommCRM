'use client';
import { useCallback,useEffect,useState } from 'react';
import Link from 'next/link';
import { Button } from '@/components/ui/button';
import { Input } from '@/components/ui/input';
import { Label } from '@/components/ui/label';
import { Dialog,DialogContent,DialogHeader,DialogTitle,DialogDescription } from '@/components/ui/dialog';
import { PlugsConnected,FileText,Users,CalendarBlank,CreditCard,EnvelopeSimple,Robot,ChatCircle,ShieldCheck } from '@/lib/ui/icons';
import { INTEGRATION_CATALOG,type PublicConnection,type PublicIntegrationRun } from '@/lib/integrations/catalog';
import { CREDENTIAL_FIELDS } from '@/lib/integrations/credential-fields';
import { MESSENGER_CONNECTION_PROVIDER } from '@/lib/channels/messenger/public-config';
import { PageChannelSetup } from './PageChannelSetup';
type GalleryData={connections:PublicConnection[];runs:PublicIntegrationRun[];can_manage:boolean;google_oauth_configured:boolean};
type Editing={provider:string;connection?:PublicConnection};
const icons={webhook:PlugsConnected,table:FileText,workflow:PlugsConnected,contacts:Users,calendar:CalendarBlank,payment:CreditCard,mail:EnvelopeSimple,bot:Robot,message:ChatCircle};
async function request(path:string,body?:unknown):Promise<unknown>{
 const response=await fetch(path,{method:body?'POST':'GET',cache:'no-store',headers:body?{'Content-Type':'application/json','Idempotency-Key':crypto.randomUUID()}:undefined,body:body?JSON.stringify(body):undefined});
 const json=await response.json();if(!response.ok)throw new Error(json.error?.message??'Connection request failed. Please retry.');return json.data;
}
export function IntegrationsGallery(){
 const [data,setData]=useState<GalleryData|null>(null);const [error,setError]=useState('');const [notice,setNotice]=useState('');
 const [search,setSearch]=useState('');const [busy,setBusy]=useState(false);const [editing,setEditing]=useState<Editing|null>(null);
 const [label,setLabel]=useState('');const [url,setUrl]=useState('');const [secret,setSecret]=useState('');
 const [credentialValues,setCredentialValues]=useState<Record<string,string>>({});
 const [confirmation,setConfirmation]=useState<{connection:PublicConnection;operation:'test'|'disconnect'}|null>(null);
 const load=useCallback(async()=>{try{setData(await request('/api/v1/integration-connections') as GalleryData);setError('');}catch(e){setError(e instanceof Error?e.message:'Unable to load integrations.');}},[]);
 useEffect(()=>{let cancelled=false;void Promise.resolve().then(()=>{if(cancelled)return;void load();const outcome=new URLSearchParams(window.location.search).get('oauth');if(outcome)setNotice(outcome==='connected'?'Google account connected. Select this connection in a Google Sheets flow block.':'Google connection was not completed. Reconnect and approve the required access.');});return()=>{cancelled=true;};},[load]);
 function edit(value:Editing|null){setEditing(value);setLabel(value?.connection?.label??INTEGRATION_CATALOG.find(p=>p.id===value?.provider)?.name??'');setUrl('');setSecret('');setCredentialValues({});}
 async function oauth(c:PublicConnection){
  const result=await request('/api/v1/integration-connections/oauth/start',{connection_id:c.id,revision:c.revision}) as {authorization_url:string};
  window.location.assign(result.authorization_url);
 }
 async function save(){
  if(!editing)return;setBusy(true);setError('');setNotice('');
  try{
   const credential=editing.provider==='webhook'?{url,secret}:Object.fromEntries(Object.entries(credentialValues).filter(([,value])=>value!==''));const existing=editing.connection;
   const c=await request(existing?'/api/v1/integration-connections/'+existing.id:'/api/v1/integration-connections',
    existing?{operation:'rotate',revision:existing.revision,label,credential}:{provider:editing.provider,label,...(editing.provider!=='google_sheets'?{credential}:{})}) as PublicConnection;
   edit(null);await load();
   if(c.provider==='google_sheets')await oauth(c);else setNotice(c.provider===MESSENGER_CONNECTION_PROVIDER
    ? 'Page credentials saved securely. Test the Page identity, then activate the messaging channel and configure its webhook.'
    : 'Credential saved securely. Test the connection before selecting it in a flow. Rotation requires updating blocks to the new revision.');
  }catch(e){setError(e instanceof Error?e.message:'Unable to save connection.');}finally{setBusy(false);}
 }
 async function confirm(){
  if(!confirmation)return;setBusy(true);setError('');const {connection,operation}=confirmation;
  try{const c=await request('/api/v1/integration-connections/'+connection.id,{operation,revision:connection.revision}) as PublicConnection;
   setConfirmation(null);await load();setNotice(operation==='disconnect'?'Disconnected. Credentials removed; history preserved.':c.active?'Connection test passed.':'Test failed. Review the provider settings or reconnect.');
  }catch(e){setError(e instanceof Error?e.message:'Operation failed.');}finally{setBusy(false);}
 }
 return <main className="mx-auto max-w-7xl space-y-8 p-4 md:p-8">
  <header className="flex flex-wrap items-start justify-between gap-4"><div><p className="text-xs font-semibold uppercase tracking-wider text-text-muted">Organization workspace</p><h1 className="mt-2 text-2xl font-semibold">Integrations</h1><p className="mt-2 max-w-2xl text-sm text-text-muted">Connect your apps, then use their actions in the bot builder. Accounts and credentials belong only to this organization.</p></div><Button variant="secondary" onClick={()=>void load()} disabled={busy}>Refresh</Button></header>
  <div className="flex gap-3 rounded-lg border border-border bg-accent-soft p-4 text-sm"><ShieldCheck size={22} className="shrink-0" aria-hidden/><p>Keys are encrypted on the server and never displayed again. Connecting an app does not publish or change any customer bot.</p></div>
  {error&&<p role="alert" className="rounded-md border border-error p-3 text-sm text-error-fg">{error}</p>}
  {notice&&<p role="status" className="rounded-md border border-border p-3 text-sm">{notice}</p>}
  {!data&&!error&&<p role="status">Loading integrations…</p>}
  <section aria-labelledby="connections-title" className="space-y-4"><div className="flex flex-wrap justify-between gap-2"><h2 id="connections-title" className="text-lg font-semibold">Your connections</h2><Link className="text-sm underline" href="/app/ai/followups">Open bot builder</Link></div>
   {data?.connections.length===0&&<p className="rounded-lg border border-dashed border-border p-6 text-sm text-text-muted">No connections yet. Choose an available app below to get started.</p>}
   <div className="grid gap-4 md:grid-cols-2">{data?.connections.map(c=><article key={c.id} className="min-w-0 rounded-lg border border-border bg-surface p-5">
    <div className="flex items-start justify-between gap-3"><div className="min-w-0"><h3 className="break-words font-medium">{c.label}</h3><p className="mt-1 text-xs text-text-muted">{INTEGRATION_CATALOG.find(p=>p.id===c.provider)?.name??'Integration'} · Revision {c.revision}</p></div><span className="shrink-0 rounded-full bg-accent-soft px-2 py-1 text-xs">{c.active?(c.provider===MESSENGER_CONNECTION_PROVIDER?'Credentials verified':'Connected'):c.failure_code==='reconnect_required'?'Disconnected':'Test required'}</span></div>
    {c.provider===MESSENGER_CONNECTION_PROVIDER&&data.can_manage&&<PageChannelSetup connection={c}/>}
    <p className="mt-3 text-xs text-text-muted">{c.provider==='webhook'?'A successful test means the endpoint accepted synthetic data. Ensure your receiver verifies signatures.':c.provider==='inbound_webhook'?'Test checks signing configuration only. Send a signed event to verify delivery.':'Testing checks account access or synthetic ingestion, not every action permission. Verify action-specific scopes before publishing.'}</p>
    {(c.provider==='stripe'||c.provider==='inbound_webhook')&&<div className="mt-3 text-xs"><Label htmlFor={'callback-'+c.id}>Inbound callback path</Label><Input id={'callback-'+c.id} readOnly value={'/api/v1/webhooks/integrations/'+c.id}/><p className="mt-1 text-text-muted">Use this path on your public CRM HTTPS domain. Events appear in Recent executions. Read verified fields by event ID using a flow integration block.</p></div>}
    {data.can_manage&&<div className="mt-4 flex flex-wrap gap-2"><Button variant="secondary" size="sm" disabled={busy} onClick={()=>setConfirmation({connection:c,operation:'test'})}>Test</Button>
     <Button variant="secondary" size="sm" disabled={busy||(c.provider==='google_sheets'&&!data.google_oauth_configured)} onClick={()=>{if(c.provider!=='google_sheets')edit({provider:c.provider,connection:c});else{setBusy(true);void oauth(c).catch(e=>setError(e.message)).finally(()=>setBusy(false));}}}>{c.provider!=='google_sheets'?'Rotate / reconnect':'Reconnect OAuth'}</Button>
     <Button variant="secondary" size="sm" disabled={busy} onClick={()=>setConfirmation({connection:c,operation:'disconnect'})}>Disconnect</Button></div>}
   </article>)}</div>
  </section>
  <section aria-labelledby="apps-title" className="space-y-4"><div className="flex flex-wrap items-center justify-between gap-3"><h2 id="apps-title" className="text-lg font-semibold">App gallery</h2><Input aria-label="Search integrations" className="max-w-xs" placeholder="Search apps or use cases" value={search} onChange={e=>setSearch(e.target.value)}/></div>
   <div className="grid gap-4 sm:grid-cols-2 xl:grid-cols-3">{INTEGRATION_CATALOG.filter(p=>(p.name+' '+p.description).toLowerCase().includes(search.toLowerCase())).map(p=>{const Icon=icons[p.icon as keyof typeof icons]??PlugsConnected;const available=String(p.auth)!=='planned';return <article key={p.id} className="flex min-w-0 flex-col rounded-lg border border-border bg-surface p-5">
    <div className="flex items-center gap-3"><span className="rounded-lg bg-accent-soft p-2"><Icon size={24} aria-hidden/></span><h3 className="font-semibold">{p.name}</h3></div><p className="mt-3 flex-1 text-sm text-text-muted">{p.description}</p>
    <details className="mt-3 text-xs text-text-muted"><summary className="cursor-pointer">Setup and usage</summary><p className="mt-2 leading-5">{p.instructions}</p></details>
    <div className="mt-4"><Button className="w-full" variant={available?'default':'secondary'} disabled={!available||!data?.can_manage||busy||(p.id==='google_sheets'&&!data.google_oauth_configured)} onClick={()=>edit({provider:p.id})}>{available?p.id==='google_sheets'?'Connect Google account':'Add connection':'Planned · Phase '+p.phase}</Button>
    {p.id==='google_sheets'&&data&&!data.google_oauth_configured&&<p className="mt-2 text-xs text-text-muted">Installation setup needed: configure the Google OAuth client ID and secret.</p>}</div>
   </article>;})}</div>
  </section>
  <section aria-labelledby="history-title" className="space-y-3"><h2 id="history-title" className="text-lg font-semibold">Recent executions</h2><p className="text-xs text-text-muted">Latest 50 runs. Payloads, results and credentials are never shown here. Pending or uncertain runs are not automatically resent—check the destination before taking further action.</p>
   {!data?.runs.length?<p className="text-sm text-text-muted">No integration executions recorded.</p>:<div className="overflow-x-auto rounded-lg border border-border"><table className="w-full text-left text-sm"><thead><tr className="bg-accent-soft"><th className="p-3">Connection</th><th className="p-3">Action</th><th className="p-3">Status</th><th className="p-3">Time</th></tr></thead><tbody>{data.runs.map(r=><tr key={r.id} className="border-t border-border"><td className="p-3">{data.connections.find(c=>c.id===r.connection_id)?.label??'Connection'}</td><td className="p-3">{r.action==='send_event'?'Send event':r.action}</td><td className="p-3">{r.status==='indeterminate'?'Needs review':r.status}{r.failure_code&&<span className="block text-xs text-text-muted">{r.failure_code.replaceAll('_',' ')}</span>}</td><td className="whitespace-nowrap p-3">{new Date(r.created_at).toLocaleString('en')}</td></tr>)}</tbody></table></div>}
  </section>
  <Dialog open={!!editing} onOpenChange={open=>{if(!open&&!busy)edit(null);}}><DialogContent className="max-h-[90dvh] overflow-y-auto"><DialogHeader><DialogTitle>{editing?.connection?'Rotate connection credentials':'Add a connection'}</DialogTitle><DialogDescription>Only this organization can use the account. No key is returned after saving.</DialogDescription></DialogHeader>
   {error&&<p role="alert" className="text-sm text-error-fg">{error}</p>}
   <form className="space-y-4" onSubmit={e=>{e.preventDefault();void save();}}><div><Label htmlFor="connection-label">Connection name</Label><Input id="connection-label" value={label} required maxLength={120} onChange={e=>setLabel(e.target.value)}/></div>
    {editing?.provider==='webhook'&&<><div><Label htmlFor="connection-url">HTTPS endpoint</Label><Input id="connection-url" type="url" value={url} required placeholder="https://your-app.example/webhook" onChange={e=>setUrl(e.target.value)}/><p className="mt-1 text-xs text-text-muted">No credentials in the URL. Private network addresses and redirects are blocked.</p></div><div><Label htmlFor="connection-secret">Signing secret</Label><Input id="connection-secret" type="password" autoComplete="new-password" value={secret} required minLength={16} maxLength={2048} onChange={e=>setSecret(e.target.value)}/><p className="mt-1 text-xs text-text-muted">At least 16 characters. Configure the same secret at the receiver.</p></div></>}
    {(CREDENTIAL_FIELDS[editing?.provider??'']??[]).map(field=><div key={field.key}><Label htmlFor={'credential-'+field.key}>{field.label}</Label><Input id={'credential-'+field.key} type={field.secret?'password':'text'} autoComplete="off" required={!field.optional} maxLength={16000} value={credentialValues[field.key]??''} onChange={e=>setCredentialValues(v=>({...v,[field.key]:e.target.value}))}/></div>)}
    <Button type="submit" disabled={busy}>{busy?'Saving…':editing?.provider==='google_sheets'?'Continue to Google':'Save securely'}</Button>
   </form>
  </DialogContent></Dialog>
  <Dialog open={!!confirmation} onOpenChange={open=>{if(!open&&!busy)setConfirmation(null);}}><DialogContent><DialogHeader><DialogTitle>{confirmation?.operation==='disconnect'?'Disconnect this account?':'Test this connection?'}</DialogTitle><DialogDescription>{confirmation?.operation==='disconnect'?'Saved credentials will be removed. Existing blocks using this revision will stop; execution history is preserved.':'This contacts the provider. Webhook, n8n, Zapier, Segment and custom POST tests send synthetic data and may trigger actions in your external workflow. Use a test endpoint. Other account tests do not verify every action permission.'}</DialogDescription></DialogHeader><div className="flex justify-end gap-2"><Button variant="secondary" disabled={busy} onClick={()=>setConfirmation(null)}>Cancel</Button><Button disabled={busy} onClick={()=>void confirm()}>{busy?'Working…':'Confirm'}</Button></div></DialogContent></Dialog>
 </main>;
}
