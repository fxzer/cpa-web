/**
 * Cache hit ratio differs by provider semantics:
 * OpenAI/Gemini count cached tokens as part of input, while Claude reports
 * uncached input separately and requires adding cached tokens back.
 */
export function computeCacheHitRatio(inputTokens: number, cachedTokens: number): number | null {
  const input = Math.max(inputTokens, 0);
  const cached = Math.max(cachedTokens, 0);
  if (cached <= 0) return null;

  if (input > 0 && cached <= input) {
    return Math.min(cached / input, 1);
  }

  const totalInput = input + cached;
  if (totalInput <= 0) return null;
  return Math.min(cached / totalInput, 1);
}
