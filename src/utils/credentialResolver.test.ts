import { describe, expect, it } from 'vitest';
import {
  buildConfiguredCredentialLookup,
  buildCredentialDisplay,
  resolveConfiguredCredential,
  resolveProviderModelColumnDisplay,
} from './credentialResolver';
import { buildCandidateUsageSourceIds } from './usage';

describe('credential resolver', () => {
  it('builds lookup tables and resolves credentials by auth index and source id', () => {
    const lookup = buildConfiguredCredentialLookup({
      openaiCompatibility: [
        {
          name: 'OpenRouter',
          baseUrl: 'https://openrouter.ai/api/v1',
          prefix: 'or',
          apiKeyEntries: [{ apiKey: 'sk-openrouter', authIndex: '3' }],
        },
      ],
    });

    expect(resolveConfiguredCredential(lookup, { authIndex: '3' })?.providerLabel).toBe('or');

    const [source] = buildCandidateUsageSourceIds({ apiKey: 'sk-openrouter', prefix: 'or' });
    expect(resolveConfiguredCredential(lookup, { source })?.apiKey).toBe('sk-openrouter');
  });

  it('formats provider/model and credential display with resolved credentials', () => {
    const resolvedCredential = {
      apiKey: 'sk-openrouter',
      providerLabel: 'OpenRouter',
      requestLabel: 'OpenRouter',
      providerType: 'openai' as const,
    };

    expect(
      resolveProviderModelColumnDisplay({
        usageProvider: 'openrouter',
        resolvedCredential,
      })
    ).toMatchObject({
      tag: 'openai',
      headline: 'openai / OpenRouter',
      displayName: 'OpenRouter',
    });

    expect(
      buildCredentialDisplay({
        authIndex: '3',
        source: 'm:sk...ter',
        resolvedCredential,
      })
    ).toMatchObject({ headline: 'm:sk...ter' });
  });
});
