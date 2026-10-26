import { z } from 'zod';

/**
 * One tool = name + description + zod schema + run function.
 *
 * The same zod schema does two jobs: it becomes the JSON schema the AI sees (so the AI
 * knows the arguments), and it validates whatever the AI actually sends. One source of
 * truth, so the description and the check can never drift apart.
 *
 * `signedIn: true` → only for a signed-in patient (checked before `run`).
 */
export function defineTool({ name, description, schema = z.object({}), signedIn = false, run }) {
  return { name, description, schema, signedIn, run };
}

export function toOpenAiDefinition(tool) {
  const { $schema: _ignored, ...parameters } = z.toJSONSchema(tool.schema);
  return { type: 'function', function: { name: tool.name, description: tool.description, parameters } };
}

/** A friendly, structured error the AI can read and act on (instead of a crash). */
export const toolError = (error, message, extra = {}) => ({ error, message, ...extra });
