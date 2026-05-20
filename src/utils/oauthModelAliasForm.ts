import type { OAuthModelAliasEntry } from '@/types';
import { generateId } from '@/utils/helpers';

export type OAuthModelMappingFormEntry = OAuthModelAliasEntry & { id: string };

type AuthFileModelItem = { id: string; display_name?: string };

export function resolveProviderAliasKey(
  modelAlias: Record<string, OAuthModelAliasEntry[]>,
  provider: string
): string | null {
  const normalized = provider.trim().toLowerCase();
  if (!normalized) return null;
  return Object.keys(modelAlias).find((key) => key.trim().toLowerCase() === normalized) ?? null;
}

export function buildEmptyMappingEntry(): OAuthModelMappingFormEntry {
  return {
    id: generateId(),
    name: '',
    alias: '',
    fork: true,
  };
}

export function normalizeMappingEntries(
  entries?: OAuthModelAliasEntry[]
): OAuthModelMappingFormEntry[] {
  if (!Array.isArray(entries) || entries.length === 0) {
    return [buildEmptyMappingEntry()];
  }
  return entries.map((entry) => ({
    id: generateId(),
    name: entry.name ?? '',
    alias: entry.alias ?? '',
    fork: Boolean(entry.fork),
  }));
}

/** Merge provider model catalog with saved alias mappings for the edit form. */
export function buildMappingsFromModels(
  modelsList: AuthFileModelItem[],
  existing: OAuthModelAliasEntry[]
): OAuthModelMappingFormEntry[] {
  const aliasByName = new Map<string, OAuthModelAliasEntry[]>();

  for (const entry of existing) {
    const name = String(entry.name ?? '').trim();
    if (!name) continue;
    const key = name.toLowerCase();
    const bucket = aliasByName.get(key) ?? [];
    bucket.push(entry);
    aliasByName.set(key, bucket);
  }

  const result: OAuthModelMappingFormEntry[] = [];
  const seenNames = new Set<string>();

  for (const model of modelsList) {
    const name = String(model.id ?? '').trim();
    if (!name) continue;
    const key = name.toLowerCase();
    seenNames.add(key);

    const saved = aliasByName.get(key) ?? [];
    if (saved.length === 0) {
      result.push({
        id: generateId(),
        name,
        alias: '',
        fork: true,
      });
      continue;
    }

    const entry = saved[0];
    result.push({
      id: generateId(),
      name: entry.name ?? name,
      alias: entry.alias ?? '',
      fork: Boolean(entry.fork),
    });
  }

  for (const entry of existing) {
    const name = String(entry.name ?? '').trim();
    const key = name.toLowerCase();
    if (!name || seenNames.has(key)) continue;
    result.push({
      id: generateId(),
      name: entry.name ?? '',
      alias: entry.alias ?? '',
      fork: Boolean(entry.fork),
    });
  }

  return result;
}

export function summarizeMappingEntries(entries: OAuthModelMappingFormEntry[]) {
  const named = entries.filter((entry) => String(entry.name ?? '').trim());
  const uniqueNames = new Set(named.map((entry) => entry.name.trim().toLowerCase()));
  const aliasedModelNames = new Set<string>();

  named.forEach((entry) => {
    if (String(entry.alias ?? '').trim()) {
      aliasedModelNames.add(entry.name.trim().toLowerCase());
    }
  });

  return {
    total: uniqueNames.size,
    aliasedModels: aliasedModelNames.size,
    passthroughModels: uniqueNames.size - aliasedModelNames.size,
    aliasRows: named.filter((entry) => String(entry.alias ?? '').trim()).length,
  };
}

export function normalizeMappingsForSave(
  mappings: OAuthModelMappingFormEntry[]
): OAuthModelAliasEntry[] {
  const byName = new Map<string, OAuthModelAliasEntry>();

  for (const entry of mappings) {
    const name = String(entry.name ?? '').trim();
    const alias = String(entry.alias ?? '').trim();
    if (!name || !alias) continue;

    byName.set(name.toLowerCase(), entry.fork ? { name, alias, fork: true } : { name, alias });
  }

  return Array.from(byName.values());
}
