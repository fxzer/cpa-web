import { useTranslation } from 'react-i18next';
import styles from '@/pages/AiProvidersPage.module.scss';

interface ProviderPrefixPriorityRowProps {
  prefix?: string;
  priority?: number;
}

export function ProviderPrefixPriorityRow({ prefix, priority }: ProviderPrefixPriorityRowProps) {
  const { t } = useTranslation();
  const hasPrefix = Boolean(prefix);
  const hasPriority = priority !== undefined;

  if (!hasPrefix && !hasPriority) {
    return null;
  }

  return (
    <div className={styles.fieldRowPair}>
      <div className={styles.fieldRowPairItem}>
        <span className={styles.fieldLabel}>{t('common.prefix')}:</span>
        <span className={styles.fieldValue}>{hasPrefix ? prefix : '—'}</span>
      </div>
      <div className={styles.fieldRowPairItem}>
        <span className={styles.fieldLabel}>{t('common.priority')}:</span>
        <span className={styles.fieldValue}>{hasPriority ? priority : '—'}</span>
      </div>
    </div>
  );
}
