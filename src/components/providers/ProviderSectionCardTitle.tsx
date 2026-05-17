import type { ReactNode } from 'react';
import { useTranslation } from 'react-i18next';
import styles from '@/pages/AiProvidersPage.module.scss';

type ProviderSectionCardTitleProps = {
  icon: ReactNode;
  /** 已翻译的卡片标题 */
  title: string;
  /** 当前 tab 下已添加的配置条数 */
  count: number;
};

export function ProviderSectionCardTitle({ icon, title, count }: ProviderSectionCardTitleProps) {
  const { t } = useTranslation();
  return (
    <span className={styles.cardTitle}>
      {icon}
      {title}
      <span
        className={`${styles.statPill} ${styles.statSuccess} ${styles.cardTitleCountBadge}`}
        aria-label={t('ai_providers.card_entries_aria', { count })}
      >
        {t('ai_providers.card_entries_count', { count })}
      </span>
    </span>
  );
}
