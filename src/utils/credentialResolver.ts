import type {
  ApiKeyEntry,
  GeminiKeyConfig,
  OpenAIProviderConfig,
  ProviderKeyConfig,
} from '@/types';
import {
  buildProviderOverviewLabel,
  buildProviderRequestLabel,
  getProviderApiKeyEntries,
} from '@/components/providers/utils';
import { sha256Hex } from '@/utils/apiKeyHash';
import {
  buildCandidateUsageSourceIds,
  computeUsageSourceKeyFingerprint,
  normalizeAuthIndex,
  normalizeUsageSourceId,
} from '@/utils/usage';

export interface ConfiguredCredential {
  apiKey: string;
  providerLabel: string;
  /** 请求明细「供应商 / 模型」列：name → prefix 降级 */
  requestLabel: string;
  providerType: 'openai' | 'gemini' | 'codex' | 'claude' | 'vertex';
}

export interface ConfiguredCredentialLookup {
  byAuthIndex: Map<string, ConfiguredCredential>;
  bySha256: Map<string, ConfiguredCredential>;
  byFnvHex: Map<string, ConfiguredCredential>;
  bySourceId: Map<string, ConfiguredCredential>;
  all: ConfiguredCredential[];
}

export interface SourceInfoMapInput {
  geminiApiKeys?: GeminiKeyConfig[];
  claudeApiKeys?: ProviderKeyConfig[];
  codexApiKeys?: ProviderKeyConfig[];
  vertexApiKeys?: ProviderKeyConfig[];
  openaiCompatibility?: OpenAIProviderConfig[];
}

const registerCredential = (
  lookup: ConfiguredCredentialLookup,
  credential: ConfiguredCredential,
  authIndex?: string | null,
  sourceIds?: Iterable<string>
) => {
  lookup.all.push(credential);

  const authIndexKey = normalizeAuthIndex(authIndex);
  if (authIndexKey && !lookup.byAuthIndex.has(authIndexKey)) {
    lookup.byAuthIndex.set(authIndexKey, credential);
  }

  const apiKey = credential.apiKey.trim();
  if (!apiKey) return;

  const sha256 = sha256Hex(apiKey).toLowerCase();
  if (sha256 && !lookup.bySha256.has(sha256)) {
    lookup.bySha256.set(sha256, credential);
  }

  const fnvHex = computeUsageSourceKeyFingerprint(apiKey).toLowerCase();
  if (fnvHex && !lookup.byFnvHex.has(fnvHex)) {
    lookup.byFnvHex.set(fnvHex, credential);
  }

  const candidates = sourceIds ? Array.from(sourceIds) : buildCandidateUsageSourceIds({ apiKey });
  candidates.forEach((sourceId) => {
    const normalized = normalizeUsageSourceId(sourceId);
    if (normalized && !lookup.bySourceId.has(normalized)) {
      lookup.bySourceId.set(normalized, credential);
    }
  });
};

const createLookup = (): ConfiguredCredentialLookup => ({
  byAuthIndex: new Map(),
  bySha256: new Map(),
  byFnvHex: new Map(),
  bySourceId: new Map(),
  all: [],
});

/** Build lookup tables from configured provider API keys for request-detail credential resolution. */
export function buildConfiguredCredentialLookup(
  input: SourceInfoMapInput
): ConfiguredCredentialLookup {
  const lookup = createLookup();

  const registerProviderKeyEntries = (
    entries: ApiKeyEntry[],
    type: ConfiguredCredential['providerType'],
    providerLabel: string,
    requestLabel: string,
    prefix?: string
  ) => {
    entries.forEach((entry) => {
      const apiKey = entry.apiKey?.trim();
      if (!apiKey) return;
      registerCredential(
        lookup,
        {
          apiKey,
          providerLabel,
          requestLabel,
          providerType: type,
        },
        entry.authIndex,
        buildCandidateUsageSourceIds({ apiKey, prefix })
      );
    });
  };

  const providerGroups: Array<{
    items: Array<{
      apiKeyEntries?: ApiKeyEntry[];
      authIndex?: string;
      prefix?: string;
      name?: string;
      baseUrl?: string;
    }>;
    type: ConfiguredCredential['providerType'];
    fallbackLabel: (index: number) => string;
  }> = [
    {
      items: input.geminiApiKeys || [],
      type: 'gemini',
      fallbackLabel: (index) => `Gemini #${index + 1}`,
    },
    {
      items: input.claudeApiKeys || [],
      type: 'claude',
      fallbackLabel: (index) => `Claude #${index + 1}`,
    },
    {
      items: input.codexApiKeys || [],
      type: 'codex',
      fallbackLabel: (index) => `Codex #${index + 1}`,
    },
    {
      items: input.vertexApiKeys || [],
      type: 'vertex',
      fallbackLabel: (index) => `Vertex #${index + 1}`,
    },
  ];

  providerGroups.forEach(({ items, type, fallbackLabel }) => {
    items.forEach((item, index) => {
      const fallback = fallbackLabel(index);
      registerProviderKeyEntries(
        getProviderApiKeyEntries(item),
        type,
        buildProviderOverviewLabel(item, fallback),
        buildProviderRequestLabel(item, fallback),
        item.prefix
      );
    });
  });

  (input.openaiCompatibility || []).forEach((provider, index) => {
    const fallback = `OpenAI #${index + 1}`;
    const providerLabel = buildProviderOverviewLabel(provider, fallback);
    const requestLabel = buildProviderRequestLabel(provider, fallback);
    (provider.apiKeyEntries || []).forEach((entry) => {
      const apiKey = entry.apiKey?.trim();
      if (!apiKey) return;
      registerCredential(
        lookup,
        {
          apiKey,
          providerLabel,
          requestLabel,
          providerType: 'openai',
        },
        entry.authIndex,
        buildCandidateUsageSourceIds({ apiKey, prefix: provider.prefix })
      );
    });
  });

  return lookup;
}

const matchMaskedApiKeySource = (
  source: string,
  lookup: ConfiguredCredentialLookup
): ConfiguredCredential | null => {
  const masked = source.startsWith('m:') ? source.slice(2) : source;
  const parts = masked.split(/\.{2,}|…/);
  if (parts.length !== 2) return null;

  const prefix = parts[0]?.trim();
  const suffix = parts[1]?.trim();
  if (!prefix || !suffix) return null;

  const matches = lookup.all.filter(
    (credential) => credential.apiKey.startsWith(prefix) && credential.apiKey.endsWith(suffix)
  );
  return matches.length === 1 ? matches[0] : null;
};

export function resolveConfiguredCredential(
  lookup: ConfiguredCredentialLookup,
  input: {
    authIndex?: unknown;
    apiKeyHash?: string;
    source?: string;
  }
): ConfiguredCredential | null {
  const authIndexKey = normalizeAuthIndex(input.authIndex);
  if (authIndexKey) {
    const matched = lookup.byAuthIndex.get(authIndexKey);
    if (matched) return matched;
  }

  const hash = input.apiKeyHash?.trim().toLowerCase();
  if (hash) {
    const matched = lookup.bySha256.get(hash);
    if (matched) return matched;
  }

  const source = input.source?.trim();
  if (!source) return null;

  const normalizedSource = normalizeUsageSourceId(source);
  const matchedBySource = lookup.bySourceId.get(normalizedSource);
  if (matchedBySource) return matchedBySource;

  if (normalizedSource.startsWith('k:')) {
    const matched = lookup.byFnvHex.get(normalizedSource.slice(2).toLowerCase());
    if (matched) return matched;
  }

  if (normalizedSource.startsWith('m:')) {
    return matchMaskedApiKeySource(normalizedSource, lookup);
  }

  return null;
}

const firstText = (...values: Array<unknown>): string => {
  for (const value of values) {
    if (value === null || value === undefined) continue;
    const text = typeof value === 'string' ? value.trim() : String(value).trim();
    if (text) return text;
  }
  return '';
};

export interface ProviderModelColumnDisplay {
  tag: string;
  displayName: string;
  headline: string;
}

/** 与 AI 提供商配置页分段器 id 对齐 */
const AI_PROVIDER_CHANNEL_IDS = new Set([
  'openai',
  'gemini',
  'codex',
  'claude',
  'vertex',
  'ampcode',
]);

const parseChannelFromIdentityKey = (identityKey?: string): string => {
  const key = String(identityKey ?? '').trim();
  if (!key || key.startsWith('auth:') || key.startsWith('source:')) return '';
  const [channel] = key.split(':');
  return channel?.trim().toLowerCase() ?? '';
};

const resolveOpenAICompatChannelByName = (
  usageProvider: string,
  openaiProviderNames?: string[]
): string => {
  const normalized = usageProvider.trim().toLowerCase();
  if (!normalized) return '';
  if (openaiProviderNames?.some((name) => name.trim().toLowerCase() === normalized)) {
    return 'openai';
  }
  return '';
};

/** 请求明细「供应商 / 模型」列上行：tag 对齐 AI 提供商 / 认证文件分段器 channel */
export function resolveProviderModelColumnDisplay(input: {
  usageProvider?: string;
  resolvedCredential?: ConfiguredCredential | null;
  sourceType?: string;
  sourceIdentityKey?: string;
  authFileType?: string;
  openaiProviderNames?: string[];
  sourceDisplayName?: string;
}): ProviderModelColumnDisplay {
  const usageProvider = firstText(input.usageProvider).toLowerCase();

  let channelTag = firstText(
    input.resolvedCredential?.providerType,
    input.sourceType,
    input.authFileType,
    parseChannelFromIdentityKey(input.sourceIdentityKey)
  ).toLowerCase();

  if (!channelTag && usageProvider) {
    channelTag =
      resolveOpenAICompatChannelByName(usageProvider, input.openaiProviderNames) ||
      (AI_PROVIDER_CHANNEL_IDS.has(usageProvider) ? usageProvider : '');
  }

  const displayName = firstText(input.resolvedCredential?.requestLabel, input.sourceDisplayName);
  const normalizedName = displayName.trim();
  const showName =
    Boolean(normalizedName) && (!channelTag || normalizedName.toLowerCase() !== channelTag);

  let headline = '-';
  if (channelTag && showName) {
    headline = `${channelTag} / ${normalizedName}`;
  } else if (channelTag) {
    headline = channelTag;
  } else if (normalizedName) {
    headline = normalizedName;
  }

  return {
    tag: channelTag,
    displayName: showName ? normalizedName : '',
    headline,
  };
}

export interface CredentialDisplay {
  headline: string;
  subtitle: string;
  badge: string;
  resolvedApiKey: string;
}

const formatCredentialAuthTypeBadge = (authType: string): string => {
  const normalized = authType.trim().toLowerCase();
  if (!normalized || normalized === '-') return '';
  if (normalized === 'apikey' || normalized === 'api_key') return 'API Key';
  return authType.trim();
};

const shortAuthIndex = (authIndex: string): string => {
  const trimmed = authIndex.trim();
  if (!trimmed || trimmed === '-') return '';
  return trimmed.length > 16 ? `${trimmed.slice(0, 12)}…` : trimmed;
};

/** Build human-readable credential column text for request detail rows. */
export function buildCredentialDisplay(input: {
  accountSnapshot?: string;
  authLabelSnapshot?: string;
  authFileSnapshot?: string;
  authIndex?: string;
  authType?: string;
  source?: string;
  resolvedCredential?: ConfiguredCredential | null;
}): CredentialDisplay {
  const authLabel = firstText(input.authLabelSnapshot);
  const authFile = firstText(input.authFileSnapshot);
  const accountSnapshot = firstText(input.accountSnapshot);
  const source = firstText(input.source);
  const authIndex = firstText(input.authIndex);
  const badge = formatCredentialAuthTypeBadge(firstText(input.authType));
  const resolvedApiKey = input.resolvedCredential?.apiKey?.trim() || '';

  const credentialIdentity = firstText(authLabel, accountSnapshot, authFile, source);
  const fallbackHeadline = firstText(badge, shortAuthIndex(authIndex));

  if (resolvedApiKey) {
    const openAIProviderName = input.resolvedCredential?.providerType === 'openai'
      ? firstText(input.resolvedCredential.requestLabel, input.resolvedCredential.providerLabel)
      : '';
    const normalizedCredentialIdentity = credentialIdentity.trim().toLowerCase();
    const normalizedOpenAIProviderName = openAIProviderName.trim().toLowerCase();
    const credentialHeadline =
      normalizedOpenAIProviderName &&
      (normalizedCredentialIdentity === normalizedOpenAIProviderName ||
        normalizedCredentialIdentity === `${normalizedOpenAIProviderName} api key`)
        ? firstText(badge, shortAuthIndex(authIndex))
        : credentialIdentity || fallbackHeadline || '-';

    return {
      headline: credentialHeadline || '-',
      subtitle: resolvedApiKey,
      badge: credentialHeadline === badge ? '' : badge,
      resolvedApiKey,
    };
  }

  const oauthIdentity = firstText(authLabel, accountSnapshot, authFile);
  if (oauthIdentity) {
    const subtitle =
      authFile && authFile !== oauthIdentity
        ? authFile
        : source && source !== oauthIdentity
          ? source
          : '';
    return {
      headline: oauthIdentity,
      subtitle,
      badge,
      resolvedApiKey: '',
    };
  }

  return {
    headline: firstText(source, fallbackHeadline) || '-',
    subtitle: '',
    badge,
    resolvedApiKey: '',
  };
}
