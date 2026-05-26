import { useMemo, useState } from 'react';
import { useTranslation } from 'react-i18next';
import { Modal } from '@/components/ui/Modal';
import { Button } from '@/components/ui/Button';
import { sortModelsForDisplayBySlash } from '@/utils/models';
import styles from '@/pages/AiProvidersPage.module.scss';

export type ProviderModelEntry = { name: string; alias?: string };

const PREVIEW_COUNT = 5;

export type ProviderModelsPreviewProps = {
  models: ProviderModelEntry[];
  /** 弹窗标题前缀，例如提供商名称 */
  modalTitle: string;
  /** 可选；与原先卡片内 `modelCountLabel` 一致，例如「模型数量: 12」 */
  countLabel?: string;
};

function modelCellKey(model: ProviderModelEntry, index: number) {
  return `${model.name}\u0000${model.alias ?? ''}\u0000${index}`;
}

export function ProviderModelsPreview({
  models,
  modalTitle,
  countLabel,
}: ProviderModelsPreviewProps) {
  const { t } = useTranslation();
  const [open, setOpen] = useState(false);
  const orderedModels = useMemo(() => sortModelsForDisplayBySlash(models), [models]);

  if (!orderedModels.length) return null;

  const preview = orderedModels.slice(0, PREVIEW_COUNT);
  const hiddenCount = orderedModels.length - PREVIEW_COUNT;

  return (
    <>
      <div className={styles.modelTagList}>
        {countLabel ? <span className={styles.modelCountLabel}>{countLabel}</span> : null}
        {preview.map((model, idx) => (
          <span
            key={`${model.name}\u0000${model.alias ?? ''}\u0000${idx}`}
            className={styles.modelTag}
          >
            <span className={styles.modelName}>{model.name}</span>
            {model.alias && model.alias !== model.name && (
              <span className={styles.modelAlias}>{model.alias}</span>
            )}
          </span>
        ))}
        {hiddenCount > 0 ? (
          <button type="button" className={styles.modelPreviewMore} onClick={() => setOpen(true)}>
            {t('ai_providers.models_show_more', { count: hiddenCount })}
          </button>
        ) : null}
      </div>
      <Modal
        open={open}
        onClose={() => setOpen(false)}
        title={`${modalTitle} — ${t('ai_providers.card_models_modal_title')}`}
        width="min(1400px, 96vw)"
        footer={
          <Button variant="secondary" onClick={() => setOpen(false)}>
            {t('common.close')}
          </Button>
        }
      >
        <div className={styles.providerModelsModalGrid}>
          {orderedModels.map((model, index) => (
            <div key={modelCellKey(model, index)} className={styles.providerModelsModalCell}>
              <span className={styles.modelName}>{model.name}</span>
              {model.alias && model.alias !== model.name && (
                <span className={styles.modelAlias}>{model.alias}</span>
              )}
            </div>
          ))}
        </div>
      </Modal>
    </>
  );
}
