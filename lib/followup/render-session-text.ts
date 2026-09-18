import { variableKeySchema } from './expression';
import { sessionVariableValues } from './session-variables';

/** Substituição única e explícita: valores do cliente nunca viram outra expressão. */
export function renderSessionText(template: string, rawVariables: unknown, maxLength: number): string {
  const variables = sessionVariableValues(rawVariables);
  const rendered = template.replace(/\{\{session\.([^{}]*)\}\}/g, (_match, key: string) => {
    if (!variableKeySchema.safeParse(key).success || !Object.hasOwn(variables, key))
      throw new Error('session_message_variable_missing');
    const value = variables[key];
    // Referências de anexos são internas; não enviá-las como URLs ao cliente.
    if (typeof value === 'string' && value.startsWith('attachment:'))
      throw new Error('session_message_attachment_reference');
    return String(value);
  });
  if (rendered.length > maxLength) throw new Error('session_message_too_long');
  return rendered;
}
