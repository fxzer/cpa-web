import { useTranslation } from 'react-i18next';
import { Button } from '@/components/ui/Button';
import { KeyTestStatusIcon } from '@/components/providers/KeyTestStatusIcon';
import type { KeyTestStatus } from '@/stores/useOpenAIEditDraftStore';
import type { ApiKeyEntry } from '@/types';
import { buildApiKeyEntry } from './utils';
import styles from '@/pages/AiProvidersPage.module.scss';

interface ProviderApiKeyEntriesEditorProps {
  entries: ApiKeyEntry[];
  disabled?: boolean;
  onChange: (entries: ApiKeyEntry[]) => void;
  keyTestStatuses?: KeyTestStatus[];
  isTestingKeys?: boolean;
  hasConfiguredModels?: boolean;
  baseUrl?: string;
  onBatchTest?: (index: number) => void;
  onSingleTest?: (index: number) => void;
}

export function ProviderApiKeyEntriesEditor({
  entries,
  disabled = false,
  onChange,
  keyTestStatuses,
  isTestingKeys = false,
  hasConfiguredModels = false,
  baseUrl = '',
  onBatchTest,
  onSingleTest,
}: ProviderApiKeyEntriesEditorProps) {
  const { t } = useTranslation();
  const list = entries.length ? entries : [buildApiKeyEntry()];
  const testingEnabled = Boolean(onBatchTest && onSingleTest);
  const controlsDisabled = disabled || isTestingKeys;
  const tableShellClassName = testingEnabled
    ? `${styles.keyTableShell} ${styles.keyTableShellWithTesting}`
    : `${styles.keyTableShell} ${styles.keyTableShellNoStatus}`;

  const updateEntry = (idx: number, field: keyof ApiKeyEntry, value: string) => {
    const next = list.map((entry, i) => (i === idx ? { ...entry, [field]: value } : entry));
    onChange(next);
  };

  const removeEntry = (idx: number) => {
    const next = list.filter((_, i) => i !== idx);
    onChange(next.length ? next : [buildApiKeyEntry()]);
  };

  const addEntry = () => {
    onChange([...list, buildApiKeyEntry()]);
  };

  return (
    <div className={styles.keyEntriesList}>
      <div className={styles.keyEntriesToolbar}>
        <span className={styles.keyEntriesCount}>
          {t('ai_providers.provider_keys_count')}: {list.length}
        </span>
        <Button
          variant="secondary"
          size="sm"
          onClick={addEntry}
          disabled={controlsDisabled}
          className={styles.addKeyButton}
        >
          {t('ai_providers.provider_keys_add_btn')}
        </Button>
      </div>
      <div className={tableShellClassName}>
        <div className={styles.keyTableHeader}>
          <div className={styles.keyTableColIndex}>#</div>
          {testingEnabled && <div className={styles.keyTableColStatus}>{t('common.status')}</div>}
          <div className={styles.keyTableColKey}>{t('common.api_key')}</div>
          <div className={styles.keyTableColProxy}>{t('common.proxy_url')}</div>
          <div className={styles.keyTableColAction}>{t('common.action')}</div>
        </div>
        {list.map((entry, index) => {
          const keyStatus = keyTestStatuses?.[index]?.status ?? 'idle';
          const canTestKey = Boolean(entry.apiKey?.trim()) && hasConfiguredModels;
          const statusMessage = keyTestStatuses?.[index]?.message || '';

          return (
            <div key={index} className={styles.keyTableRow}>
              <div className={styles.keyTableColIndex}>{index + 1}</div>
              {testingEnabled && (
                <div
                  className={styles.keyTableColStatus}
                  title={statusMessage || t('ai_providers.key_test_status_hint')}
                  aria-label={statusMessage || t('ai_providers.key_test_status_hint')}
                >
                  <KeyTestStatusIcon status={keyStatus} />
                </div>
              )}
              <div className={styles.keyTableColKey}>
                <input
                  type="text"
                  value={entry.apiKey}
                  onChange={(e) => updateEntry(index, 'apiKey', e.target.value)}
                  disabled={controlsDisabled}
                  className={`input ${styles.keyTableInput}`}
                  placeholder={t('ai_providers.provider_key_placeholder')}
                />
              </div>
              <div className={styles.keyTableColProxy}>
                <input
                  type="text"
                  value={entry.proxyUrl ?? ''}
                  onChange={(e) => updateEntry(index, 'proxyUrl', e.target.value)}
                  disabled={controlsDisabled}
                  className={`input ${styles.keyTableInput}`}
                  placeholder={t('ai_providers.provider_proxy_placeholder')}
                />
              </div>
              <div className={styles.keyTableColAction}>
                {testingEnabled && (
                  <>
                    <Button
                      variant="secondary"
                      size="sm"
                      onClick={() => onBatchTest?.(index)}
                      disabled={
                        controlsDisabled || !entry.apiKey?.trim() || !baseUrl.trim()
                      }
                    >
                      {t('ai_providers.openai_batch_model_test_btn')}
                    </Button>
                    <Button
                      variant="secondary"
                      size="sm"
                      onClick={() => void onSingleTest?.(index)}
                      disabled={controlsDisabled || !canTestKey}
                      loading={keyStatus === 'loading'}
                    >
                      {t('ai_providers.openai_test_single_action')}
                    </Button>
                  </>
                )}
                <Button
                  variant="secondary"
                  size="sm"
                  onClick={() => removeEntry(index)}
                  disabled={controlsDisabled || list.length <= 1}
                  className={styles.keyTableDeleteButton}
                >
                  {t('common.delete')}
                </Button>
              </div>
            </div>
          );
        })}
      </div>
    </div>
  );
}
