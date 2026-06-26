import { describe, expect, it } from 'vitest';
import {
  buildCandidateUsageSourceIds,
  computeCacheHitRatio,
  normalizeUsageSourceId,
  readUsageModelAlias,
} from './usage';

describe('usage utilities', () => {
  it('computes cache hit ratio with bounded values', () => {
    expect(computeCacheHitRatio(100, 25)).toBe(0.25);
    expect(computeCacheHitRatio(0, 50)).toBe(1);
    expect(computeCacheHitRatio(10, 0)).toBeNull();
    expect(computeCacheHitRatio(-10, 5)).toBe(1);
  });

  it('normalizes source ids and builds api key candidates', () => {
    const candidates = buildCandidateUsageSourceIds({ apiKey: ' sk-test ', prefix: 'team' });

    expect(candidates.length).toBeGreaterThan(0);
    expect(candidates.every((item) => item === normalizeUsageSourceId(item))).toBe(true);
    expect(candidates.some((item) => item.includes('team'))).toBe(true);
  });

  it('reads model alias from supported detail shapes', () => {
    expect(readUsageModelAlias({ model_alias: 'mini' }, 'gpt-5.4')).toBe('mini');
    expect(readUsageModelAlias({ modelAlias: 'pro' }, 'gpt-5.4')).toBe('pro');
    expect(readUsageModelAlias({ alias: 'gpt-5.4' }, 'gpt-5.4')).toBeUndefined();
  });
});
