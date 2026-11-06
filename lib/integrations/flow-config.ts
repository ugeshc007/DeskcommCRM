import { z } from 'zod';
import { expressionSchema,variableKeySchema } from '@/lib/followup/expression';
export const integrationFlowConfigSchema=z.strictObject({
 mode:z.literal('integration'),
 connection_id:z.uuid().optional(),
 connection_revision:z.number().int().positive().optional(),
 action:z.string().regex(/^[a-z][a-z0-9_]{0,63}$/),
 mappings:z.record(z.string().regex(/^[a-z][a-z0-9_]{0,63}$/),expressionSchema).refine(v=>Object.keys(v).length<=30),
 output:z.strictObject({field:z.string().regex(/^[a-z][a-z0-9_]{0,63}$/),variable:variableKeySchema}).optional(),
});
export type IntegrationFlowConfig=z.infer<typeof integrationFlowConfigSchema>;
