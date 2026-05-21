import { useTranslation } from 'react-i18next';
import { Button } from '@/components/ui/Button';
import type { ApiKeyEntry } from '@/types';
import { buildApiKeyEntry } from './utils';
import styles from '@/pages/AiProvidersPage.module.scss';

interface ProviderApiKeyEntriesEditorProps {
  entries: ApiKeyEntry[];
  disabled?: boolean;
  onChange: (entries: ApiKeyEntry[]) => void;
}

export function ProviderApiKeyEntriesEditor({
  entries,
  disabled = false,
  onChange,
}: ProviderApiKeyEntriesEditorProps) {
  const { t } = useTranslation();
  const list = entries.length ? entries : [buildApiKeyEntry()];

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
          disabled={disabled}
          className={styles.addKeyButton}
        >
          {t('ai_providers.provider_keys_add_btn')}
        </Button>
      </div>
      <div className={styles.keyTableShell}>
        <div className={styles.keyTableHeader}>
          <div className={styles.keyTableColIndex}>#</div>
          <div className={styles.keyTableColKey}>{t('common.api_key')}</div>
          <div className={styles.keyTableColProxy}>{t('common.proxy_url')}</div>
          <div className={styles.keyTableColAction}>{t('common.action')}</div>
        </div>
        {list.map((entry, index) => (
          <div key={index} className={styles.keyTableRow}>
            <div className={styles.keyTableColIndex}>{index + 1}</div>
            <div className={styles.keyTableColKey}>
              <input
                type="text"
                value={entry.apiKey}
                onChange={(e) => updateEntry(index, 'apiKey', e.target.value)}
                disabled={disabled}
                className={`input ${styles.keyTableInput}`}
                placeholder={t('ai_providers.provider_key_placeholder')}
              />
            </div>
            <div className={styles.keyTableColProxy}>
              <input
                type="text"
                value={entry.proxyUrl ?? ''}
                onChange={(e) => updateEntry(index, 'proxyUrl', e.target.value)}
                disabled={disabled}
                className={`input ${styles.keyTableInput}`}
                placeholder={t('ai_providers.provider_proxy_placeholder')}
              />
            </div>
            <div className={styles.keyTableColAction}>
              <Button
                variant="secondary"
                size="sm"
                onClick={() => removeEntry(index)}
                disabled={disabled || list.length <= 1}
              >
                {t('common.remove')}
              </Button>
            </div>
          </div>
        ))}
      </div>
    </div>
  );
}
