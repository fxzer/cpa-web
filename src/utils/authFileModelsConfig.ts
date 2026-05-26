import type { AuthFileItem, OAuthModelAliasEntry } from '@/types';
import type { AuthFileModelConfigRow, AuthFileModelsConfigResponse } from '@/types/oauth';
import type { AuthFileModelItem } from '@/features/authFiles/constants';
import { resolveOAuthModelAliasChannel } from '@/utils/oauthModelAliasForm';

export type ProviderModelsConfigEntry = {
  fileName: string;
  config: AuthFileModelsConfigResponse;
};

export function resolveRepresentativeAuthFile(
  files: AuthFileItem[],
  provider: string
): AuthFileItem | undefined {
  const normalizedProvider = resolveOAuthModelAliasChannel(provider);
  if (!normalizedProvider) return undefined;

  return files.find((file) => {
    const channel =
      resolveOAuthModelAliasChannel(String(file.type ?? '')) ||
      resolveOAuthModelAliasChannel(String(file.provider ?? ''));
    return channel === normalizedProvider;
  });
}

export function configToModelAliasEntries(
  config: AuthFileModelsConfigResponse
): OAuthModelAliasEntry[] {
  return config.rows
    .map((row) => {
      const name = String(row.id ?? '').trim();
      const alias = String(row.alias ?? '').trim();
      if (!name || !alias || alias.toLowerCase() === name.toLowerCase()) return null;
      return row.fork === false ? { name, alias } : { name, alias, fork: true };
    })
    .filter(Boolean) as OAuthModelAliasEntry[];
}

export function configToProviderModels(config: AuthFileModelsConfigResponse): AuthFileModelItem[] {
  return config.rows.map((row) => ({
    id: row.id,
    display_name: row.display_name,
    type: row.type,
    owned_by: row.owned_by,
  }));
}

export function buildProviderModelAliasMap(
  entries: Record<string, ProviderModelsConfigEntry>
): Record<string, OAuthModelAliasEntry[]> {
  const result: Record<string, OAuthModelAliasEntry[]> = {};
  Object.entries(entries).forEach(([provider, entry]) => {
    const aliases = configToModelAliasEntries(entry.config);
    if (aliases.length > 0) {
      result[provider] = aliases;
    }
  });
  return result;
}

export function buildProviderModelsMap(
  entries: Record<string, ProviderModelsConfigEntry>
): Record<string, AuthFileModelItem[]> {
  const result: Record<string, AuthFileModelItem[]> = {};
  Object.entries(entries).forEach(([provider, entry]) => {
    if (entry.config.rows.length > 0) {
      result[provider] = configToProviderModels(entry.config);
    }
  });
  return result;
}

export function cloneConfigRows(rows: AuthFileModelConfigRow[]): AuthFileModelConfigRow[] {
  return rows.map((row) => ({ ...row }));
}

export function updateRowAlias(
  rows: AuthFileModelConfigRow[],
  modelId: string,
  alias: string,
  fork = true
): AuthFileModelConfigRow[] {
  const key = modelId.trim().toLowerCase();
  const aliasTrim = alias.trim();
  let found = false;

  const next = rows.map((row) => {
    if (row.id.trim().toLowerCase() !== key) return row;
    found = true;
    return {
      ...row,
      alias: aliasTrim,
      fork,
    };
  });

  if (!found && aliasTrim) {
    next.push({
      id: modelId.trim(),
      alias: aliasTrim,
      fork,
      available: false,
      disabled: false,
    });
  }

  return next;
}

export function clearProviderAliases(rows: AuthFileModelConfigRow[]): AuthFileModelConfigRow[] {
  return rows.map((row) => ({ ...row, alias: '' }));
}

export function removeAliasLink(
  rows: AuthFileModelConfigRow[],
  sourceModel: string,
  alias: string
): AuthFileModelConfigRow[] {
  const nameKey = sourceModel.trim().toLowerCase();
  const aliasKey = alias.trim().toLowerCase();

  return rows.map((row) => {
    const rowName = row.id.trim().toLowerCase();
    const rowAlias = String(row.alias ?? '')
      .trim()
      .toLowerCase();
    if (rowName === nameKey && rowAlias === aliasKey) {
      return { ...row, alias: '' };
    }
    return row;
  });
}

export function toggleRowFork(
  rows: AuthFileModelConfigRow[],
  sourceModel: string,
  alias: string,
  fork: boolean
): AuthFileModelConfigRow[] {
  const nameKey = sourceModel.trim().toLowerCase();
  const aliasKey = alias.trim().toLowerCase();

  return rows.map((row) => {
    const rowName = row.id.trim().toLowerCase();
    const rowAlias = String(row.alias ?? '')
      .trim()
      .toLowerCase();
    if (rowName !== nameKey || rowAlias !== aliasKey) return row;
    return fork ? { ...row, fork: true } : { ...row, fork: false };
  });
}

export function renameAliasInRows(
  rows: AuthFileModelConfigRow[],
  oldAlias: string,
  newAlias: string
): AuthFileModelConfigRow[] {
  const oldKey = oldAlias.trim().toLowerCase();
  const newTrim = newAlias.trim();
  if (!oldKey || !newTrim) return rows;

  return rows.map((row) => {
    const rowAlias = String(row.alias ?? '').trim();
    if (rowAlias.toLowerCase() !== oldKey) return row;
    return { ...row, alias: newTrim };
  });
}

export function removeAliasNameFromRows(
  rows: AuthFileModelConfigRow[],
  aliasName: string
): AuthFileModelConfigRow[] {
  const aliasKey = aliasName.trim().toLowerCase();
  if (!aliasKey) return rows;

  return rows.map((row) => {
    const rowAlias = String(row.alias ?? '').trim();
    if (rowAlias.toLowerCase() !== aliasKey) return row;
    return { ...row, alias: '' };
  });
}

export function applyAliasEntriesToRows(
  rows: AuthFileModelConfigRow[],
  entries: OAuthModelAliasEntry[]
): AuthFileModelConfigRow[] {
  const aliasByName = new Map<string, OAuthModelAliasEntry>();
  entries.forEach((entry) => {
    const key = String(entry.name ?? '')
      .trim()
      .toLowerCase();
    if (key) aliasByName.set(key, entry);
  });

  const seen = new Set<string>();
  const next = rows.map((row) => {
    const key = row.id.trim().toLowerCase();
    seen.add(key);
    const entry = aliasByName.get(key);
    if (!entry) {
      return { ...row, alias: '' };
    }
    return {
      ...row,
      alias: String(entry.alias ?? '').trim(),
      fork: entry.fork !== false,
    };
  });

  entries.forEach((entry) => {
    const id = String(entry.name ?? '').trim();
    const key = id.toLowerCase();
    if (!id || seen.has(key)) return;
    next.push({
      id,
      alias: String(entry.alias ?? '').trim(),
      fork: entry.fork !== false,
      available: false,
      disabled: false,
    });
  });

  return next;
}
