import { useCallback, useEffect, useMemo, useRef, useState } from 'react';
import { Trans, useTranslation } from 'react-i18next';
import { authFilesApi } from '@/services/api';
import { configApi } from '@/services/api/config';
import { useNotificationStore } from '@/stores';
import type { AuthFileItem, OAuthModelAliasEntry } from '@/types';
import type { AuthFileModelItem } from '@/features/authFiles/constants';
import {
  applyAliasEntriesToRows,
  buildProviderModelAliasMap,
  buildProviderModelsMap,
  clearProviderAliases,
  cloneConfigRows,
  configToModelAliasEntries,
  removeAliasLink,
  removeAliasNameFromRows,
  renameAliasInRows,
  resolveRepresentativeAuthFile,
  toggleRowFork,
  type ProviderModelsConfigEntry,
} from '@/utils/authFileModelsConfig';
import {
  isDistinctOAuthModelAlias,
  resolveOAuthModelAliasChannel,
  upsertOAuthModelAliasLink,
} from '@/utils/oauthModelAliasForm';
import { collectProviderAliasSeeds } from '@/utils/providerModelAliasCatalog';

type UnsupportedError = 'unsupported' | null;

export type UseAuthFilesOauthResult = {
  modelAlias: Record<string, OAuthModelAliasEntry[]>;
  modelAliasError: UnsupportedError;
  allProviderModels: Record<string, AuthFileModelItem[]>;
  providerAliasSeeds: Record<string, string[]>;
  providerList: string[];
  reloadProviderConfigs: () => Promise<void>;
  deleteModelAlias: (provider: string) => void;
  handleMappingUpdate: (provider: string, sourceModel: string, newAlias: string) => Promise<void>;
  handleDeleteLink: (provider: string, sourceModel: string, alias: string) => void;
  handleToggleFork: (
    provider: string,
    sourceModel: string,
    alias: string,
    fork: boolean
  ) => Promise<void>;
  handleRenameAlias: (oldAlias: string, newAlias: string) => Promise<void>;
  handleDeleteAlias: (aliasName: string) => void;
};

export type UseAuthFilesOauthOptions = {
  diagramOpen: boolean;
  files: AuthFileItem[];
  onAliasConfigChanged?: () => void;
};

export function useAuthFilesOauth(options: UseAuthFilesOauthOptions): UseAuthFilesOauthResult {
  const { diagramOpen, files, onAliasConfigChanged } = options;
  const { t } = useTranslation();
  const { showNotification, showConfirmation } = useNotificationStore();

  const [providerConfigs, setProviderConfigs] = useState<Record<string, ProviderModelsConfigEntry>>(
    {}
  );
  const [modelAliasError, setModelAliasError] = useState<UnsupportedError>(null);
  const [allProviderModels, setAllProviderModels] = useState<Record<string, AuthFileModelItem[]>>(
    {}
  );
  const [providerAliasSeeds, setProviderAliasSeeds] = useState<Record<string, string[]>>({});
  const [configsLoading, setConfigsLoading] = useState(false);

  const providerConfigsRef = useRef(providerConfigs);
  providerConfigsRef.current = providerConfigs;

  const providerList = useMemo(() => {
    const providers = new Set<string>();

    files.forEach((file) => {
      if (typeof file.type === 'string') {
        const key = resolveOAuthModelAliasChannel(file.type);
        if (key) providers.add(key);
      }
      if (typeof file.provider === 'string') {
        const key = resolveOAuthModelAliasChannel(file.provider);
        if (key) providers.add(key);
      }
    });
    return Array.from(providers);
  }, [files]);

  const modelAlias = useMemo(
    () => buildProviderModelAliasMap(providerConfigs),
    [providerConfigs]
  );

  const notifyAliasConfigChanged = useCallback(() => {
    onAliasConfigChanged?.();
  }, [onAliasConfigChanged]);

  const persistProviderRows = useCallback(
    async (provider: string, rows: ReturnType<typeof cloneConfigRows>) => {
      const normalizedProvider = resolveOAuthModelAliasChannel(provider);
      if (!normalizedProvider) return;

      const cached = providerConfigsRef.current[normalizedProvider];
      const file =
        cached?.fileName != null
          ? files.find((item) => item.name === cached.fileName)
          : resolveRepresentativeAuthFile(files, normalizedProvider);

      if (!file) {
        throw new Error('representative auth file not found');
      }

      await authFilesApi.saveAuthFileModelsConfig(file.name, rows);
      const config = await authFilesApi.getAuthFileModelsConfig(file.name);
      setProviderConfigs((prev) => ({
        ...prev,
        [normalizedProvider]: { fileName: file.name, config },
      }));
      notifyAliasConfigChanged();
    },
    [files, notifyAliasConfigChanged]
  );

  const reloadProviderConfigs = useCallback(async () => {
    if (providerList.length === 0) {
      setProviderConfigs({});
      setAllProviderModels({});
      setModelAliasError(null);
      return;
    }

    setConfigsLoading(true);
    try {
      const results = await Promise.all(
        providerList.map(async (provider) => {
          const file = resolveRepresentativeAuthFile(files, provider);
          if (!file) return null;
          const config = await authFilesApi.getAuthFileModelsConfig(file.name);
          return {
            provider,
            entry: { fileName: file.name, config } satisfies ProviderModelsConfigEntry,
          };
        })
      );

      const nextEntries: Record<string, ProviderModelsConfigEntry> = {};
      results.forEach((result) => {
        if (result) {
          nextEntries[result.provider] = result.entry;
        }
      });

      setProviderConfigs(nextEntries);
      setAllProviderModels(buildProviderModelsMap(nextEntries));
      setModelAliasError(null);
    } catch (err: unknown) {
      const status =
        typeof err === 'object' && err !== null && 'status' in err
          ? (err as { status?: unknown }).status
          : undefined;
      if (status === 404) {
        setProviderConfigs({});
        setAllProviderModels({});
        setModelAliasError('unsupported');
      }
      throw err;
    } finally {
      setConfigsLoading(false);
    }
  }, [files, providerList]);

  useEffect(() => {
    if (!diagramOpen) return;
    void reloadProviderConfigs().catch(() => {});
  }, [diagramOpen, reloadProviderConfigs]);

  useEffect(() => {
    if (!diagramOpen) return;

    let cancelled = false;

    const loadProviderAliasSeeds = async () => {
      try {
        const config = await configApi.getConfig();
        if (!cancelled) {
          setProviderAliasSeeds(collectProviderAliasSeeds(config));
        }
      } catch {
        if (!cancelled) setProviderAliasSeeds({});
      }
    };

    void loadProviderAliasSeeds();

    return () => {
      cancelled = true;
    };
  }, [diagramOpen]);

  const deleteModelAlias = useCallback(
    (provider: string) => {
      showConfirmation({
        title: t('oauth_model_alias.delete_title', { defaultValue: 'Delete Mappings' }),
        message: t('oauth_model_alias.delete_confirm', { provider }),
        variant: 'danger',
        confirmText: t('common.confirm'),
        onConfirm: async () => {
          try {
            const normalizedProvider = resolveOAuthModelAliasChannel(provider);
            if (!normalizedProvider) return;
            const cached = providerConfigsRef.current[normalizedProvider];
            if (!cached) return;
            const nextRows = clearProviderAliases(cloneConfigRows(cached.config.rows));
            await persistProviderRows(normalizedProvider, nextRows);
            showNotification(t('oauth_model_alias.delete_success'), 'success');
          } catch (err: unknown) {
            const errorMessage = err instanceof Error ? err.message : '';
            showNotification(`${t('oauth_model_alias.delete_failed')}: ${errorMessage}`, 'error');
          }
        },
      });
    },
    [persistProviderRows, showConfirmation, showNotification, t]
  );

  const handleMappingUpdate = useCallback(
    async (provider: string, sourceModel: string, newAlias: string) => {
      if (!provider || !sourceModel || !newAlias) return;
      const normalizedProvider = resolveOAuthModelAliasChannel(provider);
      if (!normalizedProvider) return;

      const nameTrim = sourceModel.trim();
      const aliasTrim = newAlias.trim();

      if (!isDistinctOAuthModelAlias(nameTrim, aliasTrim)) {
        showNotification(t('oauth_model_alias.name_equals_alias'), 'error');
        return;
      }

      try {
        const cached = providerConfigsRef.current[normalizedProvider];
        if (!cached) return;

        const currentMappings = configToModelAliasEntries(cached.config);
        const nextMappings = upsertOAuthModelAliasLink(currentMappings, nameTrim, aliasTrim);

        if (nextMappings === 'duplicate') {
          showNotification(t('oauth_model_alias.link_already_exists'), 'info');
          return;
        }

        const nextRows = applyAliasEntriesToRows(cloneConfigRows(cached.config.rows), nextMappings);
        await persistProviderRows(normalizedProvider, nextRows);
        showNotification(t('oauth_model_alias.save_success'), 'success');
      } catch (err: unknown) {
        const errorMessage = err instanceof Error ? err.message : '';
        showNotification(`${t('oauth_model_alias.save_failed')}: ${errorMessage}`, 'error');
      }
    },
    [persistProviderRows, showNotification, t]
  );

  const handleDeleteLink = useCallback(
    (provider: string, sourceModel: string, alias: string) => {
      const nameTrim = sourceModel.trim();
      const aliasTrim = alias.trim();
      if (!provider || !nameTrim || !aliasTrim) return;

      showConfirmation({
        title: t('oauth_model_alias.delete_link_title', { defaultValue: 'Unlink mapping' }),
        message: (
          <Trans
            i18nKey="oauth_model_alias.delete_link_confirm"
            values={{ provider, sourceModel: nameTrim, alias: aliasTrim }}
            components={{ code: <code /> }}
          />
        ),
        variant: 'danger',
        confirmText: t('common.confirm'),
        onConfirm: async () => {
          const normalizedProvider = resolveOAuthModelAliasChannel(provider);
          const cached = providerConfigsRef.current[normalizedProvider];
          if (!cached) return;

          const nextRows = removeAliasLink(cloneConfigRows(cached.config.rows), nameTrim, aliasTrim);
          try {
            await persistProviderRows(normalizedProvider, nextRows);
            showNotification(t('oauth_model_alias.save_success'), 'success');
          } catch (err: unknown) {
            const errorMessage = err instanceof Error ? err.message : '';
            showNotification(`${t('oauth_model_alias.save_failed')}: ${errorMessage}`, 'error');
          }
        },
      });
    },
    [persistProviderRows, showConfirmation, showNotification, t]
  );

  const handleToggleFork = useCallback(
    async (provider: string, sourceModel: string, alias: string, fork: boolean) => {
      const normalizedProvider = resolveOAuthModelAliasChannel(provider);
      const cached = providerConfigsRef.current[normalizedProvider];
      if (!normalizedProvider || !cached) return;

      const nextRows = toggleRowFork(
        cloneConfigRows(cached.config.rows),
        sourceModel,
        alias,
        fork
      );

      try {
        await persistProviderRows(normalizedProvider, nextRows);
        showNotification(t('oauth_model_alias.save_success'), 'success');
      } catch (err: unknown) {
        const errorMessage = err instanceof Error ? err.message : '';
        showNotification(`${t('oauth_model_alias.save_failed')}: ${errorMessage}`, 'error');
      }
    },
    [persistProviderRows, showNotification, t]
  );

  const handleRenameAlias = useCallback(
    async (oldAlias: string, newAlias: string) => {
      const oldTrim = oldAlias.trim();
      const newTrim = newAlias.trim();
      if (!oldTrim || !newTrim || oldTrim === newTrim) return;

      const providersToUpdate = Object.entries(providerConfigsRef.current).filter(([_, entry]) =>
        entry.config.rows.some(
          (row) => String(row.alias ?? '').trim().toLowerCase() === oldTrim.toLowerCase()
        )
      );

      if (providersToUpdate.length === 0) return;

      let hadFailure = false;
      let failureMessage = '';

      try {
        const results = await Promise.allSettled(
          providersToUpdate.map(([provider, entry]) => {
            const nextRows = renameAliasInRows(cloneConfigRows(entry.config.rows), oldTrim, newTrim);
            return persistProviderRows(provider, nextRows);
          })
        );

        const failures = results.filter(
          (result): result is PromiseRejectedResult => result.status === 'rejected'
        );

        if (failures.length > 0) {
          hadFailure = true;
          const reason = failures[0].reason;
          failureMessage = reason instanceof Error ? reason.message : String(reason ?? '');
        }
      } catch (err: unknown) {
        hadFailure = true;
        failureMessage = err instanceof Error ? err.message : '';
      }

      if (hadFailure) {
        showNotification(
          failureMessage
            ? `${t('oauth_model_alias.save_failed')}: ${failureMessage}`
            : t('oauth_model_alias.save_failed'),
          'error'
        );
      } else {
        showNotification(t('oauth_model_alias.save_success'), 'success');
      }
    },
    [persistProviderRows, showNotification, t]
  );

  const handleDeleteAlias = useCallback(
    (aliasName: string) => {
      const aliasTrim = aliasName.trim();
      if (!aliasTrim) return;

      const providersToUpdate = Object.entries(providerConfigsRef.current).filter(([_, entry]) =>
        entry.config.rows.some(
          (row) => String(row.alias ?? '').trim().toLowerCase() === aliasTrim.toLowerCase()
        )
      );

      if (providersToUpdate.length === 0) return;

      showConfirmation({
        title: t('oauth_model_alias.delete_alias_title', { defaultValue: 'Delete Alias' }),
        message: (
          <Trans
            i18nKey="oauth_model_alias.delete_alias_confirm"
            values={{ alias: aliasTrim }}
            components={{ code: <code /> }}
          />
        ),
        variant: 'danger',
        confirmText: t('common.confirm'),
        onConfirm: async () => {
          let hadFailure = false;
          let failureMessage = '';

          try {
            const results = await Promise.allSettled(
              providersToUpdate.map(([provider, entry]) => {
                const nextRows = removeAliasNameFromRows(cloneConfigRows(entry.config.rows), aliasTrim);
                return persistProviderRows(provider, nextRows);
              })
            );

            const failures = results.filter(
              (result): result is PromiseRejectedResult => result.status === 'rejected'
            );

            if (failures.length > 0) {
              hadFailure = true;
              const reason = failures[0].reason;
              failureMessage = reason instanceof Error ? reason.message : String(reason ?? '');
            }
          } catch (err: unknown) {
            hadFailure = true;
            failureMessage = err instanceof Error ? err.message : '';
          }

          if (hadFailure) {
            showNotification(
              failureMessage
                ? `${t('oauth_model_alias.delete_failed')}: ${failureMessage}`
                : t('oauth_model_alias.delete_failed'),
              'error'
            );
          } else {
            showNotification(t('oauth_model_alias.delete_success'), 'success');
          }
        },
      });
    },
    [persistProviderRows, showConfirmation, showNotification, t]
  );

  return {
    modelAlias,
    modelAliasError: configsLoading ? null : modelAliasError,
    allProviderModels,
    providerAliasSeeds,
    providerList,
    reloadProviderConfigs,
    deleteModelAlias,
    handleMappingUpdate,
    handleDeleteLink,
    handleToggleFork,
    handleRenameAlias,
    handleDeleteAlias,
  };
}
