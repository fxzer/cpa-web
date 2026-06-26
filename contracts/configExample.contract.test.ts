import { existsSync, readFileSync } from 'node:fs';
import path from 'node:path';
import { describe, expect, it } from 'vitest';
import { parse } from 'yaml';
import { normalizeConfigResponse } from '../src/services/api/transformers';

const coreConfigExamplePath = path.resolve(__dirname, '../../cpa-core/config.example.yaml');
const hasCoreConfigExample = existsSync(coreConfigExamplePath);

describe('cpa-core config.example.yaml contract', () => {
  it.skipIf(!hasCoreConfigExample)(
    'is readable by the web config transformer for management UI fields',
    () => {
      const raw = parse(readFileSync(coreConfigExamplePath, 'utf8')) as Record<string, unknown>;
      const config = normalizeConfigResponse(raw);

      expect(config.raw).toBe(raw);
      expect(config.requestRetry).toBe(3);
      expect(config.forceModelPrefix).toBe(false);
      expect(config.wsAuth).toBe(false);
      expect(config.quotaExceeded).toMatchObject({
        switchProject: true,
        switchPreviewModel: true,
        antigravityCredits: true,
      });
      expect(config.routingStrategy).toBe('round-robin');
      expect(config.apiKeys).toEqual(['your-api-key-1', 'your-api-key-2', 'your-api-key-3']);
    }
  );
});
