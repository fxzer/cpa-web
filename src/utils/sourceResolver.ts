import type { ApiKeyEntry, GeminiKeyConfig, OpenAIProviderConfig, ProviderKeyConfig } from '@/types';
import type { CredentialInfo, SourceInfo } from '@/types/sourceInfo';
import {
  buildProviderOverviewLabel,
  buildProviderRequestLabel,
  getPrimaryApiKey,
  getProviderApiKeyEntries,
} from '@/components/providers/utils';
import { buildCandidateUsageSourceIds, normalizeAuthIndex } from '@/utils/usage';

export interface SourceInfoMapInput {
  geminiApiKeys?: GeminiKeyConfig[];
  claudeApiKeys?: ProviderKeyConfig[];
  codexApiKeys?: ProviderKeyConfig[];
  vertexApiKeys?: ProviderKeyConfig[];
  openaiCompatibility?: OpenAIProviderConfig[];
}

type SourceInfoEntry = Required<Pick<SourceInfo, 'displayName' | 'type' | 'identityKey'>> &
  Pick<SourceInfo, 'requestDisplayName'>;

export interface SourceInfoMap {
  byAuthIndex: Map<string, SourceInfoEntry | null>;
  bySource: Map<string, SourceInfoEntry | null>;
}

type ProviderConfigItem = {
  apiKey?: string;
  prefix?: string;
  name?: string;
  baseUrl?: string;
  authIndex?: string;
  apiKeyEntries?: ApiKeyEntry[];
};

const buildProviderIdentityKey = (type: string, index: number) => `${type}:${index}`;

const registerIdentity = (
  map: Map<string, SourceInfoEntry | null>,
  key: string | null | undefined,
  entry: SourceInfoEntry
) => {
  if (!key) return;

  const existing = map.get(key);
  if (existing === undefined) {
    map.set(key, entry);
    return;
  }

  if (existing === null) {
    return;
  }

  if (existing.identityKey === entry.identityKey) {
    return;
  }

  map.set(key, null);
};

const formatRawSourceDisplayName = (source: string) => {
  if (!source) return '-';
  return source.startsWith('t:') ? source.slice(2) : source;
};

const collectProviderAuthIndices = (item: ProviderConfigItem): Array<unknown> => {
  const authIndices: Array<unknown> = [item.authIndex];
  getProviderApiKeyEntries(item).forEach((entry) => {
    authIndices.push(entry.authIndex);
  });
  return authIndices;
};

const buildProviderSourceCandidates = (item: ProviderConfigItem): string[] => {
  const candidates = new Set<string>();
  buildCandidateUsageSourceIds({
    apiKey: getPrimaryApiKey(item) || item.apiKey,
    prefix: item.prefix,
  }).forEach((candidate) => candidates.add(candidate));
  getProviderApiKeyEntries(item).forEach((entry) => {
    buildCandidateUsageSourceIds({ apiKey: entry.apiKey, prefix: item.prefix }).forEach((candidate) =>
      candidates.add(candidate)
    );
  });
  return Array.from(candidates);
};

export function buildSourceInfoMap(input: SourceInfoMapInput): SourceInfoMap {
  const byAuthIndex = new Map<string, SourceInfoEntry | null>();
  const bySource = new Map<string, SourceInfoEntry | null>();

  const registerProvider = (
    entry: SourceInfoEntry,
    authIndices: Array<unknown>,
    candidates: Iterable<string>
  ) => {
    authIndices.forEach((authIndex) => {
      registerIdentity(byAuthIndex, normalizeAuthIndex(authIndex), entry);
    });

    Array.from(candidates).forEach((candidate) => {
      registerIdentity(bySource, candidate, entry);
    });
  };

  const providers: Array<{
    items: ProviderConfigItem[];
    type: string;
    label: string;
  }> = [
    { items: input.geminiApiKeys || [], type: 'gemini', label: 'Gemini' },
    { items: input.claudeApiKeys || [], type: 'claude', label: 'Claude' },
    { items: input.codexApiKeys || [], type: 'codex', label: 'Codex' },
    { items: input.vertexApiKeys || [], type: 'vertex', label: 'Vertex' },
  ];

  providers.forEach(({ items, type, label }) => {
    items.forEach((item, index) => {
      const fallback = `${label} #${index + 1}`;
      registerProvider(
        {
          displayName: buildProviderOverviewLabel(item, fallback),
          requestDisplayName: buildProviderRequestLabel(item, fallback),
          type,
          identityKey: buildProviderIdentityKey(type, index),
        },
        collectProviderAuthIndices(item),
        buildProviderSourceCandidates(item)
      );
    });
  });

  (input.openaiCompatibility || []).forEach((provider, providerIndex) => {
    const fallback = `OpenAI #${providerIndex + 1}`;
    registerProvider(
      {
        displayName: buildProviderOverviewLabel(provider, fallback),
        requestDisplayName: buildProviderRequestLabel(provider, fallback),
        type: 'openai',
        identityKey: buildProviderIdentityKey('openai', providerIndex),
      },
      collectProviderAuthIndices(provider),
      buildProviderSourceCandidates(provider)
    );
  });

  return { byAuthIndex, bySource };
}

export function resolveSourceDisplay(
  sourceRaw: string,
  authIndex: unknown,
  sourceInfoMap: SourceInfoMap,
  authFileMap: Map<string, CredentialInfo>
): SourceInfo {
  const source = sourceRaw.trim();
  const authIndexKey = normalizeAuthIndex(authIndex);

  if (authIndexKey) {
    const matchedByAuthIndex = sourceInfoMap.byAuthIndex.get(authIndexKey);
    if (matchedByAuthIndex) {
      return matchedByAuthIndex;
    }

    const authInfo = authFileMap.get(authIndexKey);
    if (authInfo) {
      return {
        displayName: authInfo.name || authIndexKey,
        type: authInfo.type,
        identityKey: `auth:${authIndexKey}`,
      };
    }
  }

  const matchedBySource = source ? sourceInfoMap.bySource.get(source) : null;
  if (matchedBySource) {
    return matchedBySource;
  }

  if (source) {
    return {
      displayName: formatRawSourceDisplayName(source),
      type: '',
      identityKey: `source:${source}`,
    };
  }

  if (authIndexKey) {
    return {
      displayName: authIndexKey,
      type: '',
      identityKey: `auth:${authIndexKey}`,
    };
  }

  return {
    displayName: '-',
    type: '',
    identityKey: 'source:-',
  };
}
