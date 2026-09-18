'use client';
import { useEffect,useState } from 'react';
import Link from 'next/link';
import { Label } from '@/components/ui/label';
import { Input } from '@/components/ui/input';
import { Select,SelectContent,SelectItem,SelectTrigger,SelectValue } from '@/components/ui/select';
import { INTEGRATION_CATALOG,ACTION_OUTPUTS,type PublicConnection } from '@/lib/integrations/catalog';
import type { IntegrationFlowConfig } from '@/lib/integrations/flow-config';
import { ExpressionEditor } from './ExpressionEditor';
export function IntegrationForm({config,onChange}:{config:IntegrationFlowConfig;onChange:(config:IntegrationFlowConfig)=>void}){
 const [connections,setConnections]=useState<PublicConnection[]>([]);const [error,setError]=useState('');const [loading,setLoading]=useState(true);
 useEffect(()=>{let active=true;void fetch('/api/v1/integration-connections',{cache:'no-store'}).then(async res=>{if(!res.ok)throw new Error('Unable to load connections.');return res.json();}).then(json=>{if(active)setConnections(json.data.connections);}).catch(()=>{if(active)setError('Unable to load connections. Reopen this block to retry.');}).finally(()=>{if(active)setLoading(false);});return()=>{active=false;};},[]);
 const eligible=connections.filter(c=>c.active&&INTEGRATION_CATALOG.find(p=>p.id===c.provider)?.actions.length);
 const selected=eligible.find(c=>c.id===config.connection_id);const actions=INTEGRATION_CATALOG.find(p=>p.id===selected?.provider)?.actions??[];
 return <div className="space-y-4">
  <p className="text-xs text-text-muted">Choose an organization connection. Map only the fields you intend to share; no credentials belong in this block.</p>
  <Link href="/app/integrations" className="block text-sm underline">Manage integrations</Link>
  {loading&&<p role="status">Loading connections…</p>}{error&&<p role="alert">{error}</p>}
  {!loading&&!error&&!eligible.length&&<p className="text-sm">Add and test a connection in Integrations first.</p>}
  {!loading&&config.connection_id&&!selected&&<p role="alert">The selected connection is unavailable or has not passed testing. Select a tested connection.</p>}
  <Label htmlFor="integration-connection">Connection</Label><Select value={config.connection_id??''} onValueChange={id=>{const c=eligible.find(item=>item.id===id);if(c)onChange({...config,connection_id:id,connection_revision:c.revision});}}><SelectTrigger id="integration-connection"><SelectValue placeholder="Select a tested connection"/></SelectTrigger><SelectContent>{eligible.map(c=><SelectItem key={c.id} value={c.id}>{c.label}</SelectItem>)}</SelectContent></Select>
  {selected&&selected.revision!==config.connection_revision&&<p role="alert" className="text-xs text-error-fg">Credentials changed. Select this connection again and save before publishing.</p>}
  <Label htmlFor="integration-action">Action</Label><Select value={config.action} onValueChange={action=>onChange({...config,action,mappings:{},output:undefined})}><SelectTrigger id="integration-action"><SelectValue placeholder="Select an action"/></SelectTrigger><SelectContent>{actions.map(action=><SelectItem key={action.id} value={action.id}>{action.name}</SelectItem>)}</SelectContent></Select>
  {actions.find(a=>a.id===config.action)?.fields.map(field=><ExpressionEditor key={field} label={field.replaceAll('_',' ')} value={config.mappings[field]??{kind:'literal',value:''}} onChange={value=>onChange({...config,mappings:{...config.mappings,[field]:value}})}/>)}
  <fieldset className="space-y-2 rounded-md border border-border p-3"><legend className="text-sm">Use the result in later blocks</legend><Label htmlFor="integration-result">Result field</Label><Select value={config.output?.field??'none'} onValueChange={field=>onChange({...config,output:field==='none'?undefined:{field,variable:config.output?.variable??'integration_result'}})}><SelectTrigger id="integration-result"><SelectValue/></SelectTrigger><SelectContent><SelectItem value="none">Do not save a result</SelectItem>{(ACTION_OUTPUTS[config.action]??[]).filter(field=>config.action!=='notify_staff'||field===(selected?.provider==='sendgrid'?'accepted':'id')).map(field=><SelectItem key={field} value={field}>{field}</SelectItem>)}</SelectContent></Select>{config.output&&<><Label htmlFor="integration-variable">Session variable name</Label><Input id="integration-variable" value={config.output.variable} onChange={e=>onChange({...config,output:{...config.output!,variable:e.target.value}})}/><p className="text-xs text-text-muted">Only this execution receives the selected value. Use it in later messages or conditions.</p></>}</fieldset>
  <p className="rounded-md border border-border p-3 text-xs">Connect both Success and Error outputs. Uncertain delivery stops for human review; it is never silently retried.</p>
 </div>;
}
