import type { OAuthModelAliasEntry } from '@/types';
import { generateId } from '@/utils/helpers';

export type OAuthModelMappingFormEntry = OAuthModelAliasEntry & { id: string };

type AuthFileModelItem = { id: string; display_name?: string };

const normalizeChannelKey = (value: string) => value.trim().toLowerCase();

/** Map auth file provider/type to oauth-model-alias channel (matches backend routing). */
export function resolveOAuthModelAliasChannel(provider: string): string {
  const key = normalizeChannelKey(provider);
  if (!key) return '';
  if (key === 'gemini') return 'gemini-cli';
  return key;
}

export function resolveProviderAliasKey(
  modelAlias: Record<string, OAuthModelAliasEntry[]>,
  provider: string
): string | null {
  const normalized = resolveOAuthModelAliasChannel(provider);
  if (!normalized) return null;
  return Object.keys(modelAlias).find((key) => normalizeChannelKey(key) === normalized) ?? null;
}

export function findOAuthModelAliasMappings(
  modelAlias: Record<string, OAuthModelAliasEntry[]>,
  channel: string
): OAuthModelAliasEntry[] {
  const normalized = resolveOAuthModelAliasChannel(channel);
  if (!normalized) return [];
  if (modelAlias[normalized]) return modelAlias[normalized];
  const entry = Object.entries(modelAlias).find(([key]) => normalizeChannelKey(key) === normalized);
  return entry?.[1] ?? [];
}

export function isDistinctOAuthModelAlias(name: string, alias: string): boolean {
  const nameTrim = String(name ?? '').trim();
  const aliasTrim = String(alias ?? '').trim();
  if (!nameTrim || !aliasTrim) return false;
  return nameTrim.toLowerCase() !== aliasTrim.toLowerCase();
}

export function upsertOAuthModelAliasLink(
  currentMappings: OAuthModelAliasEntry[],
  sourceModel: string,
  newAlias: string
): OAuthModelAliasEntry[] | 'duplicate' {
  const nameTrim = sourceModel.trim();
  const aliasTrim = newAlias.trim();
  const nameKey = nameTrim.toLowerCase();
  const aliasKey = aliasTrim.toLowerCase();

  const hasDuplicate = currentMappings.some(
    (entry) =>
      (entry.name ?? '').trim().toLowerCase() === nameKey &&
      (entry.alias ?? '').trim().toLowerCase() === aliasKey
  );
  if (hasDuplicate) return 'duplicate';

  const nextEntry: OAuthModelAliasEntry = { name: nameTrim, alias: aliasTrim };

  return [
    ...currentMappings.filter(
      (entry) =>
        (entry.name ?? '').trim().toLowerCase() !== nameKey ||
        (entry.alias ?? '').trim().toLowerCase() !== aliasKey
    ),
    nextEntry,
  ];
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

/** Merge provider definitions, auth-file models, and extra IDs (e.g. excluded) into one catalog. */
export function mergeProviderModelCatalog(
  definitions: AuthFileModelItem[],
  authFileModels: AuthFileModelItem[],
  extraIds: string[] = []
): AuthFileModelItem[] {
  const byKey = new Map<string, AuthFileModelItem>();

  const add = (model: AuthFileModelItem) => {
    const id = String(model.id ?? '').trim();
    if (!id) return;
    const key = id.toLowerCase();
    if (!byKey.has(key)) {
      byKey.set(key, { ...model, id });
    }
  };

  definitions.forEach(add);
  authFileModels.forEach(add);
  extraIds.forEach((rawId) => {
    const id = String(rawId ?? '').trim();
    if (id) add({ id });
  });

  return Array.from(byKey.values()).sort((a, b) =>
    a.id.localeCompare(b.id, undefined, { sensitivity: 'base' })
  );
}

export function resolveProviderExcludedModels(
  excluded: Record<string, Record<string, boolean>>,
  providerKey: string
): string[] {
  const normalized = normalizeChannelKey(providerKey);
  if (!normalized) return [];
  const providerModels =
    excluded[normalized] ||
    Object.entries(excluded).find(([key]) => normalizeChannelKey(key) === normalized)?.[1] ||
    {};
  return Object.entries(providerModels)
    .filter(([, disabled]) => disabled)
    .map(([modelId]) => modelId)
    .sort((a, b) => a.localeCompare(b));
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
    if (name.toLowerCase() === alias.toLowerCase()) continue;

    byName.set(name.toLowerCase(), entry.fork ? { name, alias, fork: true } : { name, alias });
  }

  return Array.from(byName.values());
}
