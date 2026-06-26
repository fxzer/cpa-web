import { useMemo, useRef, type CSSProperties } from 'react';
import { useTranslation } from 'react-i18next';
import { Modal } from '@/components/ui/Modal';
import { Button } from '@/components/ui/Button';
import { EmptyState } from '@/components/ui/EmptyState';
import { ModelMappingDiagram, type ModelMappingDiagramRef } from '@/components/modelAlias';
import type { OAuthModelAliasEntry } from '@/types';
import type { AuthFileModelItem } from '@/features/authFiles/constants';
import { getTypeColor, getTypeLabel } from '@/features/authFiles/constants';
import { resolveOAuthModelAliasChannel } from '@/utils/oauthModelAliasForm';
import { useThemeStore } from '@/stores';
import styles from '@/pages/AuthFilesPage.module.scss';

export type OAuthAliasOverviewModalProps = {
  open: boolean;
  providerFilter: string;
  disableControls: boolean;
  modelAliasError: 'unsupported' | null;
  modelAlias: Record<string, OAuthModelAliasEntry[]>;
  allProviderModels: Record<string, AuthFileModelItem[]>;
  providerAliasSeeds: Record<string, string[]>;
  onClose: () => void;
  onUpdate: (provider: string, sourceModel: string, newAlias: string) => Promise<void>;
  onDeleteLink: (provider: string, sourceModel: string, alias: string) => void;
  onToggleFork: (
    provider: string,
    sourceModel: string,
    alias: string,
    fork: boolean
  ) => Promise<void>;
  onRenameAlias: (oldAlias: string, newAlias: string) => Promise<void>;
  onDeleteAlias: (aliasName: string) => void;
  onDeleteProvider: (provider: string) => void;
};

function filterAliasData(
  modelAlias: Record<string, OAuthModelAliasEntry[]>,
  allProviderModels: Record<string, AuthFileModelItem[]>,
  providerAliasSeeds: Record<string, string[]>,
  providerFilter: string
) {
  if (providerFilter === 'all') {
    return { modelAlias, allProviderModels, providerAliasSeeds };
  }

  const normalized = resolveOAuthModelAliasChannel(providerFilter);
  const aliasEntry = Object.entries(modelAlias).find(
    ([key]) => resolveOAuthModelAliasChannel(key) === normalized
  );
  const modelEntry = Object.entries(allProviderModels).find(
    ([key]) => resolveOAuthModelAliasChannel(key) === normalized
  );
  const seedEntry = Object.entries(providerAliasSeeds).find(
    ([key]) => resolveOAuthModelAliasChannel(key) === normalized
  );

  return {
    modelAlias: aliasEntry ? { [aliasEntry[0]]: aliasEntry[1] } : {},
    allProviderModels: modelEntry ? { [modelEntry[0]]: modelEntry[1] } : {},
    providerAliasSeeds: seedEntry ? { [seedEntry[0]]: seedEntry[1] } : {},
  };
}

export function OAuthAliasOverviewModal(props: OAuthAliasOverviewModalProps) {
  const { t } = useTranslation();
  const resolvedTheme = useThemeStore((state) => state.resolvedTheme);
  const diagramRef = useRef<ModelMappingDiagramRef | null>(null);
  const {
    open,
    providerFilter,
    disableControls,
    modelAliasError,
    modelAlias,
    allProviderModels,
    providerAliasSeeds,
    onClose,
    onUpdate,
    onDeleteLink,
    onToggleFork,
    onRenameAlias,
    onDeleteAlias,
    onDeleteProvider,
  } = props;

  const filtered = useMemo(
    () => filterAliasData(modelAlias, allProviderModels, providerAliasSeeds, providerFilter),
    [allProviderModels, modelAlias, providerAliasSeeds, providerFilter]
  );

  const scopeLabel =
    providerFilter === 'all' ? t('auth_files.filter_all') : getTypeLabel(t, providerFilter);

  const scopeBadgeStyle = useMemo(() => {
    const colorKey = providerFilter === 'all' ? 'unknown' : providerFilter;
    const color = getTypeColor(colorKey, resolvedTheme);
    return {
      backgroundColor: color.bg,
      color: color.text,
      ...(color.border ? { border: color.border } : {}),
    } as CSSProperties;
  }, [providerFilter, resolvedTheme]);

  const hasDiagramData =
    Object.keys(filtered.modelAlias).length > 0 ||
    Object.keys(filtered.allProviderModels).length > 0 ||
    Object.values(filtered.providerAliasSeeds).some((aliases) => aliases.length > 0);

  return (
    <Modal
      open={open}
      onClose={onClose}
      width="min(1200px, 96vw)"
      className={styles.aliasOverviewModal}
      title={
        <div className={styles.batchModelTestModalHeader}>
          <span className={styles.modalTitleInline}>
            <span className={styles.modalTitleText}>{t('auth_files.alias_overview_title')}</span>
            <span className={styles.typeBadge} style={scopeBadgeStyle}>
              {scopeLabel}
            </span>
          </span>
          <div className={styles.batchModelTestModalHint}>
            {t('models.routing_mindmap_hint')}
          </div>
        </div>
      }
      footer={
        <Button variant="secondary" onClick={onClose}>
          {t('common.close')}
        </Button>
      }
    >
      {modelAliasError === 'unsupported' ? (
        <EmptyState
          title={t('oauth_model_alias.upgrade_required_title')}
          description={t('oauth_model_alias.upgrade_required_desc')}
        />
      ) : !hasDiagramData ? (
        <EmptyState
          title={t('oauth_model_alias.list_empty_all')}
          description={t('auth_files.alias_overview_empty_desc')}
        />
      ) : (
        <div className={styles.aliasOverviewDiagramWrap}>
          <ModelMappingDiagram
            ref={diagramRef}
            modelAlias={filtered.modelAlias}
            allProviderModels={filtered.allProviderModels}
            providerAliasSeeds={filtered.providerAliasSeeds}
            onUpdate={disableControls ? undefined : onUpdate}
            onDeleteLink={disableControls ? undefined : onDeleteLink}
            onToggleFork={disableControls ? undefined : onToggleFork}
            onRenameAlias={disableControls ? undefined : onRenameAlias}
            onDeleteAlias={disableControls ? undefined : onDeleteAlias}
            onDeleteProvider={disableControls ? undefined : onDeleteProvider}
          />
        </div>
      )}
    </Modal>
  );
}
