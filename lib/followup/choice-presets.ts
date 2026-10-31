import type { InteractiveMessage } from '@/lib/messaging/interactive';
import type { FlowGraph, MatchReplyBranch } from './graph-schema';

export function choiceBranches(interactive: InteractiveMessage): MatchReplyBranch[] {
  const choices = interactive.kind === 'buttons' ? interactive.choices : interactive.sections.flatMap(s => s.rows);
  return choices.map(choice => ({ id: `c_${choice.id}`, label: choice.title, op: 'eq', pattern: choice.id }));
}
export function createChoiceReply(sourceId: string, replyId: string, edgeId: string, interactive: InteractiveMessage, position: { x: number; y: number }): FlowGraph {
  return { nodes: [{ id: replyId, type: 'match_reply', label: 'Route choice', position,
    config: { branches: choiceBranches(interactive), choice_source_node_id: sourceId, grace_timeout_ms: 900000 } }],
    edges: [{ id: edgeId, source: sourceId, target: replyId, priority: 0, condition: { type: 'always' } }],
  };
}
