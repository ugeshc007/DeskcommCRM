import { describe,it,expect } from 'vitest';
import { flowGraphSchema,nodeBranches,type FlowGraph } from '@/lib/followup/graph-schema';
import { validateFlowForPublish } from '@/lib/followup/validate-publish';
describe('integration builder contract',()=>{
 const graph:FlowGraph={nodes:[
  {id:'start',type:'trigger',label:'Start',position:{x:0,y:0},config:{}},
  {id:'app',type:'action',label:'App',position:{x:0,y:100},config:{mode:'integration',connection_id:'33333333-3333-4333-8333-333333333333',connection_revision:1,action:'send_event',mappings:{event:{kind:'literal',value:'lead'},value:{kind:'literal',value:true}}}},
  {id:'end',type:'end',label:'End',position:{x:0,y:200},config:{outcome:'custom'}}
 ],edges:[{id:'a',source:'start',target:'app',priority:0,condition:{type:'always'}},...['success','error'].map(branch=>({id:branch,source:'app',target:'end',priority:0,condition:{type:'branch' as const,branch_id:branch}}))]};
 it('parses and publishes a connected two-branch action',()=>{
  expect(flowGraphSchema.safeParse(graph).success).toBe(true);
  const action = graph.nodes[1];
  if (!action) throw new Error('Missing integration fixture');
  expect(nodeBranches(action).map(b=>b.id)).toEqual(['success','error']);
  expect(validateFlowForPublish(graph)).toEqual({ok:true});
 });
 it('requires an explicit error output',()=>{
  const result=validateFlowForPublish({...graph,edges:graph.edges.filter(e=>e.id!=='error')});
  expect(result.ok).toBe(false);if(!result.ok)expect(result.errors).toEqual(expect.arrayContaining([expect.objectContaining({code:'integration_branch_missing'})]));
 });
});
