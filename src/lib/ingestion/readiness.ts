/** Pure validation for the credential-protected database connection check. */
export function countValidSports(raw: unknown): number {
  if (!Array.isArray(raw) || raw.length === 0) {
    throw new Error("Supabase sports query returned an empty or invalid result");
  }
  const ids = new Set<string>();
  for (const row of raw) {
    if (!row || typeof row !== "object" || Array.isArray(row) ||
      typeof (row as { code?: unknown }).code !== "string" ||
      !/^[a-z0-9_]{2,32}$/.test((row as { code: string }).code)) {
      throw new Error("Supabase sports query returned an invalid sport code");
    }
    const code = (row as { code: string }).code;
    if (ids.has(code)) throw new Error("Supabase sports query returned a duplicate code");
    ids.add(code);
  }
  return ids.size;
}
