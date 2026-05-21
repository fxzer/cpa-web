import { useTranslation } from 'react-i18next';
import { IconCheck, IconX } from '@/components/ui/icons';
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
            <div key={getProviderApiKeyEntryKey(entry, entryIndex)} className={styles.apiKeyEntryCard}>
              <span className={styles.apiKeyEntryIndex}>{entryIndex + 1}</span>
              <span className={styles.apiKeyEntryKey}>{maskApiKey(entry.apiKey)}</span>
              {entry.proxyUrl && <span className={styles.apiKeyEntryProxy}>{entry.proxyUrl}</span>}
              <div className={styles.apiKeyEntryStats}>
                <span className={`${styles.apiKeyEntryStat} ${styles.apiKeyEntryStatSuccess}`}>
                  <IconCheck size={12} /> {entryStats.success}
                </span>
                <span className={`${styles.apiKeyEntryStat} ${styles.apiKeyEntryStatFailure}`}>
                  <IconX size={12} /> {entryStats.failure}
                </span>
              </div>
            </div>
          );
        })}
      </div>
    </div>
  );
}
