import { useCallback, useEffect, useMemo, useState } from 'react';
import { useLocation, useNavigate, useSearchParams } from 'react-router-dom';
import { useTranslation } from 'react-i18next';
import { Card } from '@/components/ui/Card';
import { Button } from '@/components/ui/Button';
import { AutocompleteInput } from '@/components/ui/AutocompleteInput';
import { EmptyState } from '@/components/ui/EmptyState';
import { ToggleSwitch } from '@/components/ui/ToggleSwitch';
import { IconInfo, IconX } from '@/components/ui/icons';
import { SecondaryScreenShell } from '@/components/common/SecondaryScreenShell';
import { useEdgeSwipeBack } from '@/hooks/useEdgeSwipeBack';
import { useAuthStore, useNotificationStore } from '@/stores';
import { authFilesApi } from '@/services/api';
import type { AuthFileItem, OAuthModelAliasEntry } from '@/types';
import {
  buildEmptyMappingEntry,
  buildMappingsFromModels,
  normalizeMappingEntries,
  normalizeMappingsForSave,
  resolveProviderAliasKey,
  summarizeMappingEntries,
  type OAuthModelMappingFormEntry,
} from '@/utils/oauthModelAliasForm';
import styles from './AuthFilesOAuthModelAliasEditPage.module.scss';

type AuthFileModelItem = { id: string; display_name?: string; type?: string; owned_by?: string };

type LocationState = { fromAuthFiles?: boolean } | null;

type MappingFilter = 'all' | 'aliased' | 'passthrough';

const OAUTH_PROVIDER_PRESETS = [
  'gemini-cli',
  'vertex',
  'aistudio',
  'antigravity',
  'claude',
  'codex',
  'qwen',
  'kimi',
  'iflow',
];

const OAUTH_PROVIDER_EXCLUDES = new Set(['all', 'unknown', 'empty']);

const normalizeProviderKey = (value: string) => value.trim().toLowerCase();

export function AuthFilesOAuthModelAliasEditPage() {
  const { t } = useTranslation();
  const navigate = useNavigate();
  const location = useLocation();
  const { showNotification } = useNotificationStore();
  const connectionStatus = useAuthStore((state) => state.connectionStatus);
  const disableControls = connectionStatus !== 'connected';

  const [searchParams, setSearchParams] = useSearchParams();
  const providerFromParams = searchParams.get('provider') ?? '';

  const [provider, setProvider] = useState(providerFromParams);
  const [files, setFiles] = useState<AuthFileItem[]>([]);
  const [excluded, setExcluded] = useState<Record<string, string[]>>({});
  const [modelAlias, setModelAlias] = useState<Record<string, OAuthModelAliasEntry[]>>({});
  const [initialLoading, setInitialLoading] = useState(true);
  const [modelAliasUnsupported, setModelAliasUnsupported] = useState(false);

  const [mappings, setMappings] = useState<OAuthModelMappingFormEntry[]>([]);
  const [formSeed, setFormSeed] = useState('');
  const [modelsList, setModelsList] = useState<AuthFileModelItem[]>([]);
  const [modelsLoading, setModelsLoading] = useState(false);
  const [modelsError, setModelsError] = useState<'unsupported' | null>(null);
  const [saving, setSaving] = useState(false);
  const [search, setSearch] = useState('');
  const [mappingFilter, setMappingFilter] = useState<MappingFilter>('all');

  useEffect(() => {
    setProvider(providerFromParams);
  }, [providerFromParams]);

  const providerOptions = useMemo(() => {
    const extraProviders = new Set<string>();
    Object.keys(excluded).forEach((value) => extraProviders.add(value));
    Object.keys(modelAlias).forEach((value) => extraProviders.add(value));
    files.forEach((file) => {
      if (typeof file.type === 'string') {
        extraProviders.add(file.type);
      }
      if (typeof file.provider === 'string') {
        extraProviders.add(file.provider);
      }
    });

    const normalizedExtras = Array.from(extraProviders)
      .map((value) => value.trim())
      .filter((value) => value && !OAUTH_PROVIDER_EXCLUDES.has(value.toLowerCase()));

    const baseSet = new Set(OAUTH_PROVIDER_PRESETS.map((value) => value.toLowerCase()));
    const extraList = normalizedExtras
      .filter((value) => !baseSet.has(value.toLowerCase()))
      .sort((a, b) => a.localeCompare(b));

    return [...OAUTH_PROVIDER_PRESETS, ...extraList];
  }, [excluded, files, modelAlias]);

  const catalogModelNames = useMemo(
    () => new Set(modelsList.map((model) => model.id.trim().toLowerCase()).filter(Boolean)),
    [modelsList]
  );

  const mappingSummary = useMemo(() => summarizeMappingEntries(mappings), [mappings]);

  const getTypeLabel = useCallback(
    (type: string): string => {
      const key = `auth_files.filter_${type}`;
      const translated = t(key);
      if (translated !== key) return translated;
      if (type.toLowerCase() === 'iflow') return 'iFlow';
      return type.charAt(0).toUpperCase() + type.slice(1);
    },
    [t]
  );

  const resolvedProviderKey = useMemo(() => normalizeProviderKey(provider), [provider]);
  const title = useMemo(() => t('oauth_model_alias.add_title'), [t]);
  const headerHint = useMemo(() => {
    if (!provider.trim()) {
      return t('oauth_model_alias.provider_hint');
    }
    if (modelsLoading) {
      return t('oauth_model_alias.model_source_loading');
    }
    if (modelsError === 'unsupported') {
      return t('oauth_model_alias.model_source_unsupported');
    }
    return t('oauth_model_alias.model_source_loaded', { count: modelsList.length });
  }, [modelsError, modelsList.length, modelsLoading, provider, t]);

  const filteredMappings = useMemo(() => {
    const keyword = search.trim().toLowerCase();
    return mappings.filter((entry) => {
      const name = String(entry.name ?? '').trim();
      const alias = String(entry.alias ?? '').trim();
      const hasAlias = Boolean(alias);

      if (mappingFilter === 'aliased' && !hasAlias) return false;
      if (mappingFilter === 'passthrough' && hasAlias) return false;

      if (!keyword) return true;
      return name.toLowerCase().includes(keyword) || alias.toLowerCase().includes(keyword);
    });
  }, [mappingFilter, mappings, search]);

  const handleBack = useCallback(() => {
    const state = location.state as LocationState;
    if (state?.fromAuthFiles) {
      navigate(-1);
      return;
    }
    navigate('/auth-files', { replace: true });
  }, [location.state, navigate]);

  const swipeRef = useEdgeSwipeBack({ onBack: handleBack });

  useEffect(() => {
    const handleKeyDown = (event: KeyboardEvent) => {
      if (event.key === 'Escape') {
        handleBack();
      }
    };
    window.addEventListener('keydown', handleKeyDown);
    return () => window.removeEventListener('keydown', handleKeyDown);
  }, [handleBack]);

  useEffect(() => {
    let cancelled = false;

    const load = async () => {
      setInitialLoading(true);
      setModelAliasUnsupported(false);
      try {
        const [filesResult, excludedResult, aliasResult] = await Promise.allSettled([
          authFilesApi.list(),
          authFilesApi.getOauthExcludedModels(),
          authFilesApi.getOauthModelAlias(),
        ]);

        if (cancelled) return;

        if (filesResult.status === 'fulfilled') {
          setFiles(filesResult.value?.files ?? []);
        }

        if (excludedResult.status === 'fulfilled') {
          setExcluded(excludedResult.value ?? {});
        }

        if (aliasResult.status === 'fulfilled') {
          setModelAlias(aliasResult.value ?? {});
          return;
        }

        const err = aliasResult.status === 'rejected' ? aliasResult.reason : null;
        const status =
          typeof err === 'object' && err !== null && 'status' in err
            ? (err as { status?: unknown }).status
            : undefined;

        if (status === 404) {
          setModelAliasUnsupported(true);
        }
      } finally {
        if (!cancelled) {
          setInitialLoading(false);
        }
      }
    };

    load().catch(() => {
      if (!cancelled) {
        setInitialLoading(false);
      }
    });

    return () => {
      cancelled = true;
    };
  }, []);

  useEffect(() => {
    if (!resolvedProviderKey || modelsLoading) {
      return;
    }

    const providerKey = resolveProviderAliasKey(modelAlias, provider) ?? resolvedProviderKey;
    const existing = modelAlias[providerKey] ?? [];
    const seed = [
      resolvedProviderKey,
      modelsError ?? 'ok',
      modelsList.map((model) => model.id).join('\u0001'),
      JSON.stringify(existing),
    ].join('\u0002');

    if (seed === formSeed) {
      return;
    }

    if (modelsList.length > 0) {
      setMappings(buildMappingsFromModels(modelsList, existing));
    } else if (modelsError === 'unsupported') {
      setMappings(
        existing.length > 0 ? normalizeMappingEntries(existing) : [buildEmptyMappingEntry()]
      );
    } else {
      setMappings(existing.length > 0 ? normalizeMappingEntries(existing) : []);
    }
    setFormSeed(seed);
  }, [
    formSeed,
    modelAlias,
    modelsError,
    modelsList,
    modelsLoading,
    provider,
    resolvedProviderKey,
  ]);

  useEffect(() => {
    if (!resolvedProviderKey || modelAliasUnsupported) {
      setModelsList([]);
      setModelsError(null);
      setModelsLoading(false);
      return;
    }

    let cancelled = false;
    setModelsLoading(true);
    setModelsError(null);
    setFormSeed('');

    authFilesApi
      .getModelDefinitions(resolvedProviderKey)
      .then((models) => {
        if (cancelled) return;
        setModelsList(models);
      })
      .catch((err: unknown) => {
        if (cancelled) return;
        const status =
          typeof err === 'object' && err !== null && 'status' in err
            ? (err as { status?: unknown }).status
            : undefined;

        if (status === 404) {
          setModelsList([]);
          setModelsError('unsupported');
          return;
        }

        const errorMessage = err instanceof Error ? err.message : '';
        showNotification(`${t('notification.load_failed')}: ${errorMessage}`, 'error');
      })
      .finally(() => {
        if (cancelled) return;
        setModelsLoading(false);
      });

    return () => {
      cancelled = true;
    };
  }, [modelAliasUnsupported, resolvedProviderKey, showNotification, t]);

  const updateProvider = useCallback(
    (value: string) => {
      setProvider(value);
      setSearch('');
      setMappingFilter('all');
      setFormSeed('');
      const next = new URLSearchParams(searchParams);
      const trimmed = value.trim();
      if (trimmed) {
        next.set('provider', trimmed);
      } else {
        next.delete('provider');
      }
      setSearchParams(next, { replace: true });
    },
    [searchParams, setSearchParams]
  );

  const updateMappingEntry = useCallback(
    (index: number, field: keyof OAuthModelAliasEntry, value: string | boolean) => {
      setMappings((prev) =>
        prev.map((entry, idx) => (idx === index ? { ...entry, [field]: value } : entry))
      );
    },
    []
  );

  const addManualMappingEntry = useCallback(() => {
    setMappings((prev) => [...prev, buildEmptyMappingEntry()]);
  }, []);

  const removeMappingEntry = useCallback((index: number) => {
    setMappings((prev) => prev.filter((_, idx) => idx !== index));
  }, []);

  const handleSave = useCallback(async () => {
    const channel = provider.trim();
    if (!channel) {
      showNotification(t('oauth_model_alias.provider_required'), 'error');
      return;
    }

    const normalized = normalizeMappingsForSave(mappings);

    setSaving(true);
    try {
      if (normalized.length) {
        await authFilesApi.saveOauthModelAlias(channel, normalized);
      } else {
        await authFilesApi.deleteOauthModelAlias(channel);
      }
      showNotification(t('oauth_model_alias.save_success'), 'success');
      handleBack();
    } catch (err: unknown) {
      const errorMessage = err instanceof Error ? err.message : '';
      showNotification(`${t('oauth_model_alias.save_failed')}: ${errorMessage}`, 'error');
    } finally {
      setSaving(false);
    }
  }, [handleBack, mappings, provider, showNotification, t]);

  const canSave = !disableControls && !saving && !modelAliasUnsupported;

  return (
    <SecondaryScreenShell
      ref={swipeRef}
      title={title}
      onBack={handleBack}
      backLabel={t('common.back')}
      backAriaLabel={t('common.back')}
      contentClassName={styles.pageContent}
      rightAction={
        <Button size="sm" onClick={handleSave} loading={saving} disabled={!canSave}>
          {t('oauth_model_alias.save')}
        </Button>
      }
      isLoading={initialLoading}
      loadingLabel={t('common.loading')}
    >
      {modelAliasUnsupported ? (
        <Card>
          <EmptyState
            title={t('oauth_model_alias.upgrade_required_title')}
            description={t('oauth_model_alias.upgrade_required_desc')}
          />
        </Card>
      ) : (
        <>
          <Card className={styles.settingsCard}>
            <div className={styles.settingsHeader}>
              <div className={styles.settingsHeaderTitle}>
                <IconInfo size={16} />
                <span>{t('oauth_model_alias.title')}</span>
              </div>
              <div className={styles.settingsHeaderHint}>{headerHint}</div>
            </div>

            <div className={styles.settingsSection}>
              <div className={styles.settingsRow}>
                <div className={styles.settingsInfo}>
                  <div className={styles.settingsLabel}>{t('oauth_model_alias.provider_label')}</div>
                  <div className={styles.settingsDesc}>{t('oauth_model_alias.provider_hint')}</div>
                </div>
                <div className={styles.settingsControl}>
                  <AutocompleteInput
                    id="oauth-model-alias-provider"
                    placeholder={t('oauth_model_alias.provider_placeholder')}
                    value={provider}
                    onChange={updateProvider}
                    options={providerOptions}
                    disabled={disableControls || saving}
                    wrapperStyle={{ marginBottom: 0 }}
                  />
                </div>
              </div>

              {providerOptions.length > 0 && (
                <div className={styles.tagList}>
                  {providerOptions.map((option) => {
                    const isActive = normalizeProviderKey(provider) === option.toLowerCase();
                    return (
                      <button
                        key={option}
                        type="button"
                        className={`${styles.tag} ${isActive ? styles.tagActive : ''}`}
                        onClick={() => updateProvider(option)}
                        disabled={disableControls || saving}
                      >
                        {getTypeLabel(option)}
                      </button>
                    );
                  })}
                </div>
              )}
            </div>
          </Card>

          <Card className={styles.settingsCard}>
            <div className={styles.mappingsHeader}>
              <div>
                <div className={styles.mappingsTitle}>{t('oauth_model_alias.alias_label')}</div>
                <div className={styles.mappingsSummary}>
                  {t('oauth_model_alias.mapping_summary', {
                    total: mappingSummary.total,
                    aliased: mappingSummary.aliasedModels,
                    passthrough: mappingSummary.passthroughModels,
                  })}
                </div>
              </div>
              {modelsError === 'unsupported' && (
                <Button
                  variant="secondary"
                  size="sm"
                  onClick={addManualMappingEntry}
                  disabled={disableControls || saving}
                >
                  {t('oauth_model_alias.add_alias')}
                </Button>
              )}
            </div>

            <div className={styles.modelsHint}>{t('oauth_model_alias.mapping_passthrough_hint')}</div>

            {mappingSummary.total > 0 && (
              <div className={styles.mappingToolbar}>
                <input
                  className={`input ${styles.mappingSearch}`}
                  placeholder={t('oauth_model_alias.mapping_search_placeholder')}
                  value={search}
                  onChange={(event) => setSearch(event.target.value)}
                  disabled={disableControls || saving}
                />
                <div className={styles.filterTabs}>
                  {(['all', 'aliased', 'passthrough'] as MappingFilter[]).map((filter) => (
                    <button
                      key={filter}
                      type="button"
                      className={`${styles.filterTab} ${mappingFilter === filter ? styles.filterTabActive : ''}`}
                      onClick={() => setMappingFilter(filter)}
                      disabled={disableControls || saving}
                    >
                      {t(`oauth_model_alias.mapping_filter_${filter}`)}
                    </button>
                  ))}
                </div>
              </div>
            )}

            <div className={styles.mappingsBody}>
              {modelsLoading && mappings.length === 0 ? (
                <div className={styles.emptyMappings}>{t('oauth_model_alias.model_source_loading')}</div>
              ) : filteredMappings.length === 0 ? (
                <div className={styles.emptyMappings}>{t('oauth_model_alias.mapping_filter_empty')}</div>
              ) : (
                filteredMappings.map((entry) => {
                  const rowIndex = mappings.findIndex((item) => item.id === entry.id);
                  if (rowIndex < 0) return null;

                  const name = String(entry.name ?? '').trim();
                  const alias = String(entry.alias ?? '').trim();
                  const hasAlias = Boolean(alias);
                  const fromCatalog = catalogModelNames.has(name.toLowerCase());
                  const modelMeta = modelsList.find((model) => model.id === name);
                  const displayName =
                    modelMeta?.display_name && modelMeta.display_name !== name
                      ? modelMeta.display_name
                      : null;

                  return (
                    <div
                      key={entry.id}
                      className={`${styles.mappingRow} ${hasAlias ? styles.mappingRowAliased : styles.mappingRowPassthrough} ${!fromCatalog ? styles.mappingRowManual : ''}`}
                    >
                      <div className={styles.mappingNameBlock}>
                        {fromCatalog ? (
                          <>
                            <code className={styles.modelName} title={name}>
                              {name || t('oauth_model_alias.alias_name_placeholder')}
                            </code>
                            {displayName && <span className={styles.modelDisplayName}>{displayName}</span>}
                          </>
                        ) : (
                          <AutocompleteInput
                            wrapperStyle={{ flex: 1, marginBottom: 0 }}
                            placeholder={t('oauth_model_alias.alias_name_placeholder')}
                            value={entry.name}
                            onChange={(val) => updateMappingEntry(rowIndex, 'name', val)}
                            disabled={disableControls || saving}
                            options={modelsList.map((model) => ({
                              value: model.id,
                              label:
                                model.display_name && model.display_name !== model.id
                                  ? model.display_name
                                  : undefined,
                            }))}
                          />
                        )}
                        {!fromCatalog && name && (
                          <span className={styles.manualBadge}>{t('oauth_model_alias.manual_model_badge')}</span>
                        )}
                      </div>

                      <span className={styles.mappingSeparator}>→</span>

                      <input
                        className={`input ${styles.mappingAliasInput}`}
                        placeholder={t('oauth_model_alias.alias_empty_passthrough_placeholder')}
                        value={entry.alias}
                        onChange={(e) => updateMappingEntry(rowIndex, 'alias', e.target.value)}
                        disabled={disableControls || saving || !name}
                      />

                      <div className={styles.mappingFork}>
                        <ToggleSwitch
                          label={t('oauth_model_alias.alias_fork_label')}
                          labelPosition="left"
                          checked={Boolean(entry.fork)}
                          onChange={(value) => updateMappingEntry(rowIndex, 'fork', value)}
                          disabled={disableControls || saving || !hasAlias}
                        />
                      </div>

                      {!fromCatalog && (
                        <div className={styles.mappingActions}>
                          <Button
                            variant="ghost"
                            size="sm"
                            onClick={() => removeMappingEntry(rowIndex)}
                            disabled={disableControls || saving}
                            title={t('common.delete')}
                            aria-label={t('common.delete')}
                          >
                            <IconX size={14} />
                          </Button>
                        </div>
                      )}
                    </div>
                  );
                })
              )}
            </div>
          </Card>
        </>
      )}
    </SecondaryScreenShell>
  );
}
