export type GeminiModelEntryInput = {
  name: string;
  alias: string;
};

export function stripGeminiModelResourceName(value: string): string {
  return String(value ?? '')
    .trim()
    .replace(/^\/?models\//i, '');
}

export function normalizeGeminiModelEntries(
  entries: GeminiModelEntryInput[]
): GeminiModelEntryInput[] {
  return (entries ?? []).reduce<GeminiModelEntryInput[]>((acc, entry) => {
    const name = stripGeminiModelResourceName(entry?.name ?? '').trim();
    let alias = String(entry?.alias ?? '').trim();
    if (name && alias === name) {
      alias = '';
    }
    if (!name && !alias) return acc;
    acc.push({ name, alias });
    return acc;
  }, []);
}
