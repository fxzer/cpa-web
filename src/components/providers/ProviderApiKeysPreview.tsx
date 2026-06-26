import { useState } from 'react';
import { useTranslation } from 'react-i18next';
import { Button } from '@/components/ui/Button';
import { Modal } from '@/components/ui/Modal';
import type { ApiKeyEntry } from '@/types';
import { maskApiKey } from '@/utils/format';
import styles from '@/pages/AiProvidersPage.module.scss';

const PREVIEW_COUNT = 2;

interface ProviderApiKeysPreviewProps {
  entries?: ApiKeyEntry[];
  moreLabel: (count: number) => string;
  modalTitle?: string;
}

export function ProviderApiKeysPreview({
  entries,
  moreLabel,
  modalTitle,
}: ProviderApiKeysPreviewProps) {
  const { t } = useTranslation();
  const [open, setOpen] = useState(false);
  const apiKeyEntries = Array.isArray(entries) ? entries.filter((entry) => entry.apiKey) : [];

  if (!apiKeyEntries.length) {
    return <span className={styles.providerTableMuted}>-</span>;
  }

  const preview = apiKeyEntries.slice(0, PREVIEW_COUNT);
  const hiddenCount = apiKeyEntries.length - PREVIEW_COUNT;

  return (
    <>
      <div className={styles.providerTableTagList}>
        {preview.map((entry, index) => (
          <span key={`${entry.apiKey}\u0000${index}`} className={styles.providerTableTag}>
            {maskApiKey(entry.apiKey)}
          </span>
        ))}
        {hiddenCount > 0 ? (
          <button
            type="button"
            className={styles.providerTableMoreTag}
            onClick={() => setOpen(true)}
          >
            {moreLabel(hiddenCount)}
          </button>
        ) : null}
      </div>

      <Modal
        open={open}
        onClose={() => setOpen(false)}
        title={modalTitle || t('ai_providers.api_keys_modal_title')}
        width="min(900px, 94vw)"
        footer={
          <Button variant="secondary" onClick={() => setOpen(false)}>
            {t('common.close')}
          </Button>
        }
      >
        <div className={styles.providerApiKeysModalList}>
          {apiKeyEntries.map((entry, index) => (
            <div key={`${entry.apiKey}\u0000${index}`} className={styles.providerApiKeysModalRow}>
              <div className={styles.providerApiKeysModalKey}>{entry.apiKey}</div>
              <div className={styles.providerApiKeysModalMeta}>
                {entry.remark ? <span>{entry.remark}</span> : null}
                {entry.proxyUrl ? (
                  <span>
                    {t('common.proxy_url')}: {entry.proxyUrl}
                  </span>
                ) : null}
                {entry.authIndex ? <span>authIndex: {entry.authIndex}</span> : null}
              </div>
            </div>
          ))}
        </div>
      </Modal>
    </>
  );
}
