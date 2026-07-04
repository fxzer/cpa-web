import type { Config } from '@/types';
import type { OAuthModelAliasEntry } from '@/types/oauth';
import type { ModelAlias } from '@/types/provider';
import type { AuthFileModelItem } from '@/features/authFiles/constants';
import {
  isDistinctOAuthModelAlias,
  resolveOAuthModelAliasChannel,
} from '@/utils/oauthModelAliasForm';

const collectAliasesFromModels = (models?: ModelAlias[]): string[] => {
  if (!models?.length) return [];

  const seen = new Set<string>();
  const result: string[] = [];

  models.forEach((model) => {
    const name = String(model.name ?? '').trim();
    const alias = String(model.alias ?? '').trim();
    if (!isDistinctOAuthModelAlias(name, alias)) return;

    const key = alias.toLowerCase();
    if (seen.has(key)) return;
    seen.add(key);
    result.push(alias);
  });

  return result;
};

/** Collect deduplicated alias names from ALL providers in the config (flattened, not keyed by channel). */
export function collectAllProviderAliases(config: Config | null | undefined): string[] {
  if (!config) return [];

  const seen = new Set<string>();
  const result: string[] = [];
  const pushAliases = (aliases: string[]) => {
    aliases.forEach((alias) => {
      const key = alias.toLowerCase();
      if (seen.has(key)) return;
      seen.add(key);
      result.push(alias);
    });
  };

  (config.geminiApiKeys ?? []).forEach((entry) => pushAliases(collectAliasesFromModels(entry.models)));
  (config.codexApiKeys ?? []).forEach((entry) => pushAliases(collectAliasesFromModels(entry.models)));
  (config.claudeApiKeys ?? []).forEach((entry) => pushAliases(collectAliasesFromModels(entry.models)));
  (config.vertexApiKeys ?? []).forEach((entry) => pushAliases(collectAliasesFromModels(entry.models)));
  (config.openaiCompatibility ?? []).forEach((entry) =>
    pushAliases(collectAliasesFromModels(entry.models))
  );

  return result;
}

const mergeChannelAliases = (
  target: Record<string, string[]>,
  channel: string,
  aliases: string[]
) => {
  if (!aliases.length) return;

  const normalizedChannel = resolveOAuthModelAliasChannel(channel);
  if (!normalizedChannel) return;

  const bucket = target[normalizedChannel] ?? [];
  const seen = new Set(bucket.map((alias) => alias.toLowerCase()));

  aliases.forEach((alias) => {
    const key = alias.toLowerCase();
    if (seen.has(key)) return;
    seen.add(key);
    bucket.push(alias);
  });

  if (bucket.length > 0) {
    target[normalizedChannel] = bucket;
  }
};

/** Collect deduplicated alias names from AI provider key configs, keyed by oauth-model-alias channel. */
export function collectProviderAliasSeeds(
  config: Config | null | undefined
): Record<string, string[]> {
  const result: Record<string, string[]> = {};
  if (!config) return result;

  (config.geminiApiKeys ?? []).forEach((entry) => {
    mergeChannelAliases(result, 'gemini-cli', collectAliasesFromModels(entry.models));
  });
  (config.codexApiKeys ?? []).forEach((entry) => {
    mergeChannelAliases(result, 'codex', collectAliasesFromModels(entry.models));
  });
  (config.claudeApiKeys ?? []).forEach((entry) => {
    mergeChannelAliases(result, 'claude', collectAliasesFromModels(entry.models));
  });
  (config.vertexApiKeys ?? []).forEach((entry) => {
    mergeChannelAliases(result, 'vertex', collectAliasesFromModels(entry.models));
  });

  return result;
}

export const AI_PROVIDER_ALIAS_CHANNEL = {
  gemini: 'gemini-cli',
  codex: 'codex',
  claude: 'claude',
  vertex: 'vertex',
} as const;

export function buildProviderCardAliasDiagramData(
  providerKey: string,
  models?: ModelAlias[]
): {
  modelAlias: Record<string, OAuthModelAliasEntry[]>;
  allProviderModels: Record<string, AuthFileModelItem[]>;
  providerAliasSeeds: Record<string, string[]>;
} {
  const channel = String(providerKey ?? '').trim();
  const normalizedModels = (models ?? [])
    .map((model) => ({
      name: String(model.name ?? '').trim(),
      alias: String(model.alias ?? '').trim(),
    }))
    .filter((model) => model.name);

  const aliasEntries = normalizedModels
    .filter((model) => isDistinctOAuthModelAlias(model.name, model.alias))
    .map((model) => ({ name: model.name, alias: model.alias }));

  return {
    modelAlias: aliasEntries.length > 0 ? { [channel]: aliasEntries } : {},
    allProviderModels: {
      [channel]: normalizedModels.map((model) => ({
        id: model.name,
        ...(model.alias ? { display_name: model.alias } : {}),
      })),
    },
    providerAliasSeeds: {},
  };
}

function mergeChannelModels(
  target: Record<string, OAuthModelAliasEntry[]>,
  channel: string,
  models: ModelAlias[]
) {
  if (!models.length) return;
  const bucket = target[channel] ?? [];
  const seen = new Set(bucket.map((e) => `${e.name}|${e.alias}`.toLowerCase()));
  models.forEach((model) => {
    const name = String(model.name ?? '').trim();
    const alias = String(model.alias ?? '').trim();
    if (!name || !alias) return;
    if (!isDistinctOAuthModelAlias(name, alias)) return;
    const key = `${name}|${alias}`.toLowerCase();
    if (seen.has(key)) return;
    seen.add(key);
    bucket.push({ name, alias });
  });
  if (bucket.length > 0) target[channel] = bucket;
}

function mergeChannelProviderModels(
  target: Record<string, AuthFileModelItem[]>,
  channel: string,
  models: ModelAlias[]
) {
  if (!models.length) return;
  const bucket = target[channel] ?? [];
  const seen = new Set(bucket.map((m) => m.id.toLowerCase()));
  models.forEach((model) => {
    const name = String(model.name ?? '').trim();
    if (!name) return;
    const key = name.toLowerCase();
    if (seen.has(key)) return;
    seen.add(key);
    const alias = String(model.alias ?? '').trim();
    bucket.push({
      id: name,
      ...(alias && alias !== name ? { display_name: alias } : {}),
    });
  });
  if (bucket.length > 0) target[channel] = bucket;
}

/** Build alias diagram data from ALL providers in the config for the global routing mind map. */
export function buildGlobalAliasDiagramData(
  config: Config | null
): {
  modelAlias: Record<string, OAuthModelAliasEntry[]>;
  allProviderModels: Record<string, AuthFileModelItem[]>;
  providerAliasSeeds: Record<string, string[]>;
} {
  const modelAlias: Record<string, OAuthModelAliasEntry[]> = {};
  const allProviderModels: Record<string, AuthFileModelItem[]> = {};

  if (!config) return { modelAlias, allProviderModels, providerAliasSeeds: {} };

  (config.geminiApiKeys ?? []).forEach((entry) => {
    mergeChannelModels(modelAlias, 'gemini-cli', entry.models ?? []);
    mergeChannelProviderModels(allProviderModels, 'gemini-cli', entry.models ?? []);
  });
  (config.codexApiKeys ?? []).forEach((entry) => {
    mergeChannelModels(modelAlias, 'codex', entry.models ?? []);
    mergeChannelProviderModels(allProviderModels, 'codex', entry.models ?? []);
  });
  (config.claudeApiKeys ?? []).forEach((entry) => {
    mergeChannelModels(modelAlias, 'claude', entry.models ?? []);
    mergeChannelProviderModels(allProviderModels, 'claude', entry.models ?? []);
  });
  (config.vertexApiKeys ?? []).forEach((entry) => {
    mergeChannelModels(modelAlias, 'vertex', entry.models ?? []);
    mergeChannelProviderModels(allProviderModels, 'vertex', entry.models ?? []);
  });
  (config.openaiCompatibility ?? []).forEach((entry) => {
    const channel = String(entry.name ?? entry.baseUrl ?? 'openai').trim().toLowerCase();
    mergeChannelModels(modelAlias, channel, entry.models ?? []);
    mergeChannelProviderModels(allProviderModels, channel, entry.models ?? []);
  });

  return { modelAlias, allProviderModels, providerAliasSeeds: {} };
}
