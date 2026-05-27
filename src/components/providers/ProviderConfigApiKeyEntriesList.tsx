import { useTranslation } from 'react-i18next';
import type { ApiKeyEntry } from '@/types';
import { maskApiKey } from '@/utils/format';
import {
  getProviderApiKeyEntries,
  getProviderApiKeyEntryKey,
  getProviderTotalStats,
  type ProviderRecentUsageMap,
} from './utils';
import styles from '@/pages/AiProvidersPage.module.scss';

interface ProviderConfigApiKeyEntriesListProps {
  provider: string;
  baseUrl?: string;
  entries?: ApiKeyEntry[];
  usageByProvider: ProviderRecentUsageMap;
}

export function ProviderConfigApiKeyEntriesList({
  provider,
  baseUrl,
  entries,
  usageByProvider,
}: ProviderConfigApiKeyEntriesListProps) {
  const { t } = useTranslation();
  const apiKeyEntries = getProviderApiKeyEntries({ apiKeyEntries: entries });
  if (!apiKeyEntries.length) return null;

  return (
    <div className={styles.apiKeyEntriesSection}>
      <div className={styles.apiKeyEntriesLabel}>
        {t('ai_providers.provider_keys_count')}: {apiKeyEntries.length}
      </div>
      <div className={styles.apiKeyEntryList}>
        {apiKeyEntries.map((entry, entryIndex) => {
          const entryStats = getProviderTotalStats(
            usageByProvider,
            provider,
            entry.apiKey,
            baseUrl
          );
          return (
            <div
              key={getProviderApiKeyEntryKey(entry, entryIndex)}
              className={styles.apiKeyPill}
              title={
                [
                  entry.proxyUrl ? `${t('common.proxy_url')}: ${entry.proxyUrl}` : '',
                  `${t('common.status')}: ${t('common.success')}: ${entryStats.success} / ${t('common.failure')}: ${entryStats.failure}`,
                ]
                  .filter(Boolean)
                  .join(' | ') || undefined
              }
            >
              <span className={styles.apiKeyPillKey}>{maskApiKey(entry.apiKey)}</span>
              {((entryStats.success || 0) > 0 || (entryStats.failure || 0) > 0) && (
                <span className={styles.apiKeyPillStats}>
                  {(entryStats.success || 0) > 0 ? (
                    <span className={styles.apiKeyPillSuccess}>✓{entryStats.success}</span>
                  ) : (
                    <span className={styles.apiKeyPillSuccess} style={{ visibility: 'hidden' }}>✓0</span>
                  )}
                  {(entryStats.failure || 0) > 0 ? (
                    <span className={styles.apiKeyPillFailure}>✗{entryStats.failure}</span>
                  ) : (
                    <span className={styles.apiKeyPillFailure} style={{ visibility: 'hidden' }}>✗0</span>
                  )}
                </span>
              )}
            </div>
          );
        })}
      </div>
    </div>
  );
}
