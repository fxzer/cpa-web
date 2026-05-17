import { useMemo } from 'react';
import { Button } from '@/components/ui/Button';
import { Card } from '@/components/ui/Card';
import iconAmp from '@/assets/icons/amp.svg';
import type { AmpcodeConfig } from '@/types';
import { maskApiKey } from '@/utils/format';
import styles from '@/pages/AiProvidersPage.module.scss';
import { ProviderModelsPreview } from '../ProviderModelsPreview';
import { CopyableUrlValue } from '../CopyableUrlValue';
import { ProviderSectionCardTitle } from '../ProviderSectionCardTitle';
import { useTranslation } from 'react-i18next';

interface AmpcodeSectionProps {
  config: AmpcodeConfig | null | undefined;
  loading: boolean;
  disableControls: boolean;
  isSwitching: boolean;
  onEdit: () => void;
}

export function AmpcodeSection({
  config,
  loading,
  disableControls,
  isSwitching,
  onEdit,
}: AmpcodeSectionProps) {
  const { t } = useTranslation();
  const showLoadingPlaceholder = loading && !config;

  const ampcodeEntryCount = useMemo(() => {
    if (!config) return 0;
    const url = String(config.upstreamUrl ?? '').trim();
    const key = String(config.upstreamApiKey ?? '').trim();
    const extraKeys = (config.upstreamApiKeys ?? []).some((k) => String(k ?? '').trim().length > 0);
    const hasMappings = (config.modelMappings?.length ?? 0) > 0;
    return url || key || extraKeys || hasMappings ? 1 : 0;
  }, [config]);

  return (
    <>
      <Card
        title={
          <ProviderSectionCardTitle
            icon={<img src={iconAmp} alt="" className={styles.cardTitleIcon} />}
            title={t('ai_providers.ampcode_title')}
            count={ampcodeEntryCount}
          />
        }
        extra={
          <Button
            size="sm"
            onClick={onEdit}
            disabled={disableControls || loading || isSwitching}
          >
            {t('common.edit')}
          </Button>
        }
      >
        {showLoadingPlaceholder ? (
          <div className="hint">{t('common.loading')}</div>
        ) : (
          <>
            <div className={styles.fieldRow}>
              <span className={styles.fieldLabel}>{t('ai_providers.ampcode_upstream_url_label')}:</span>
              {config?.upstreamUrl ? (
                <CopyableUrlValue value={config.upstreamUrl} />
              ) : (
                <span className={styles.fieldValue}>{t('common.not_set')}</span>
              )}
            </div>
            <div className={styles.fieldRow}>
              <span className={styles.fieldLabel}>
                {t('ai_providers.ampcode_upstream_api_key_label')}:
              </span>
              <span className={styles.fieldValue}>
                {config?.upstreamApiKey ? maskApiKey(config.upstreamApiKey) : t('common.not_set')}
              </span>
            </div>
            <div className={styles.fieldRow}>
              <span className={styles.fieldLabel}>
                {t('ai_providers.ampcode_force_model_mappings_label')}:
              </span>
              <span className={styles.fieldValue}>
                {(config?.forceModelMappings ?? false) ? t('common.yes') : t('common.no')}
              </span>
            </div>
            <div className={styles.fieldRow} style={{ marginTop: 8 }}>
              <span className={styles.fieldLabel}>{t('ai_providers.ampcode_model_mappings_count')}:</span>
              <span className={styles.fieldValue}>{config?.modelMappings?.length || 0}</span>
            </div>
            <div className={styles.fieldRow}>
              <span className={styles.fieldLabel}>{t('ai_providers.ampcode_upstream_api_keys_count')}:</span>
              <span className={styles.fieldValue}>{config?.upstreamApiKeys?.length || 0}</span>
            </div>
            {config?.modelMappings?.length ? (
              <ProviderModelsPreview
                models={config.modelMappings.map((m) => ({ name: m.from, alias: m.to }))}
                modalTitle={t('ai_providers.ampcode_title')}
              />
            ) : null}
          </>
        )}
      </Card>
    </>
  );
}
