import { useMemo, type CSSProperties } from 'react';
import { useTranslation } from 'react-i18next';
import { Modal } from '@/components/ui/Modal';
import { Button } from '@/components/ui/Button';
import { EmptyState } from '@/components/ui/EmptyState';
import { ModelMappingDiagram } from '@/components/modelAlias';
import { getTypeColor } from '@/features/authFiles/constants';
import { buildProviderCardAliasDiagramData } from '@/utils/providerModelAliasCatalog';
import type { ModelAlias } from '@/types/provider';
import { useThemeStore } from '@/stores';
import styles from '@/pages/AiProvidersPage.module.scss';

export type ProviderAliasOverviewModalProps = {
  open: boolean;
  providerKey: string;
  providerLabel: string;
  models?: ModelAlias[];
  onClose: () => void;
};

export function ProviderAliasOverviewModal(props: ProviderAliasOverviewModalProps) {
  const { open, providerKey, providerLabel, models, onClose } = props;
  const { t } = useTranslation();
  const resolvedTheme = useThemeStore((state) => state.resolvedTheme);

  const diagramData = useMemo(
    () => buildProviderCardAliasDiagramData(providerKey, models),
    [models, providerKey]
  );

  const scopeBadgeStyle = useMemo(() => {
    const color = getTypeColor(providerKey, resolvedTheme);
    return {
      backgroundColor: color.bg,
      color: color.text,
      ...(color.border ? { border: color.border } : {}),
    } as CSSProperties;
  }, [providerKey, resolvedTheme]);

  const hasDiagramData =
    Object.keys(diagramData.modelAlias).length > 0 ||
    Object.keys(diagramData.allProviderModels).length > 0;

  return (
    <Modal
      open={open}
      onClose={onClose}
      width="min(1200px, 96vw)"
      className={styles.aliasOverviewModal}
      title={
        <span className={styles.modalTitleInline}>
          <span className={styles.modalTitleText}>{t('ai_providers.alias_overview_title')}</span>
          <span className={styles.typeBadge} style={scopeBadgeStyle}>
            {providerLabel}
          </span>
        </span>
      }
      footer={
        <Button variant="secondary" onClick={onClose}>
          {t('common.close')}
        </Button>
      }
    >
      {!hasDiagramData ? (
        <EmptyState
          title={t('oauth_model_alias.list_empty_all')}
          description={t('ai_providers.alias_overview_empty_desc')}
        />
      ) : (
        <div className={styles.aliasOverviewDiagramWrap}>
          <ModelMappingDiagram
            modelAlias={diagramData.modelAlias}
            allProviderModels={diagramData.allProviderModels}
            providerAliasSeeds={diagramData.providerAliasSeeds}
          />
        </div>
      )}
    </Modal>
  );
}
