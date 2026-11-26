import type { FlowGraph } from "./graph-schema";
import type { AnswerFormat } from "./answer-validation";

export const QUESTION_BLOCKS = [
  { id: 'file', title: 'Ask for a file', description: 'Wait for an attachment, not a pasted URL.', prompt: 'Please attach the requested file to this chat. Do not send passwords or payment card details.' },
  { id: "name", title: "Ask for a name", description: "Collect a name and validate the reply.", prompt: "What is your name?" },
  { id: "email", title: "Ask for an email", description: "Accept a correctly formatted email address.", prompt: "What is your email address?" },
  { id: "phone", title: "Ask for a phone", description: "Collect an international number with country code.", prompt: "What is your phone number, including the + country code?" },
  { id: "number", title: "Ask for a number", description: "Accept a number using a decimal point.", prompt: "Please enter a number. Use a point for decimals, without commas." },
  { id: "date", title: "Ask for a date", description: "Accept a real calendar date in YYYY-MM-DD format.", prompt: "Please enter a date in YYYY-MM-DD format." },
  { id: "text", title: "Ask a question", description: "Collect a non-empty text answer.", prompt: "How can we help you?" },
] satisfies Array<{ id: AnswerFormat; title: string; description: string; prompt: string }>;

/** Par conectado, sem envio/publicação e sem escolher um campo do cliente por ele. */
export function createQuestionBlock(id: string, ids: { prompt: string; reply: string; edge: string }, position: { x: number; y: number }): FlowGraph | null {
  const preset = QUESTION_BLOCKS.find((item) => item.id === id);
  if (!preset) return null;
  return {
    nodes: [
      { id: ids.prompt, type: "action", label: preset.title, position, config: { mode: "text", body: preset.prompt } },
      { id: ids.reply, type: "match_reply", label: "Validate answer", position: { x: position.x + 360, y: position.y },
        config: { branches: [], grace_timeout_ms: 900000, answer_format: preset.id } },
    ],
    edges: [{ id: ids.edge, source: ids.prompt, target: ids.reply, priority: 0, condition: { type: "always" } }],
  };
}
