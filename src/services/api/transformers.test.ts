import { describe, expect, it } from 'vitest';
import { normalizeConfigResponse, normalizeOpenAIProvider } from './transformers';

describe('api transformers', () => {
  it('normalizes OpenAI compatible providers with keys, headers, models, and disabled flag', () => {
    const provider = normalizeOpenAIProvider({
      name: 'OpenRouter',
      'base-url': 'https://openrouter.ai/api/v1',
      disabled: 'true',
      headers: [{ key: 'X-Test', value: 'yes' }],
      models: [{ name: 'openai/gpt-4o-mini', alias: 'mini', priority: '3' }],
      'api-key-entries': [{ 'api-key': 'sk-test', remark: 'primary', 'auth-index': '7' }],
    });

    expect(provider).toMatchObject({
      name: 'OpenRouter',
      baseUrl: 'https://openrouter.ai/api/v1',
      disabled: true,
      headers: { 'X-Test': 'yes' },
      models: [{ name: 'openai/gpt-4o-mini', alias: 'mini', priority: 3 }],
      apiKeyEntries: [{ apiKey: 'sk-test', remark: 'primary', authIndex: '7' }],
    });
  });

  it('normalizes mixed config response shapes', () => {
    const config = normalizeConfigResponse({
      debug: 'on',
      'request-retry': '2',
      'quota-exceeded': {
        'switch-project': 'false',
        'antigravity-credits': '1',
      },
      'gemini-api-key': [
        {
          'api-key-entries': [{ 'api-key': 'gemini-key' }],
          models: ['gemini-2.5-pro'],
          'excluded-models': ['old', 'old'],
        },
      ],
    });

    expect(config.debug).toBe(true);
    expect(config.requestRetry).toBe(2);
    expect(config.quotaExceeded?.switchProject).toBe(false);
    expect(config.quotaExceeded?.antigravityCredits).toBe(true);
    expect(config.geminiApiKeys?.[0]?.apiKeyEntries[0]?.apiKey).toBe('gemini-key');
    expect(config.geminiApiKeys?.[0]?.models).toEqual([{ name: 'gemini-2.5-pro' }]);
    expect(config.geminiApiKeys?.[0]?.excludedModels).toEqual(['old']);
  });
});
