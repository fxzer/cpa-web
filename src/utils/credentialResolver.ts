import type { ApiKeyEntry, GeminiKeyConfig, OpenAIProviderConfig, ProviderKeyConfig } from '@/types';
import { getProviderApiKeyEntries } from '@/components/providers/utils';
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
export function buildConfiguredCredentialLookup(input: SourceInfoMapInput): ConfiguredCredentialLookup {
  const lookup = createLookup();

  const registerProviderKeyEntries = (
    entries: ApiKeyEntry[],
    type: ConfiguredCredential['providerType'],
    providerLabel: string,
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
          providerType: type,
        },
        entry.authIndex,
        buildCandidateUsageSourceIds({ apiKey, prefix })
      );
    });
  };

  const providerGroups: Array<{
    items: Array<{ apiKeyEntries?: ApiKeyEntry[]; authIndex?: string; prefix?: string }>;
    type: ConfiguredCredential['providerType'];
    label: (item: { prefix?: string }, index: number) => string;
  }> = [
    {
      items: input.geminiApiKeys || [],
      type: 'gemini',
      label: (_item, index) => `Gemini #${index + 1}`,
    },
    {
      items: input.claudeApiKeys || [],
      type: 'claude',
      label: (_item, index) => `Claude #${index + 1}`,
    },
    {
      items: input.codexApiKeys || [],
      type: 'codex',
      label: (_item, index) => `Codex #${index + 1}`,
    },
    {
      items: input.vertexApiKeys || [],
      type: 'vertex',
      label: (_item, index) => `Vertex #${index + 1}`,
    },
  ];

  providerGroups.forEach(({ items, type, label }) => {
    items.forEach((item, index) => {
      registerProviderKeyEntries(
        getProviderApiKeyEntries(item),
        type,
        item.prefix?.trim() || label(item, index),
        item.prefix
      );
    });
  });

  (input.openaiCompatibility || []).forEach((provider) => {
    const providerLabel = provider.name?.trim() || 'OpenAI';
    (provider.apiKeyEntries || []).forEach((entry) => {
      const apiKey = entry.apiKey?.trim();
      if (!apiKey) return;
      registerCredential(
        lookup,
        {
          apiKey,
          providerLabel,
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
};

const firstText = (...values: Array<unknown>): string => {
  for (const value of values) {
    if (value === null || value === undefined) continue;
    const text = typeof value === 'string' ? value.trim() : String(value).trim();
    if (text) return text;
  }
  return '';
};

export interface CredentialDisplay {
  headline: string;
  subtitle: string;
  resolvedApiKey: string;
}

/** Build human-readable credential column text for request detail rows. */
export function buildCredentialDisplay(input: {
  provider?: string;
  authProviderSnapshot?: string;
  accountSnapshot?: string;
  authLabelSnapshot?: string;
  authFileSnapshot?: string;
  resolvedCredential?: ConfiguredCredential | null;
}): CredentialDisplay {
  const vendor = firstText(input.authProviderSnapshot, input.provider);
  const authLabel = firstText(input.authLabelSnapshot);
  const authFile = firstText(input.authFileSnapshot);
  const accountSnapshot = firstText(input.accountSnapshot);
  const resolvedApiKey = input.resolvedCredential?.apiKey?.trim() || '';

  if (resolvedApiKey) {
    return {
      headline: vendor || input.resolvedCredential?.providerLabel || '-',
      subtitle: resolvedApiKey,
      resolvedApiKey,
    };
  }

  const oauthIdentity = authLabel || authFile || accountSnapshot;
  if (oauthIdentity) {
    const parts = [vendor, oauthIdentity].filter(Boolean);
    return {
      headline: parts.join(' · ') || oauthIdentity,
      subtitle: authFile && authFile !== oauthIdentity ? authFile : '',
      resolvedApiKey: '',
    };
  }

  return {
    headline: vendor || '-',
    subtitle: '',
    resolvedApiKey: '',
  };
}
