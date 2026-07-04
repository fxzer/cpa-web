import type {
  AmpcodeConfig,
  AmpcodeModelMapping,
  AmpcodeUpstreamApiKeyMapping,
  ApiKeyEntry,
  OpenAIProviderConfig,
} from '@/types';
import {
  buildRecentRequestCompositeKey,
  mergeRecentRequestBucketGroups,
  normalizeRecentRequestAuthIndex,
  statusBarDataFromRecentRequests,
  sumRecentRequests,
  type RecentRequestBucket,
  type RecentRequestUsageEntry,
  type StatusBarData,
} from '@/utils/recentRequests';
import { maskApiKey } from '@/utils/format';
import { areKeyValueEntriesEqual } from '@/utils/compare';
import { buildHeaderObject, headersToEntries } from '@/utils/headers';
import type { AmpcodeFormState, AmpcodeUpstreamApiKeyEntry, ModelEntry } from './types';

export const DISABLE_ALL_MODELS_RULE = '*';

export const hasDisableAllModelsRule = (models?: string[]) =>
  Array.isArray(models) &&
  models.some((model) => String(model ?? '').trim() === DISABLE_ALL_MODELS_RULE);

export const stripDisableAllModelsRule = (models?: string[]) =>
  Array.isArray(models)
    ? models.filter((model) => String(model ?? '').trim() !== DISABLE_ALL_MODELS_RULE)
    : [];

export const withDisableAllModelsRule = (models?: string[]) => {
  const base = stripDisableAllModelsRule(models);
  return [...base, DISABLE_ALL_MODELS_RULE];
};

export const withoutDisableAllModelsRule = (models?: string[]) => {
  const base = stripDisableAllModelsRule(models);
  return base;
};

export const parseTextList = (text: string): string[] =>
  text
    .split(/[\n,]+/)
    .map((item) => item.trim())
    .filter(Boolean);

export const parseExcludedModels = parseTextList;

export const excludedModelsToText = (models?: string[]) =>
  Array.isArray(models) ? models.join('\n') : '';

export const getProviderApiKeyEntries = (config: {
  apiKeyEntries?: ApiKeyEntry[];
}): ApiKeyEntry[] => (Array.isArray(config.apiKeyEntries) ? config.apiKeyEntries : []);

export const getPrimaryApiKey = (config: { apiKeyEntries?: ApiKeyEntry[] }): string => {
  const entry = getProviderApiKeyEntries(config).find((item) => String(item.apiKey ?? '').trim());
  return entry?.apiKey?.trim() ?? '';
};

type ProviderLabelInput = {
  prefix?: string;
  apiKey?: string;
  apiKeyEntries?: ApiKeyEntry[];
  baseUrl?: string;
  name?: string;
};

/** 供应商列表卡片等场景：prefix 优先（路由标识更直观） */
export function buildProviderOverviewLabel(item: ProviderLabelInput, fallback: string): string {
  const prefix = String(item.prefix ?? '').trim();
  if (prefix) return prefix;
  const name = String(item.name ?? '').trim();
  if (name) return name;
  const apiKey = getPrimaryApiKey(item) || String(item.apiKey ?? '').trim();
  if (apiKey) return maskApiKey(apiKey);
  const baseUrl = String(item.baseUrl ?? '').trim();
  if (baseUrl) return baseUrl;
  return fallback;
}

/** 请求明细「供应商 / 模型」列：name 优先（展示名更直观） */
export function buildProviderRequestLabel(item: ProviderLabelInput, fallback: string): string {
  const name = String(item.name ?? '').trim();
  if (name) return name;
  const prefix = String(item.prefix ?? '').trim();
  if (prefix) return prefix;
  const apiKey = getPrimaryApiKey(item) || String(item.apiKey ?? '').trim();
  if (apiKey) return maskApiKey(apiKey);
  const baseUrl = String(item.baseUrl ?? '').trim();
  if (baseUrl) return baseUrl;
  return fallback;
}

export const normalizeOpenAIBaseUrl = (baseUrl: string): string => {
  let trimmed = String(baseUrl || '').trim();
  if (!trimmed) return '';
  trimmed = trimmed.replace(/\/?v0\/management\/?$/i, '');
  trimmed = trimmed.replace(/\/+$/g, '');
  if (!/^https?:\/\//i.test(trimmed)) {
    trimmed = `http://${trimmed}`;
  }
  return trimmed;
};

export const normalizeClaudeBaseUrl = (baseUrl: string): string => {
  let trimmed = String(baseUrl || '').trim();
  if (!trimmed) {
    return 'https://api.anthropic.com';
  }
  trimmed = trimmed.replace(/\/?v0\/management\/?$/i, '');
  trimmed = trimmed.replace(/\/+$/g, '');
  if (!/^https?:\/\//i.test(trimmed)) {
    trimmed = `http://${trimmed}`;
  }
  return trimmed;
};

export const buildOpenAIModelsEndpoint = (baseUrl: string): string => {
  const trimmed = normalizeOpenAIBaseUrl(baseUrl);
  if (!trimmed) return '';
  return `${trimmed}/models`;
};

export const buildOpenAIChatCompletionsEndpoint = (baseUrl: string): string => {
  const trimmed = normalizeOpenAIBaseUrl(baseUrl);
  if (!trimmed) return '';
  if (trimmed.endsWith('/chat/completions')) {
    return trimmed;
  }
  return `${trimmed}/chat/completions`;
};

export const buildClaudeMessagesEndpoint = (baseUrl: string): string => {
  const trimmed = normalizeClaudeBaseUrl(baseUrl);
  if (!trimmed) return '';
  if (trimmed.endsWith('/v1/messages')) {
    return trimmed;
  }
  if (trimmed.endsWith('/v1')) {
    return `${trimmed}/messages`;
  }
  return `${trimmed}/v1/messages`;
};

const DEFAULT_GEMINI_BASE_URL = 'https://generativelanguage.googleapis.com';

export const normalizeGeminiBaseUrl = (baseUrl: string): string => {
  let trimmed = String(baseUrl || '').trim();
  if (!trimmed) {
    return DEFAULT_GEMINI_BASE_URL;
  }
  trimmed = trimmed.replace(/\/?v0\/management\/?$/i, '');
  trimmed = trimmed.replace(/\/+$/g, '');
  if (!/^https?:\/\//i.test(trimmed)) {
    trimmed = `http://${trimmed}`;
  }
  return trimmed;
};

export const stripGeminiModelResourceName = (value: string): string => {
  return String(value ?? '')
    .trim()
    .replace(/^\/?models\//i, '');
};

export const buildGeminiModelsEndpoint = (baseUrl: string): string => {
  let trimmed = normalizeGeminiBaseUrl(baseUrl).replace(/\/+$/g, '');
  trimmed = trimmed.replace(/\/v1beta\/models$/i, '');
  trimmed = trimmed.replace(/\/v1beta(?:\/.*)?$/i, '');
  return `${trimmed}/v1beta/models`;
};

export const buildGeminiGenerateContentEndpoint = (baseUrl: string, modelName: string): string => {
  const trimmed = normalizeGeminiBaseUrl(baseUrl).replace(/\/+$/g, '');
  const model = stripGeminiModelResourceName(modelName);
  if (!trimmed || !model) return '';
  return `${trimmed}/v1beta/models/${encodeURIComponent(model)}:generateContent`;
};

export type ProviderRecentUsageMap = Map<string, Map<string, RecentRequestUsageEntry>>;

const EMPTY_RECENT_USAGE_ENTRY: RecentRequestUsageEntry = {
  success: 0,
  failed: 0,
  recentRequests: [],
};

const normalizeProviderRecentKey = (value: unknown): string =>
  String(value ?? '')
    .trim()
    .toLowerCase();

export function getProviderRecentUsageEntry(
  usageByProvider: ProviderRecentUsageMap,
  provider: string,
  apiKey?: string,
  baseUrl?: string
): RecentRequestUsageEntry {
  if (!String(apiKey ?? '').trim()) {
    return EMPTY_RECENT_USAGE_ENTRY;
  }

  const providerKey = normalizeProviderRecentKey(provider);
  const compositeKey = buildRecentRequestCompositeKey(baseUrl, apiKey);
  return usageByProvider.get(providerKey)?.get(compositeKey) ?? EMPTY_RECENT_USAGE_ENTRY;
}

export function getProviderRecentBuckets(
  usageByProvider: ProviderRecentUsageMap,
  provider: string,
  apiKey?: string,
  baseUrl?: string
): RecentRequestBucket[] {
  return getProviderRecentUsageEntry(usageByProvider, provider, apiKey, baseUrl).recentRequests;
}

export function getProviderTotalStats(
  usageByProvider: ProviderRecentUsageMap,
  provider: string,
  apiKey?: string,
  baseUrl?: string
): { success: number; failure: number } {
  const entry = getProviderRecentUsageEntry(usageByProvider, provider, apiKey, baseUrl);
  return { success: entry.success, failure: entry.failed };
}

export function getProviderRecentWindowStats(
  usageByProvider: ProviderRecentUsageMap,
  provider: string,
  apiKey?: string,
  baseUrl?: string
): { success: number; failure: number } {
  return sumRecentRequests(getProviderRecentBuckets(usageByProvider, provider, apiKey, baseUrl));
}

export function getProviderRecentStats(
  usageByProvider: ProviderRecentUsageMap,
  provider: string,
  apiKey?: string,
  baseUrl?: string
): { success: number; failure: number } {
  return getProviderTotalStats(usageByProvider, provider, apiKey, baseUrl);
}

export function getProviderRecentStatusData(
  usageByProvider: ProviderRecentUsageMap,
  provider: string,
  apiKey?: string,
  baseUrl?: string
): StatusBarData {
  return statusBarDataFromRecentRequests(
    getProviderRecentBuckets(usageByProvider, provider, apiKey, baseUrl)
  );
}

export function collectProviderKeyConfigRecentBuckets(
  provider: string,
  config: { apiKeyEntries?: ApiKeyEntry[]; baseUrl?: string },
  usageByProvider: ProviderRecentUsageMap
): RecentRequestBucket[] {
  const entries = getProviderApiKeyEntries(config);
  if (!entries.length) {
    return [];
  }

  const groups = entries.map((entry) =>
    getProviderRecentBuckets(usageByProvider, provider, entry.apiKey, config.baseUrl)
  );

  return mergeRecentRequestBucketGroups(groups);
}

export function getProviderKeyConfigRecentStats(
  provider: string,
  config: { apiKeyEntries?: ApiKeyEntry[]; baseUrl?: string },
  usageByProvider: ProviderRecentUsageMap
): { success: number; failure: number } {
  return getProviderApiKeyEntries(config).reduce(
    (total, entry) => {
      const usageEntry = getProviderRecentUsageEntry(
        usageByProvider,
        provider,
        entry.apiKey,
        config.baseUrl
      );

      return {
        success: total.success + usageEntry.success,
        failure: total.failure + usageEntry.failed,
      };
    },
    { success: 0, failure: 0 }
  );
}

export function getProviderKeyConfigRecentStatusData(
  provider: string,
  config: { apiKeyEntries?: ApiKeyEntry[]; baseUrl?: string },
  usageByProvider: ProviderRecentUsageMap
): StatusBarData {
  return statusBarDataFromRecentRequests(
    collectProviderKeyConfigRecentBuckets(provider, config, usageByProvider)
  );
}

export function collectOpenAIProviderRecentBuckets(
  provider: OpenAIProviderConfig,
  usageByProvider: ProviderRecentUsageMap
): RecentRequestBucket[] {
  if (!provider.apiKeyEntries?.length) {
    return [];
  }

  const groups = provider.apiKeyEntries.map((entry) =>
    getProviderRecentBuckets(usageByProvider, provider.name, entry.apiKey, provider.baseUrl)
  );

  return mergeRecentRequestBucketGroups(groups);
}

export function getOpenAIProviderRecentStats(
  provider: OpenAIProviderConfig,
  usageByProvider: ProviderRecentUsageMap
): { success: number; failure: number } {
  return getOpenAIProviderTotalStats(provider, usageByProvider);
}

export function getOpenAIProviderTotalStats(
  provider: OpenAIProviderConfig,
  usageByProvider: ProviderRecentUsageMap
): { success: number; failure: number } {
  return (provider.apiKeyEntries || []).reduce(
    (total, entry) => {
      const usageEntry = getProviderRecentUsageEntry(
        usageByProvider,
        provider.name,
        entry.apiKey,
        provider.baseUrl
      );

      return {
        success: total.success + usageEntry.success,
        failure: total.failure + usageEntry.failed,
      };
    },
    { success: 0, failure: 0 }
  );
}

export function getOpenAIProviderRecentWindowStats(
  provider: OpenAIProviderConfig,
  usageByProvider: ProviderRecentUsageMap
): { success: number; failure: number } {
  return sumRecentRequests(collectOpenAIProviderRecentBuckets(provider, usageByProvider));
}

export function getOpenAIProviderRecentStatusData(
  provider: OpenAIProviderConfig,
  usageByProvider: ProviderRecentUsageMap
): StatusBarData {
  return statusBarDataFromRecentRequests(
    collectOpenAIProviderRecentBuckets(provider, usageByProvider)
  );
}

export const getProviderConfigKey = (
  config: {
    authIndex?: unknown;
    baseUrl?: string;
    prefix?: string;
  },
  index: number
): string => {
  const authIndexKey = normalizeRecentRequestAuthIndex(config.authIndex);
  if (authIndexKey) {
    return authIndexKey;
  }
  return `${config.baseUrl ?? ''}::${config.prefix ?? ''}::${index}`;
};

export const getProviderApiKeyEntryKey = (entry: ApiKeyEntry, index: number): string => {
  const authIndexKey = normalizeRecentRequestAuthIndex(entry.authIndex);
  if (authIndexKey) {
    return authIndexKey;
  }
  return `${entry.apiKey}::${entry.proxyUrl ?? ''}::${entry.remark ?? ''}::${index}`;
};

export const getOpenAIProviderKey = (provider: OpenAIProviderConfig, index: number): string => {
  const authIndexKey = normalizeRecentRequestAuthIndex(provider.authIndex);
  if (authIndexKey) {
    return authIndexKey;
  }
  return `${provider.name}::${provider.baseUrl}::${provider.prefix ?? ''}::${index}`;
};

export const getOpenAIEntryKey = (entry: ApiKeyEntry, index: number): string => {
  const authIndexKey = normalizeRecentRequestAuthIndex(entry.authIndex);
  if (authIndexKey) {
    return authIndexKey;
  }
  return `${entry.apiKey}::${entry.proxyUrl ?? ''}::${entry.remark ?? ''}::${index}`;
};

export const buildApiKeyEntry = (input?: Partial<ApiKeyEntry>): ApiKeyEntry => ({
  apiKey: input?.apiKey ?? '',
  proxyUrl: input?.proxyUrl ?? '',
  remark: input?.remark ?? '',
  headers: input?.headers ?? {},
});

const normalizeKeyHeaders = (headers?: Record<string, string>) => {
  if (!headers || !Object.keys(headers).length) return [];
  return headersToEntries(headers)
    .filter((entry) => entry.key || entry.value)
    .sort((a, b) => {
      const byKey = a.key.toLowerCase().localeCompare(b.key.toLowerCase());
      if (byKey !== 0) return byKey;
      return a.value.localeCompare(b.value);
    });
};

export const normalizeApiKeyEntriesForBaseline = (entries: ApiKeyEntry[]) =>
  (entries ?? []).reduce<
    Array<{
      apiKey: string;
      proxyUrl: string;
      remark: string;
      headers: Array<{ key: string; value: string }>;
    }>
  >((acc, entry) => {
    const apiKey = String(entry?.apiKey ?? '').trim();
    const proxyUrl = String(entry?.proxyUrl ?? '').trim();
    const remark = String(entry?.remark ?? '').trim();
    const headers = normalizeKeyHeaders(entry?.headers);
    if (!apiKey && !proxyUrl && !remark && headers.length === 0) return acc;
    acc.push({ apiKey, proxyUrl, remark, headers });
    return acc;
  }, []);

export const areNormalizedApiKeyEntriesEqual = (
  a: ReturnType<typeof normalizeApiKeyEntriesForBaseline>,
  b: ReturnType<typeof normalizeApiKeyEntriesForBaseline>
) => {
  if (a === b) return true;
  if (a.length !== b.length) return false;
  for (let i = 0; i < a.length; i += 1) {
    const left = a[i];
    const right = b[i];
    if (!left || !right) return false;
    if (left.apiKey !== right.apiKey || left.proxyUrl !== right.proxyUrl || left.remark !== right.remark) return false;
    if (!areKeyValueEntriesEqual(left.headers, right.headers)) return false;
  }
  return true;
};

export const serializeApiKeyEntriesForSave = (entries: ApiKeyEntry[]): ApiKeyEntry[] =>
  normalizeApiKeyEntriesForBaseline(entries).map((entry) => ({
    apiKey: entry.apiKey,
    proxyUrl: entry.proxyUrl || undefined,
    remark: entry.remark || undefined,
    headers: buildHeaderObject(entry.headers),
  }));

export const ampcodeMappingsToEntries = (mappings?: AmpcodeModelMapping[]): ModelEntry[] => {
  if (!Array.isArray(mappings) || mappings.length === 0) {
    return [{ name: '', alias: '' }];
  }
  return mappings.map((mapping) => ({
    name: mapping.from ?? '',
    alias: mapping.to ?? '',
  }));
};

export const entriesToAmpcodeMappings = (entries: ModelEntry[]): AmpcodeModelMapping[] => {
  const seen = new Set<string>();
  const mappings: AmpcodeModelMapping[] = [];

  entries.forEach((entry) => {
    const from = entry.name.trim();
    const to = entry.alias.trim();
    if (!from || !to) return;
    const key = from.toLowerCase();
    if (seen.has(key)) return;
    seen.add(key);
    mappings.push({ from, to });
  });

  return mappings;
};

export const ampcodeUpstreamApiKeysToEntries = (
  mappings?: AmpcodeUpstreamApiKeyMapping[]
): AmpcodeUpstreamApiKeyEntry[] => {
  if (!Array.isArray(mappings) || mappings.length === 0) {
    return [{ upstreamApiKey: '', clientApiKeysText: '' }];
  }

  return mappings.map((mapping) => ({
    upstreamApiKey: mapping.upstreamApiKey ?? '',
    clientApiKeysText: Array.isArray(mapping.apiKeys) ? mapping.apiKeys.join('\n') : '',
  }));
};

export const entriesToAmpcodeUpstreamApiKeys = (
  entries: AmpcodeUpstreamApiKeyEntry[]
): AmpcodeUpstreamApiKeyMapping[] => {
  const seen = new Set<string>();
  const mappings: AmpcodeUpstreamApiKeyMapping[] = [];

  entries.forEach((entry) => {
    const upstreamApiKey = String(entry?.upstreamApiKey ?? '').trim();
    if (!upstreamApiKey || seen.has(upstreamApiKey)) return;

    const apiKeys = Array.from(new Set(parseTextList(String(entry?.clientApiKeysText ?? ''))));
    if (!apiKeys.length) return;

    seen.add(upstreamApiKey);
    mappings.push({ upstreamApiKey, apiKeys });
  });

  return mappings;
};

export const buildAmpcodeFormState = (ampcode?: AmpcodeConfig | null): AmpcodeFormState => ({
  upstreamUrl: ampcode?.upstreamUrl ?? '',
  upstreamApiKey: '',
  forceModelMappings: ampcode?.forceModelMappings ?? false,
  mappingEntries: ampcodeMappingsToEntries(ampcode?.modelMappings),
  upstreamApiKeyEntries: ampcodeUpstreamApiKeysToEntries(ampcode?.upstreamApiKeys),
});
