import {
  useCallback,
  useEffect,
  useLayoutEffect,
  useMemo,
  useRef,
  useState,
  type ChangeEvent,
} from 'react';
import { createPortal } from 'react-dom';
import { useTranslation } from 'react-i18next';
import { animate } from 'motion/mini';
import type { AnimationPlaybackControlsWithThen } from 'motion-dom';
import { useInterval } from '@/hooks/useInterval';
import { useHeaderRefresh } from '@/hooks/useHeaderRefresh';
import { usePageTransitionLayer } from '@/components/common/PageTransitionLayer';
import { Button } from '@/components/ui/Button';
import { Input } from '@/components/ui/Input';
import { EmptyState } from '@/components/ui/EmptyState';
import { copyToClipboard } from '@/utils/clipboard';
import {
  MAX_CARD_PAGE_SIZE,
  MIN_CARD_PAGE_SIZE,
  QUOTA_PROVIDER_TYPES,
  clampCardPageSize,
  getTypeLabel,
  hasAuthFileStatusMessage,
  isRuntimeOnlyAuthFile,
  normalizeProviderKey,
  parsePriorityValue,
  type QuotaProviderType,
  type ResolvedTheme,
} from '@/features/authFiles/constants';
import { AuthFileCard } from '@/features/authFiles/components/AuthFileCard';
import { AuthFileModelsModal } from '@/features/authFiles/components/AuthFileModelsModal';
import { AuthFilesPrefixProxyEditorModal } from '@/features/authFiles/components/AuthFilesPrefixProxyEditorModal';
import { OAuthAliasOverviewModal } from '@/features/authFiles/components/OAuthAliasOverviewModal';
import { useAuthFilesData } from '@/features/authFiles/hooks/useAuthFilesData';
import { useAuthFilesModels } from '@/features/authFiles/hooks/useAuthFilesModels';
import { useAuthFilesOauth } from '@/features/authFiles/hooks/useAuthFilesOauth';
import { useAuthFilesPrefixProxyEditor } from '@/features/authFiles/hooks/useAuthFilesPrefixProxyEditor';
import { useAuthFilesStatusBarCache } from '@/features/authFiles/hooks/useAuthFilesStatusBarCache';
import {
  AUTH_FILES_SORT_MODES,
  isAuthFilesSortMode,
  readAuthFilesUiState,
  readPersistedAuthFilesCompactMode,
  resolveAuthFilesStatusFilter,
  writeAuthFilesUiState,
  writePersistedAuthFilesCompactMode,
  type AuthFilesSortMode,
  type AuthFilesStatusFilter,
} from '@/features/authFiles/uiState';
import { useAuthStore, useNotificationStore, useThemeStore } from '@/stores';
import styles from './AuthFilesPage.module.scss';

const easePower3Out = (progress: number) => 1 - (1 - progress) ** 4;
const easePower2In = (progress: number) => progress ** 3;
const BATCH_BAR_BASE_TRANSFORM = 'translateX(-50%)';
const BATCH_BAR_HIDDEN_TRANSFORM = 'translateX(-50%) translateY(56px)';
const DEFAULT_REGULAR_PAGE_SIZE = 9;
const DEFAULT_COMPACT_PAGE_SIZE = 12;

const escapeWildcardSearchSegment = (value: string) =>
  value.replace(/[.*+?^${}()|[\]\\]/g, '\\$&');

const buildWildcardSearch = (value: string): RegExp | null => {
  if (!value.includes('*')) return null;
  const pattern = value.split('*').map(escapeWildcardSearchSegment).join('.*');
  return new RegExp(pattern, 'i');
};

export function AuthFilesPage() {
  const { t } = useTranslation();
  const showNotification = useNotificationStore((state) => state.showNotification);
  const connectionStatus = useAuthStore((state) => state.connectionStatus);
  const resolvedTheme: ResolvedTheme = useThemeStore((state) => state.resolvedTheme);
  const pageTransitionLayer = usePageTransitionLayer();
  const isCurrentLayer = pageTransitionLayer ? pageTransitionLayer.status === 'current' : true;

  const [filter, setFilter] = useState<'all' | string>('all');
  const [statusFilter, setStatusFilter] = useState<AuthFilesStatusFilter>('all');
  const [compactMode, setCompactMode] = useState(false);
  const [search, setSearch] = useState('');
  const [page, setPage] = useState(1);
  const [pageSizeByMode, setPageSizeByMode] = useState({
    regular: DEFAULT_REGULAR_PAGE_SIZE,
    compact: DEFAULT_COMPACT_PAGE_SIZE,
  });
  const [pageSizeInput, setPageSizeInput] = useState('9');
  const [aliasOverviewOpen, setAliasOverviewOpen] = useState(false);
  const [sortMode, setSortMode] = useState<AuthFilesSortMode>('default');
  const [batchActionBarVisible, setBatchActionBarVisible] = useState(false);
  const [uiStateHydrated, setUiStateHydrated] = useState(false);
  const floatingBatchActionsRef = useRef<HTMLDivElement>(null);
  const batchActionAnimationRef = useRef<AnimationPlaybackControlsWithThen | null>(null);
  const previousSelectionCountRef = useRef(0);
  const selectionCountRef = useRef(0);

  const {
    files,
    selectedFiles,
    selectionCount,
    loading,
    error,
    uploading,
    deleting,
    deletingAll,
    statusUpdating,
    batchStatusUpdating,
    fileInputRef,
    loadFiles,
    handleUploadClick,
    handleFileChange,
    handleDelete,
    handleDeleteAll,
    handleDownload,
    handleStatusToggle,
    toggleSelect,
    selectAllVisible,
    invertVisibleSelection,
    deselectAll,
    batchDownload,
    batchSetStatus,
    batchDelete,
  } = useAuthFilesData();

  const statusBarCache = useAuthFilesStatusBarCache(files);

  const {
    modelsModalOpen,
    modelsLoading,
    modelsConfig,
    modelsFileName,
    modelsError,
    showModels,
    closeModelsModal,
    invalidateModelsCache,
  } = useAuthFilesModels();

  const {
    modelAlias,
    modelAliasError,
    allProviderModels,
    providerAliasSeeds,
    reloadProviderConfigs,
    deleteModelAlias,
    handleMappingUpdate,
    handleDeleteLink,
    handleToggleFork,
    handleRenameAlias,
    handleDeleteAlias,
  } = useAuthFilesOauth({
    diagramOpen: aliasOverviewOpen,
    files,
    onAliasConfigChanged: invalidateModelsCache,
  });

  const {
    prefixProxyEditor,
    prefixProxyUpdatedText,
    prefixProxyDirty,
    openPrefixProxyEditor,
    closePrefixProxyEditor,
    handlePrefixProxyChange,
    handlePrefixProxySave,
  } = useAuthFilesPrefixProxyEditor({
    disableControls: connectionStatus !== 'connected',
    loadFiles,
  });

  const disableControls = connectionStatus !== 'connected';
  const normalizedFilter = normalizeProviderKey(String(filter));
  const quotaFilterType: QuotaProviderType | null = QUOTA_PROVIDER_TYPES.has(
    normalizedFilter as QuotaProviderType
  )
    ? (normalizedFilter as QuotaProviderType)
    : null;
  const pageSize = compactMode ? pageSizeByMode.compact : pageSizeByMode.regular;

  useEffect(() => {
    const persistedCompactMode = readPersistedAuthFilesCompactMode();
    if (typeof persistedCompactMode === 'boolean') {
      setCompactMode(persistedCompactMode);
    }

    const persisted = readAuthFilesUiState();
    if (persisted) {
      if (typeof persisted.filter === 'string' && persisted.filter.trim()) {
        setFilter(persisted.filter);
      }
      setStatusFilter(resolveAuthFilesStatusFilter(persisted));
      if (
        typeof persistedCompactMode !== 'boolean' &&
        typeof persisted.compactMode === 'boolean'
      ) {
        setCompactMode(persisted.compactMode);
      }
      if (typeof persisted.search === 'string') {
        setSearch(persisted.search);
      }
      if (typeof persisted.page === 'number' && Number.isFinite(persisted.page)) {
        setPage(Math.max(1, Math.round(persisted.page)));
      }
      const legacyPageSize =
        typeof persisted.pageSize === 'number' && Number.isFinite(persisted.pageSize)
          ? clampCardPageSize(persisted.pageSize)
          : null;
      const regularPageSize =
        typeof persisted.regularPageSize === 'number' && Number.isFinite(persisted.regularPageSize)
          ? clampCardPageSize(persisted.regularPageSize)
          : legacyPageSize ?? DEFAULT_REGULAR_PAGE_SIZE;
      const compactPageSize =
        typeof persisted.compactPageSize === 'number' && Number.isFinite(persisted.compactPageSize)
          ? clampCardPageSize(persisted.compactPageSize)
          : legacyPageSize ?? DEFAULT_COMPACT_PAGE_SIZE;
      setPageSizeByMode({
        regular: regularPageSize,
        compact: compactPageSize,
      });
      if (isAuthFilesSortMode(persisted.sortMode)) {
        setSortMode(persisted.sortMode);
      }
    }

    setUiStateHydrated(true);
  }, []);

  useEffect(() => {
    if (!uiStateHydrated) return;

    writeAuthFilesUiState({
      filter,
      statusFilter,
      compactMode,
      search,
      page,
      pageSize,
      regularPageSize: pageSizeByMode.regular,
      compactPageSize: pageSizeByMode.compact,
      sortMode,
    });
    writePersistedAuthFilesCompactMode(compactMode);
  }, [
    compactMode,
    filter,
    page,
    pageSize,
    pageSizeByMode,
    search,
    sortMode,
    statusFilter,
    uiStateHydrated,
  ]);

  useEffect(() => {
    setPageSizeInput(String(pageSize));
  }, [pageSize]);

  const setCurrentModePageSize = useCallback(
    (next: number) => {
      setPageSizeByMode((current) =>
        compactMode ? { ...current, compact: next } : { ...current, regular: next }
      );
    },
    [compactMode]
  );

  const commitPageSizeInput = (rawValue: string) => {
    const trimmed = rawValue.trim();
    if (!trimmed) {
      setPageSizeInput(String(pageSize));
      return;
    }

    const value = Number(trimmed);
    if (!Number.isFinite(value)) {
      setPageSizeInput(String(pageSize));
      return;
    }

    const next = clampCardPageSize(value);
    setCurrentModePageSize(next);
    setPageSizeInput(String(next));
    setPage(1);
  };

  const handlePageSizeChange = (event: ChangeEvent<HTMLInputElement>) => {
    const rawValue = event.currentTarget.value;
    setPageSizeInput(rawValue);

    const trimmed = rawValue.trim();
    if (!trimmed) return;

    const parsed = Number(trimmed);
    if (!Number.isFinite(parsed)) return;

    const rounded = Math.round(parsed);
    if (rounded < MIN_CARD_PAGE_SIZE || rounded > MAX_CARD_PAGE_SIZE) return;

    setCurrentModePageSize(rounded);
    setPage(1);
  };

  const handleSortModeChange = useCallback(
    (value: AuthFilesSortMode) => {
      if (value === sortMode) return;
      setSortMode(value);
      setPage(1);
      void loadFiles().catch(() => {});
    },
    [loadFiles, sortMode]
  );

  const handleHeaderRefresh = useCallback(async () => {
    await loadFiles();
  }, [loadFiles]);

  const handleModelsConfigSaved = useCallback(async () => {
    invalidateModelsCache();
    if (aliasOverviewOpen) {
      await reloadProviderConfigs().catch(() => {});
    }
  }, [aliasOverviewOpen, invalidateModelsCache, reloadProviderConfigs]);

  useHeaderRefresh(handleHeaderRefresh);

  useEffect(() => {
    if (!isCurrentLayer) return;
    loadFiles();
  }, [isCurrentLayer, loadFiles]);

  useInterval(
    () => {
      void loadFiles().catch(() => {});
    },
    isCurrentLayer ? 240_000 : null
  );

  const existingTypes = useMemo(() => {
    const types = new Set<string>(['all']);
    files.forEach((file) => {
      if (file.type) {
        types.add(file.type);
      }
    });
    return Array.from(types);
  }, [files]);

  const problemOnly = statusFilter === 'problem';
  const disabledOnly = statusFilter === 'disabled';

  const filesMatchingStatusFilters = useMemo(
    () =>
      files.filter((file) => {
        if (statusFilter === 'problem' && !hasAuthFileStatusMessage(file)) return false;
        if (statusFilter === 'disabled' && file.disabled !== true) return false;
        return true;
      }),
    [files, statusFilter]
  );

  const normalizedSearch = search.trim();
  const wildcardSearch = useMemo(() => buildWildcardSearch(normalizedSearch), [normalizedSearch]);

  const filtered = useMemo(() => {
    const normalizedTerm = normalizedSearch.toLowerCase();

    return filesMatchingStatusFilters.filter((item) => {
      const matchType = filter === 'all' || item.type === filter;
      const matchSearch =
        !normalizedSearch ||
        [item.name, item.type, item.provider].some((value) => {
          const content = (value || '').toString();
          return wildcardSearch
            ? wildcardSearch.test(content)
            : content.toLowerCase().includes(normalizedTerm);
        });
      return matchType && matchSearch;
    });
  }, [filesMatchingStatusFilters, filter, normalizedSearch, wildcardSearch]);

  const sorted = useMemo(() => {
    const copy = [...filtered];
    if (sortMode === 'default') {
      copy.sort((a, b) => {
        const providerA = normalizeProviderKey(String(a.provider ?? a.type ?? 'unknown'));
        const providerB = normalizeProviderKey(String(b.provider ?? b.type ?? 'unknown'));
        const providerCompare = providerA.localeCompare(providerB);
        if (providerCompare !== 0) return providerCompare;
        return a.name.localeCompare(b.name);
      });
    } else if (sortMode === 'az') {
      copy.sort((a, b) => a.name.localeCompare(b.name));
    } else if (sortMode === 'priority') {
      copy.sort((a, b) => {
        const pa = parsePriorityValue(a.priority ?? a['priority']) ?? 0;
        const pb = parsePriorityValue(b.priority ?? b['priority']) ?? 0;
        return pb - pa; // 高优先级排前面
      });
    }
    return copy;
  }, [filtered, sortMode]);

  const totalPages = Math.max(1, Math.ceil(sorted.length / pageSize));
  const currentPage = Math.min(page, totalPages);
  const start = (currentPage - 1) * pageSize;
  const pageItems = sorted.slice(start, start + pageSize);
  const selectablePageItems = useMemo(
    () => pageItems.filter((file) => !isRuntimeOnlyAuthFile(file)),
    [pageItems]
  );
  const selectableFilteredItems = useMemo(
    () => sorted.filter((file) => !isRuntimeOnlyAuthFile(file)),
    [sorted]
  );
  const selectedNames = useMemo(() => Array.from(selectedFiles), [selectedFiles]);
  const selectedHasStatusUpdating = useMemo(
    () => selectedNames.some((name) => statusUpdating[name] === true),
    [selectedNames, statusUpdating]
  );
  const batchStatusButtonsDisabled =
    disableControls ||
    selectedNames.length === 0 ||
    batchStatusUpdating ||
    selectedHasStatusUpdating;

  const copyTextWithNotification = useCallback(
    async (text: string) => {
      const copied = await copyToClipboard(text);
      showNotification(
        copied
          ? t('notification.link_copied', { defaultValue: 'Copied to clipboard' })
          : t('notification.copy_failed', { defaultValue: 'Copy failed' }),
        copied ? 'success' : 'error'
      );
    },
    [showNotification, t]
  );

  useLayoutEffect(() => {
    if (typeof window === 'undefined') return;

    const actionsEl = floatingBatchActionsRef.current;
    if (!actionsEl) {
      document.documentElement.style.removeProperty('--auth-files-action-bar-height');
      return;
    }

    const updatePadding = () => {
      const height = actionsEl.getBoundingClientRect().height;
      document.documentElement.style.setProperty('--auth-files-action-bar-height', `${height}px`);
    };

    updatePadding();
    window.addEventListener('resize', updatePadding);

    const ro = typeof ResizeObserver === 'undefined' ? null : new ResizeObserver(updatePadding);
    ro?.observe(actionsEl);

    return () => {
      ro?.disconnect();
      window.removeEventListener('resize', updatePadding);
      document.documentElement.style.removeProperty('--auth-files-action-bar-height');
    };
  }, [batchActionBarVisible, selectionCount]);

  useEffect(() => {
    selectionCountRef.current = selectionCount;
    if (selectionCount > 0) {
      setBatchActionBarVisible(true);
    }
  }, [selectionCount]);

  useLayoutEffect(() => {
    if (!batchActionBarVisible) return;
    const currentCount = selectionCount;
    const previousCount = previousSelectionCountRef.current;
    const actionsEl = floatingBatchActionsRef.current;
    if (!actionsEl) return;

    batchActionAnimationRef.current?.stop();
    batchActionAnimationRef.current = null;

    if (currentCount > 0 && previousCount === 0) {
      batchActionAnimationRef.current = animate(
        actionsEl,
        {
          transform: [BATCH_BAR_HIDDEN_TRANSFORM, BATCH_BAR_BASE_TRANSFORM],
          opacity: [0, 1],
        },
        {
          duration: 0.28,
          ease: easePower3Out,
          onComplete: () => {
            actionsEl.style.transform = BATCH_BAR_BASE_TRANSFORM;
            actionsEl.style.opacity = '1';
          },
        }
      );
    } else if (currentCount === 0 && previousCount > 0) {
      batchActionAnimationRef.current = animate(
        actionsEl,
        {
          transform: [BATCH_BAR_BASE_TRANSFORM, BATCH_BAR_HIDDEN_TRANSFORM],
          opacity: [1, 0],
        },
        {
          duration: 0.22,
          ease: easePower2In,
          onComplete: () => {
            if (selectionCountRef.current === 0) {
              setBatchActionBarVisible(false);
            }
          },
        }
      );
    }

    previousSelectionCountRef.current = currentCount;
  }, [batchActionBarVisible, selectionCount]);

  useEffect(
    () => () => {
      batchActionAnimationRef.current?.stop();
      batchActionAnimationRef.current = null;
    },
    []
  );

  const renderProviderSegments = () => (
    <div
      className={styles.providerSegmentBar}
      role="tablist"
      aria-label={t('auth_files.provider_filter_label')}
    >
      {existingTypes.map((type) => {
        const isActive = filter === type;
        return (
          <button
            key={type}
            type="button"
            role="tab"
            aria-selected={isActive}
            className={`${styles.providerSegmentItem} ${isActive ? styles.tabActive : ''}`}
            onClick={() => {
              setFilter(type);
              setPage(1);
            }}
          >
            {getTypeLabel(t, type)}
          </button>
        );
      })}
    </div>
  );

  const deleteAllButtonLabel = (() => {
    if (disabledOnly) {
      return t('auth_files.delete_filtered_result_button');
    }
    if (problemOnly) {
      return filter === 'all'
        ? t('auth_files.delete_problem_button')
        : t('auth_files.delete_problem_button_with_type', { type: getTypeLabel(t, filter) });
    }
    return filter === 'all'
      ? t('auth_files.delete_all_button')
      : `${t('common.delete')} ${getTypeLabel(t, filter)}`;
  })();

  return (
    <div className={styles.container}>
      <div className={styles.pageTitleRow}>
        <div className={styles.titleMain}>
          <h1 className={styles.pageTitle}>{t('auth_files.title')}</h1>
          {files.length > 0 && <span className={styles.countBadge}>{files.length}</span>}
        </div>
        <div className={styles.headerActions}>
          <Button variant="secondary" size="sm" onClick={handleHeaderRefresh} loading={loading}>
            {t('common.refresh')}
          </Button>
          <Button
            variant="secondary"
            size="sm"
            onClick={() => setAliasOverviewOpen(true)}
            disabled={disableControls || modelAliasError === 'unsupported'}
          >
            {t('auth_files.alias_overview_button')}
          </Button>
          <Button
            size="sm"
            onClick={handleUploadClick}
            disabled={disableControls || uploading}
            loading={uploading}
          >
            {t('auth_files.upload_button')}
          </Button>
          <Button
            variant="danger"
            size="sm"
            onClick={() =>
              handleDeleteAll({
                filter,
                problemOnly,
                disabledOnly,
                onResetFilterToAll: () => setFilter('all'),
                onResetProblemOnly: () => setStatusFilter('all'),
                onResetDisabledOnly: () => setStatusFilter('all'),
              })
            }
            disabled={disableControls || loading || deletingAll}
            loading={deletingAll}
          >
            {deleteAllButtonLabel}
          </Button>
          <input
            ref={fileInputRef}
            type="file"
            accept=".json,application/json"
            multiple
            style={{ display: 'none' }}
            onChange={handleFileChange}
          />
        </div>
      </div>
      <p className={styles.description}>{t('auth_files.description')}</p>

      {renderProviderSegments()}

      <div className={styles.globalToolbar}>
        <div className={styles.globalToolbarFilters}>
          <label className={styles.globalToolbarField}>
            <span className={styles.globalToolbarFieldLabel}>{t('auth_files.search_short')}</span>
            <Input
              className={styles.globalToolbarSearch}
              value={search}
              onChange={(e) => {
                setSearch(e.target.value);
                setPage(1);
              }}
              placeholder={t('auth_files.search_placeholder')}
              aria-label={t('auth_files.search_label')}
            />
          </label>
          <label className={styles.globalToolbarField}>
            <span className={styles.globalToolbarFieldLabel}>{t('auth_files.page_size_short')}</span>
            <input
              className={styles.globalToolbarPageSize}
              type="number"
              min={MIN_CARD_PAGE_SIZE}
              max={MAX_CARD_PAGE_SIZE}
              step={1}
              value={pageSizeInput}
              onChange={handlePageSizeChange}
              onBlur={(e) => commitPageSizeInput(e.currentTarget.value)}
              onKeyDown={(e) => {
                if (e.key === 'Enter') {
                  e.currentTarget.blur();
                }
              }}
              aria-label={t('auth_files.page_size_label')}
            />
          </label>
          <div className={styles.globalToolbarField}>
            <span className={styles.globalToolbarFieldLabel}>{t('auth_files.sort_label')}</span>
            <div
              className={styles.densitySwitch}
              role="tablist"
              aria-label={t('auth_files.sort_label')}
            >
              {AUTH_FILES_SORT_MODES.map((value) => (
                <button
                  key={value}
                  type="button"
                  role="tab"
                  aria-selected={sortMode === value}
                  className={`${styles.densitySwitchItem} ${sortMode === value ? styles.densitySwitchItemActive : ''}`}
                  onClick={() => handleSortModeChange(value)}
                >
                  {t(`auth_files.sort_${value}`)}
                </button>
              ))}
            </div>
          </div>
        </div>

        <div className={styles.globalToolbarDivider} aria-hidden="true" />

        <div className={styles.globalToolbarDisplay}>
          <div
            className={styles.densitySwitch}
            role="tablist"
            aria-label={t('auth_files.status_filter_label')}
          >
            {(['all', 'problem', 'disabled'] as const).map((value) => (
              <button
                key={value}
                type="button"
                role="tab"
                aria-selected={statusFilter === value}
                className={`${styles.densitySwitchItem} ${statusFilter === value ? styles.densitySwitchItemActive : ''}`}
                onClick={() => {
                  setStatusFilter(value);
                  setPage(1);
                }}
              >
                {t(`auth_files.status_filter_${value}`)}
              </button>
            ))}
          </div>
          <div
            className={styles.densitySwitch}
            role="tablist"
            aria-label={t('auth_files.view_density_label')}
          >
              <button
                type="button"
                role="tab"
                aria-selected={compactMode}
                className={`${styles.densitySwitchItem} ${compactMode ? styles.densitySwitchItemActive : ''}`}
                onClick={() => setCompactMode(true)}
              >
                {t('auth_files.view_compact')}
              </button>
              <button
                type="button"
                role="tab"
                aria-selected={!compactMode}
                className={`${styles.densitySwitchItem} ${!compactMode ? styles.densitySwitchItemActive : ''}`}
                onClick={() => setCompactMode(false)}
              >
                {t('auth_files.view_detailed')}
              </button>
            </div>
        </div>
      </div>

      {error && <div className={styles.errorBox}>{error}</div>}

      {loading ? (
        <div className={styles.hint}>{t('common.loading')}</div>
      ) : pageItems.length === 0 ? (
        <EmptyState
          title={t('auth_files.search_empty_title')}
          description={t('auth_files.search_empty_desc')}
        />
      ) : (
        <div
          className={`${styles.fileGrid} ${quotaFilterType ? styles.fileGridQuotaManaged : ''} ${compactMode ? styles.fileGridCompact : ''}`}
        >
          {pageItems.map((file) => (
            <AuthFileCard
              key={file.name}
              file={file}
              compact={compactMode}
              selected={selectedFiles.has(file.name)}
              resolvedTheme={resolvedTheme}
              disableControls={disableControls}
              deleting={deleting}
              statusUpdating={statusUpdating}
              quotaFilterType={quotaFilterType}
              statusBarCache={statusBarCache}
              onShowModels={showModels}
              onDownload={handleDownload}
              onOpenPrefixProxyEditor={openPrefixProxyEditor}
              onDelete={handleDelete}
              onToggleStatus={handleStatusToggle}
              onToggleSelect={toggleSelect}
            />
          ))}
        </div>
      )}

      {!loading && sorted.length > pageSize && (
        <div className={styles.pagination}>
          <Button
            variant="secondary"
            size="sm"
            onClick={() => setPage(Math.max(1, currentPage - 1))}
            disabled={currentPage <= 1}
          >
            {t('auth_files.pagination_prev')}
          </Button>
          <div className={styles.pageInfo}>
            {t('auth_files.pagination_info', {
              current: currentPage,
              total: totalPages,
              count: sorted.length,
            })}
          </div>
          <Button
            variant="secondary"
            size="sm"
            onClick={() => setPage(Math.min(totalPages, currentPage + 1))}
            disabled={currentPage >= totalPages}
          >
            {t('auth_files.pagination_next')}
          </Button>
        </div>
      )}

      <OAuthAliasOverviewModal
        open={aliasOverviewOpen}
        providerFilter={filter}
        disableControls={disableControls}
        modelAliasError={modelAliasError}
        modelAlias={modelAlias}
        allProviderModels={allProviderModels}
        providerAliasSeeds={providerAliasSeeds}
        onClose={() => setAliasOverviewOpen(false)}
        onUpdate={handleMappingUpdate}
        onDeleteLink={handleDeleteLink}
        onToggleFork={handleToggleFork}
        onRenameAlias={handleRenameAlias}
        onDeleteAlias={handleDeleteAlias}
        onDeleteProvider={deleteModelAlias}
      />

      <AuthFileModelsModal
        open={modelsModalOpen}
        fileName={modelsFileName}
        loading={modelsLoading}
        error={modelsError}
        config={modelsConfig}
        disableControls={disableControls}
        onClose={closeModelsModal}
        onCopyText={copyTextWithNotification}
        onModelsConfigSaved={handleModelsConfigSaved}
      />

      <AuthFilesPrefixProxyEditorModal
        disableControls={disableControls}
        editor={prefixProxyEditor}
        updatedText={prefixProxyUpdatedText}
        dirty={prefixProxyDirty}
        onClose={closePrefixProxyEditor}
        onCopyText={copyTextWithNotification}
        onSave={handlePrefixProxySave}
        onChange={handlePrefixProxyChange}
      />

      {batchActionBarVisible && typeof document !== 'undefined'
        ? createPortal(
            <div className={styles.batchActionContainer} ref={floatingBatchActionsRef}>
              <div className={styles.batchActionBar}>
                <div className={styles.batchActionLeft}>
                  <span className={styles.batchSelectionText}>
                    {t('auth_files.batch_selected', { count: selectionCount })}
                  </span>
                  <Button
                    variant="secondary"
                    size="sm"
                    onClick={() => selectAllVisible(pageItems)}
                    disabled={selectablePageItems.length === 0}
                  >
                    {t('auth_files.batch_select_page')}
                  </Button>
                  <Button
                    variant="secondary"
                    size="sm"
                    onClick={() => selectAllVisible(sorted)}
                    disabled={selectableFilteredItems.length === 0}
                  >
                    {t('auth_files.batch_select_filtered')}
                  </Button>
                  <Button
                    variant="ghost"
                    size="sm"
                    onClick={() => invertVisibleSelection(pageItems)}
                    disabled={selectablePageItems.length === 0}
                  >
                    {t('auth_files.batch_invert_page')}
                  </Button>
                  <Button variant="ghost" size="sm" onClick={deselectAll}>
                    {t('auth_files.batch_deselect')}
                  </Button>
                </div>
                <div className={styles.batchActionRight}>
                  <Button
                    variant="secondary"
                    size="sm"
                    onClick={() => void batchDownload(selectedNames)}
                    disabled={disableControls || selectedNames.length === 0}
                  >
                    {t('auth_files.batch_download')}
                  </Button>
                  <Button
                    size="sm"
                    onClick={() => batchSetStatus(selectedNames, true)}
                    disabled={batchStatusButtonsDisabled}
                  >
                    {t('auth_files.batch_enable')}
                  </Button>
                  <Button
                    variant="secondary"
                    size="sm"
                    onClick={() => batchSetStatus(selectedNames, false)}
                    disabled={batchStatusButtonsDisabled}
                  >
                    {t('auth_files.batch_disable')}
                  </Button>
                  <Button
                    variant="danger"
                    size="sm"
                    onClick={() => batchDelete(selectedNames)}
                    disabled={disableControls || selectedNames.length === 0}
                  >
                    {t('common.delete')}
                  </Button>
                </div>
              </div>
            </div>,
            document.body
          )
        : null}
    </div>
  );
}
