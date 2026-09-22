import { flowGraphSchema, type FlowGraph, type FlowNode } from "./graph-schema";

/** Editor presets use the existing execution contract; no UI-only node types. */
export const MESSAGE_BLOCKS = [
  {
    id: "text",
    title: "Text message",
    description: "Write the exact message your customer receives.",
    config: { mode: "text", body: "Hello! How can we help you today?" },
  },
  {
    id: "ai",
    title: "AI reply",
    description: "Give instructions; your agent writes the response.",
    config: {
      mode: "ai_message",
      prompt_hint:
        "Reply clearly and politely in English. Use only verified business information. Ask a clarifying question when information is missing.",
    },
  },
  {
    id: "template",
    title: "Saved message",
    description: "Choose a saved text template in the settings panel.",
    config: { mode: "template", template_id: "" },
  },
] satisfies Array<{
  id: string;
  title: string;
  description: string;
  config: Extract<FlowNode, { type: "action" }>["config"];
}>;

export const FLOW_STARTERS = [
  {
    id: "welcome",
    title: "Welcome & enquiry",
    description: "Greet a customer and ask what they need.",
    steps: "Start → Welcome → Finish",
  },
  {
    id: "sales",
    title: "Product enquiry",
    description: "Ask for the product or SKU, then guide the customer using your catalogue.",
    steps: "Start → Ask → Wait for reply → Sales agent → Finish",
  },
  {
    id: "payment",
    title: "Payment assistance",
    description: "Offer help without inventing a payment status or payment link.",
    steps: "Start → Offer help → Finish",
  },
] as const;
export type FlowStarterId = (typeof FLOW_STARTERS)[number]["id"];

/** Fresh graphs per use. Applying a starter is a local draft edit, never publication. */
export function createFlowStarter(id: FlowStarterId): FlowGraph {
  const start: FlowNode = {
    id: "trigger-1",
    type: "trigger",
    label: "Start",
    position: { x: 80, y: 160 },
    config: {},
  };
  const end: FlowNode = {
    id: "end-5",
    type: "end",
    label: "Finish",
    position: { x: 1080, y: 160 },
    config: { outcome: "custom", note: "Flow completed; this does not mark an order as paid." },
  };
  const message: FlowNode = {
    id: "action-2",
    type: "action",
    label:
      id === "payment"
        ? "Offer payment help"
        : id === "sales"
          ? "Ask about a product"
          : "Welcome message",
    position: { x: 330, y: 160 },
    config: {
      mode: "text",
      body:
        id === "payment"
          ? "Hello! Do you need any help with payment? Please do not send card details or security codes in this chat."
          : id === "sales"
            ? "Hello! Which product are you looking for? You can send the product name or SKU."
            : "Hello! Welcome to our store. How can we help you today?",
    },
  };
  const nodes: FlowNode[] = [start, message];
  if (id === "sales") {
    nodes.push(
      {
        id: "match_reply-3",
        type: "match_reply",
        label: "Wait for product enquiry",
        position: { x: 580, y: 160 },
        config: {
          branches: [
            { id: "product", label: "Product enquiry", op: "contains", pattern: "product" },
          ],
          grace_timeout_ms: 900_000,
        },
      },
      {
        id: "action-4",
        type: "action",
        label: "Answer from the catalogue",
        position: { x: 830, y: 160 },
        config: {
          mode: "ai_message",
          prompt_hint:
            "Respond in English to the customer's product enquiry. Search this organization's product catalogue using available tools. Only quote verified prices, currency, variants and stock. Never invent products, shipping charges, payment links or policies. If no verified match exists, ask a clarifying question or offer human assistance.",
        },
      },
    );
  } else end.position = { x: 580, y: 160 };
  nodes.push(end);
  const edges: FlowGraph["edges"] = nodes
    .slice(0, -1)
    .map((node, index) => ({
      id: `edge-${index + 1}`,
      source: node.id,
      target: nodes[index + 1]!.id,
      priority: 0,
      condition: { type: "always" },
    }));
  if (id === "sales") {
    edges.push({
      id: "edge-5",
      source: "match_reply-3",
      target: "action-4",
      priority: 1,
      condition: { type: "branch", branch_id: "product" },
    });
    edges.push({
      id: "edge-6",
      source: "match_reply-3",
      target: end.id,
      priority: 2,
      condition: { type: "branch", branch_id: "no_reply" },
    });
  }
  return flowGraphSchema.parse({ nodes, edges });
}

export function isFlowStarterId(value: string): value is FlowStarterId {
  return FLOW_STARTERS.some((starter) => starter.id === value);
}
