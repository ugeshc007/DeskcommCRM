# Visual bot builder — implementation status

## Implemented locally

- `NodePalette` → `FlowCanvas`: click/drag text, AI and saved-message presets.
- `builder-library.ts` → graph mapper → existing save/publish routes → existing engine:
  connected welcome, product-enquiry and payment-assistance draft starters.
- `ActionForm` → preview: exact text only; AI preview explicitly does not simulate a response.
- Existing graphs cannot be replaced by a starter. Invalid external drag data is ignored.
- Product enquiry instructions request verified catalogue information through the selected agent;
  this is **not** a native interactive product card, cart or inventory integration.

No schema, send pipeline, permission or audit contract changed. Existing Save and Publish
retain their authorization, audit, validation and messaging-window checks.

## Remaining before full requested delivery

1. Media contract and guarded runtime sends: image, video, document and audio.
2. Interactive buttons/lists and native catalogue products, capability-gated by channel.
3. Organization product picker, media picker, branching reply preview and end-to-end test mode.
4. Reusable e-commerce installer, organization shipping configuration and integrations described
   in `ecommerce-organization-template.md`.
5. Authenticated browser tests against a fresh database, visual evidence, integration with the
   customized live fork, then a scoped CT102 deployment. Do not deploy this upstream-based
   branch over the customized installation without preserving its SaaS/English/security fixes.

## Living System Checklist

Input: operator selections in the existing follow-up editor. Output: normal draft graph consumed
by the existing engine. Registration: existing audited save/publish endpoints. Visibility and
entry: AI → Follow-ups → editor; no new orphan page. Continuity: existing flow handoff policy
is unchanged. No-response product enquiry ends through its explicit no-reply branch.
Configuration: node settings panel. Error feedback: existing publish errors remain attached
to nodes and operators correct/re-save the draft. These helpers send no messages themselves.

Verification evidence belongs in the handoff; unit validation is not proof of live delivery.
