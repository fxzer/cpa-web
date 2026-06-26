import { describe, expect, it } from 'vitest';
import {
  getPayloadParamValidationError,
  getVisualConfigValidationErrors,
} from './useVisualConfig';
import { DEFAULT_VISUAL_VALUES, type PayloadParamEntry } from '@/types/visualConfig';

describe('visual config validation', () => {
  it('validates port range and non-negative integer fields', () => {
    const errors = getVisualConfigValidationErrors({
      ...DEFAULT_VISUAL_VALUES,
      port: '70000',
      requestRetry: '-1',
      streaming: {
        ...DEFAULT_VISUAL_VALUES.streaming,
        keepaliveSeconds: 'abc',
      },
    });

    expect(errors.port).toBe('port_range');
    expect(errors.requestRetry).toBe('non_negative_integer');
    expect(errors['streaming.keepaliveSeconds']).toBe('non_negative_integer');
  });

  it('validates typed payload params', () => {
    const param = (valueType: PayloadParamEntry['valueType'], value: string): PayloadParamEntry => ({
      id: 'p1',
      path: 'generationConfig.temperature',
      valueType,
      value,
    });

    expect(getPayloadParamValidationError(param('number', '0.7'))).toBeUndefined();
    expect(getPayloadParamValidationError(param('number', 'abc'))).toBe('payload_invalid_number');
    expect(getPayloadParamValidationError(param('boolean', 'yes'))).toBe('payload_invalid_boolean');
    expect(getPayloadParamValidationError(param('json', '{"ok":true}'))).toBeUndefined();
    expect(getPayloadParamValidationError(param('json', '{bad'))).toBe('payload_invalid_json');
  });
});
