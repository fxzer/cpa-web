import { useMemo, useState } from 'react';
import { useTranslation } from 'react-i18next';
import { Modal } from '@/components/ui/Modal';
import { EmptyState } from '@/components/ui/EmptyState';
import { ModelMappingDiagram } from '@/components/modelAlias';
import { buildGlobalAliasDiagramData } from '@/utils/providerModelAliasCatalog';
import type { Config } from '@/types';
import type { OAuthModelAliasEntry } from '@/types/oauth';
import type { AuthFileModelItem } from '@/features/authFiles/constants';
import styles from '@/pages/AiProvidersPage.module.scss';

export type RoutingMindMapModalProps = {
  open: boolean;
  config: Config | null;
  onClose: () => void;
};

export function RoutingMindMapModal(props: RoutingMindMapModalProps) {
  const { open, config, onClose } = props;
  const { t } = useTranslation();

  const diagramData = useMemo(() => buildGlobalAliasDiagramData(config), [config]);

  const providerKeys = useMemo(() => {
    const keys = new Set<string>();
    Object.keys(diagramData.modelAlias).forEach((k) => keys.add(k));
    Object.keys(diagramData.allProviderModels).forEach((k) => keys.add(k));
    return Array.from(keys).sort();
  }, [diagramData]);

  const [providerFilter, setProviderFilter] = useState<string>('all');

  const filteredData = useMemo(() => {
    if (providerFilter === 'all') return diagramData;

    const filterKey = providerFilter.toLowerCase();
    const modelAlias: Record<string, OAuthModelAliasEntry[]> = {};
    const allProviderModels: Record<string, AuthFileModelItem[]> = {};

    Object.entries(diagramData.modelAlias).forEach(([key, value]) => {
      if (key.toLowerCase() === filterKey) {
        modelAlias[key] = value;
      }
    });
    Object.entries(diagramData.allProviderModels).forEach(([key, value]) => {
      if (key.toLowerCase() === filterKey) {
        allProviderModels[key] = value;
      }
    });

    return { modelAlias, allProviderModels, providerAliasSeeds: {} };
  }, [diagramData, providerFilter]);

  const hasDiagramData =
    Object.keys(filteredData.modelAlias).length > 0 ||
    Object.keys(filteredData.allProviderModels).length > 0;

  return (
    <Modal
      open={open}
      onClose={onClose}
      width="96vw"
      className={styles.aliasOverviewModal}
      title={t('models.routing_mindmap_title')}
    >
      {providerKeys.length > 1 && (
        <div
          style={{
            display: 'flex',
            alignItems: 'center',
            gap: '6px',
            flexWrap: 'wrap',
            paddingBottom: '16px',
          }}
        >
          {['all', ...providerKeys].map((key) => {
            const active = key === providerFilter;
            return (
              <button
                key={key}
                type="button"
                className={`${styles.segmentItem} ${active ? styles.segmentItemActive : ''}`}
                style={{
                  padding: '4px 12px',
                  fontSize: '13px',
                  fontWeight: active ? 600 : 500,
                  ...(active ? {} : { border: '1px solid var(--border-color)' }),
                }}
                onClick={() => setProviderFilter(key)}
              >
                {key === 'all' ? t('models.routing_mindmap_filter_all') : key}
              </button>
            );
          })}
        </div>
      )}
      {!hasDiagramData ? (
        <EmptyState
          title={t('oauth_model_alias.list_empty_all')}
          description={t('models.routing_mindmap_empty_desc')}
        />
      ) : (
        <div className={styles.aliasOverviewDiagramWrap} role="region" aria-label={t('models.routing_mindmap_title')}>
          <ModelMappingDiagram
            modelAlias={filteredData.modelAlias}
            allProviderModels={filteredData.allProviderModels}
            providerAliasSeeds={filteredData.providerAliasSeeds}
          />
        </div>
      )}
    </Modal>
  );
}
