import type { ZodTypeAny } from 'zod';

/**
 * Client-side validation that can never drift from the server's own rules
 * (Phase J, following customer-pwa's Phase H pattern): every form on this app
 * that has one validates against the exact same `@leen-mart/contracts` Zod
 * schema the API's own `validate()` middleware parses the request body with —
 * never a hand-copied regex or length that could quietly go stale next to it.
 *
 * Field names are the schema's own object keys (`issue.path.join('.')`),
 * which line up directly with this app's form-state keys since every form
 * here builds its state in the same shape as the request it sends.
 */
export const validateWithSchema = <T>(
  schema: ZodTypeAny,
  values: T,
): Readonly<Record<string, string>> => {
  const result = schema.safeParse(values);
  if (result.success) return {};

  const errors: Record<string, string> = {};
  for (const issue of result.error.issues) {
    const field = issue.path.join('.');
    // The first issue for a field is the one shown — matches the server's
    // own `collect()` in `validate.ts`, which likewise keeps every issue but
    // leaves "first wins" to whichever surface renders them.
    if (field && !(field in errors)) {
      errors[field] = issue.message;
    }
  }
  return errors;
};
