/**
 * The SDD 8.2 legend, transcribed exactly — one member per symbol,
 * deliberately not collapsed into a boolean:
 *
 *   ● FULL       full access.
 *   ◐ OWN        own/tenant-scoped only. Resolving *which* resource
 *                instances count as "own" is SDD 7.4 step 3 (resource
 *                authorisation) — a later, application-layer concern once a
 *                use case has loaded the object. This policy only states
 *                that the role's grant is scoped, not full.
 *   ○ READ_ONLY  read-only.
 *   — NONE       no access.
 */
export type AccessLevel = 'FULL' | 'OWN' | 'READ_ONLY' | 'NONE';
