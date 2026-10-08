// Species helpers shared by build-time queries (lib/db.ts) and client components,
// so this module must not import anything Node-only.

/** Species names the AI uses when it can't identify the bird, e.g. "unknown" or "unknown bird". */
export function isUnknownSpecies(species: string): boolean {
  return /\b(unknown|unidentified)\b/i.test(species);
}

/** True for a named species: not null/blank and not an "unknown"/"unidentified" placeholder. */
export function isKnownSpecies(species: string | null): species is string {
  return species != null && species.trim() !== "" && !isUnknownSpecies(species);
}
