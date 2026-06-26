const PROVIDER_COLORS = [
  '#8b8680',
  '#10b981',
  '#f59e0b',
  '#c65746',
  '#8b5cf6',
  '#ec4899',
  '#06b6d4',
  '#84cc16',
];

export function getProviderColor(provider: string): string {
  const hash = provider.split('').reduce((acc, c) => acc + c.charCodeAt(0), 0);
  return PROVIDER_COLORS[hash % PROVIDER_COLORS.length];
}
