import { useCallback } from 'react';
import { useTranslation } from 'react-i18next';
import { useNotificationStore } from '@/stores';
import { copyToClipboard } from '@/utils/clipboard';
import styles from '@/pages/AiProvidersPage.module.scss';

type CopyableUrlValueProps = {
  /** 展示并写入剪贴板的完整 URL 文本 */
  value: string;
};

export function CopyableUrlValue({ value }: CopyableUrlValueProps) {
  const { t } = useTranslation();
  const showNotification = useNotificationStore((s) => s.showNotification);

  const copy = useCallback(async () => {
    const ok = await copyToClipboard(value);
    showNotification(
      t(ok ? 'notification.link_copied' : 'notification.copy_failed'),
      ok ? 'success' : 'error'
    );
  }, [showNotification, t, value]);

  return (
    <span
      role="button"
      tabIndex={0}
      className={`${styles.fieldValue} ${styles.fieldValueCopyable}`}
      onClick={() => void copy()}
      onKeyDown={(e) => {
        if (e.key === 'Enter' || e.key === ' ') {
          e.preventDefault();
          void copy();
        }
      }}
      title={`${value} · ${t('common.copy')}`}
    >
      {value}
    </span>
  );
}
