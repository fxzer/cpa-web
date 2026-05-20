import { useCallback, useRef, useState } from 'react';
import { useTranslation } from 'react-i18next';
import { authFilesApi } from '@/services/api';
import { useNotificationStore, useModelsStore } from '@/stores';
import type { AuthFileItem } from '@/types';
import type { AuthFileModelsConfigResponse } from '@/types/oauth';

type ModelsError = 'unsupported' | null;

type ModelsCacheEntry = AuthFileModelsConfigResponse;

export type UseAuthFilesModelsResult = {
  modelsModalOpen: boolean;
  modelsLoading: boolean;
  modelsConfig: AuthFileModelsConfigResponse | null;
  modelsFileName: string;
  modelsError: ModelsError;
  showModels: (item: AuthFileItem) => Promise<void>;
  closeModelsModal: () => void;
  invalidateModelsCache: (fileName?: string) => void;
};

export function useAuthFilesModels(): UseAuthFilesModelsResult {
  const { t } = useTranslation();
  const showNotification = useNotificationStore((state) => state.showNotification);

  const [modelsModalOpen, setModelsModalOpen] = useState(false);
  const [modelsLoading, setModelsLoading] = useState(false);
  const [modelsConfig, setModelsConfig] = useState<AuthFileModelsConfigResponse | null>(null);
  const [modelsFileName, setModelsFileName] = useState('');
  const [modelsError, setModelsError] = useState<ModelsError>(null);
  const modelsCacheRef = useRef<Map<string, ModelsCacheEntry>>(new Map());

  const closeModelsModal = useCallback(() => {
    setModelsModalOpen(false);
  }, []);

  const invalidateModelsCache = useCallback((fileName?: string) => {
    if (fileName) {
      modelsCacheRef.current.delete(fileName);
    } else {
      modelsCacheRef.current.clear();
    }
    useModelsStore.getState().clearCache();
  }, []);

  const showModels = useCallback(
    async (item: AuthFileItem) => {
      setModelsFileName(item.name);
      setModelsConfig(null);
      setModelsError(null);
      setModelsModalOpen(true);

      const cached = modelsCacheRef.current.get(item.name);
      if (cached) {
        setModelsConfig(cached);
        setModelsLoading(false);
        return;
      }

      setModelsLoading(true);
      try {
        const config = await authFilesApi.getAuthFileModelsConfig(item.name);
        modelsCacheRef.current.set(item.name, config);
        setModelsConfig(config);
      } catch (err) {
        const errorMessage = err instanceof Error ? err.message : '';
        const status =
          typeof err === 'object' && err !== null && 'status' in err
            ? (err as { status?: unknown }).status
            : undefined;
        if (
          status === 404 ||
          errorMessage.includes('404') ||
          errorMessage.includes('not found') ||
          errorMessage.includes('Not Found')
        ) {
          setModelsError('unsupported');
        } else {
          showNotification(`${t('notification.load_failed')}: ${errorMessage}`, 'error');
        }
      } finally {
        setModelsLoading(false);
      }
    },
    [showNotification, t]
  );

  return {
    modelsModalOpen,
    modelsLoading,
    modelsConfig,
    modelsFileName,
    modelsError,
    showModels,
    closeModelsModal,
    invalidateModelsCache,
  };
}
