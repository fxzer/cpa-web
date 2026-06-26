import {
  useCallback,
  useEffect,
  useId,
  useLayoutEffect,
  useMemo,
  useRef,
  useState,
  type ReactNode,
} from 'react';
import { createPortal } from 'react-dom';
import { useTranslation } from 'react-i18next';
import { usePageTransitionLayer } from '@/components/common/PageTransitionLayer';
import { Input } from '@/components/ui/Input';
import { ToggleSwitch } from '@/components/ui/ToggleSwitch';
import { ConfigSection } from '@/components/config/ConfigSection';
import { useMediaQuery } from '@/hooks/useMediaQuery';
import { PANEL_WEBUI_GITHUB_URL } from '@/utils/constants';
import type {
  PayloadFilterRule,
  PayloadParamValidationErrorCode,
  PayloadRule,
  VisualConfigFieldPath,
  VisualConfigValidationErrorCode,
  VisualConfigValidationErrors,
  VisualConfigValues,
} from '@/types/visualConfig';
import {
  ApiKeysCardEditor,
  PayloadFilterRulesEditor,
  PayloadRulesEditor,
} from './VisualConfigEditorBlocks';
import styles from './VisualConfigEditor.module.scss';

type VisualSectionId =
  | 'server'
  | 'tls'
  | 'remote'
  | 'auth'
  | 'system'
  | 'network'
  | 'quota'
  | 'streaming'
  | 'payload';

type VisualSection = {
  id: VisualSectionId;
  title: string;
  description: string;
  errorCount: number;
};

interface VisualConfigEditorProps {
  values: VisualConfigValues;
  validationErrors?: VisualConfigValidationErrors;
  hasPayloadValidationErrors?: boolean;
  disabled?: boolean;
  onChange: (values: Partial<VisualConfigValues>) => void;
}

function getValidationMessage(
  t: ReturnType<typeof useTranslation>['t'],
  errorCode?: VisualConfigValidationErrorCode | PayloadParamValidationErrorCode
) {
  if (!errorCode) return undefined;
  return t(`config_management.visual.validation.${errorCode}`);
}

type ToggleRowProps = {
  title: string;
  description?: string;
  checked: boolean;
  disabled?: boolean;
  onChange: (value: boolean) => void;
};

function ToggleRow({ title, description, checked, disabled, onChange }: ToggleRowProps) {
  return (
    <div className={styles.toggleRow}>
      <div className={styles.toggleCopy}>
        <div className={styles.toggleTitle}>{title}</div>
        {description ? <div className={styles.toggleDescription}>{description}</div> : null}
      </div>
      <ToggleSwitch checked={checked} onChange={onChange} disabled={disabled} ariaLabel={title} />
    </div>
  );
}

function SectionGrid({ children }: { children: ReactNode }) {
  return <div className={styles.sectionGrid}>{children}</div>;
}

function SectionStack({ children }: { children: ReactNode }) {
  return <div className={styles.sectionStack}>{children}</div>;
}

function Divider() {
  return <div className={styles.divider} />;
}

function SectionSubsection({
  title,
  description,
  children,
}: {
  title: string;
  description?: string;
  children: ReactNode;
}) {
  return (
    <div className={styles.subsection}>
      <div className={styles.subsectionHeader}>
        <h3 className={styles.subsectionTitle}>{title}</h3>
        {description ? <p className={styles.subsectionDescription}>{description}</p> : null}
      </div>
      {children}
    </div>
  );
}

function FieldShell({
  label,
  labelId,
  htmlFor,
  hint,
  hintId,
  error,
  errorId,
  children,
}: {
  label: string;
  labelId?: string;
  htmlFor?: string;
  hint?: string;
  hintId?: string;
  error?: string;
  errorId?: string;
  children: ReactNode;
}) {
  return (
    <div className={styles.fieldShell}>
      <label id={labelId} htmlFor={htmlFor} className={styles.fieldLabel}>
        {label}
      </label>
      {children}
      {error ? (
        <div id={errorId} className="error-box">
          {error}
        </div>
      ) : null}
      {hint ? (
        <div id={hintId} className={styles.fieldHint}>
          {hint}
        </div>
      ) : null}
    </div>
  );
}

export function VisualConfigEditor({
  values,
  validationErrors,
  hasPayloadValidationErrors = false,
  disabled = false,
  onChange,
}: VisualConfigEditorProps) {
  const { t } = useTranslation();
  const pageTransitionLayer = usePageTransitionLayer();
  const isCurrentLayer = pageTransitionLayer ? pageTransitionLayer.isCurrentLayer : true;
  const isMobile = useMediaQuery('(max-width: 768px)');
  const isWideDesktopNav = useMediaQuery('(min-width: 1025px)');
  const shouldRenderFloatingSidebar = !isMobile && isWideDesktopNav && isCurrentLayer;
  const keepaliveInputId = useId();
  const keepaliveHintId = `${keepaliveInputId}-hint`;
  const keepaliveErrorId = `${keepaliveInputId}-error`;
  const nonstreamKeepaliveInputId = useId();
  const nonstreamKeepaliveHintId = `${nonstreamKeepaliveInputId}-hint`;
  const nonstreamKeepaliveErrorId = `${nonstreamKeepaliveInputId}-error`;
  const [activeSectionId, setActiveSectionId] = useState<VisualSectionId>('server');
  const workspaceRef = useRef<HTMLDivElement | null>(null);
  const sidebarAnchorRef = useRef<HTMLElement | null>(null);
  const floatingSidebarRef = useRef<HTMLDivElement | null>(null);
  const sectionRefs = useRef<Partial<Record<VisualSectionId, HTMLElement | null>>>({});
  const mobileNavScrollerRef = useRef<HTMLDivElement | null>(null);
  const mobileNavButtonRefs = useRef<Partial<Record<VisualSectionId, HTMLButtonElement | null>>>(
    {}
  );

  const isKeepaliveDisabled =
    values.streaming.keepaliveSeconds === '' || values.streaming.keepaliveSeconds === '0';
  const isNonstreamKeepaliveDisabled =
    values.streaming.nonstreamKeepaliveInterval === '' ||
    values.streaming.nonstreamKeepaliveInterval === '0';

  const portError = getValidationMessage(t, validationErrors?.port);
  const logsMaxSizeError = getValidationMessage(t, validationErrors?.logsMaxTotalSizeMb);
  const requestRetryError = getValidationMessage(t, validationErrors?.requestRetry);
  const maxRetryCredentialsError = getValidationMessage(t, validationErrors?.maxRetryCredentials);
  const maxRetryIntervalError = getValidationMessage(t, validationErrors?.maxRetryInterval);
  const keepaliveError = getValidationMessage(t, validationErrors?.['streaming.keepaliveSeconds']);
  const bootstrapRetriesError = getValidationMessage(
    t,
    validationErrors?.['streaming.bootstrapRetries']
  );
  const nonstreamKeepaliveError = getValidationMessage(
    t,
    validationErrors?.['streaming.nonstreamKeepaliveInterval']
  );

  const handleApiKeysTextChange = useCallback(
    (apiKeysText: string) => onChange({ apiKeysText }),
    [onChange]
  );
  const handlePayloadDefaultRulesChange = useCallback(
    (payloadDefaultRules: PayloadRule[]) => onChange({ payloadDefaultRules }),
    [onChange]
  );
  const handlePayloadDefaultRawRulesChange = useCallback(
    (payloadDefaultRawRules: PayloadRule[]) => onChange({ payloadDefaultRawRules }),
    [onChange]
  );
  const handlePayloadOverrideRulesChange = useCallback(
    (payloadOverrideRules: PayloadRule[]) => onChange({ payloadOverrideRules }),
    [onChange]
  );
  const handlePayloadOverrideRawRulesChange = useCallback(
    (payloadOverrideRawRules: PayloadRule[]) => onChange({ payloadOverrideRawRules }),
    [onChange]
  );
  const handlePayloadFilterRulesChange = useCallback(
    (payloadFilterRules: PayloadFilterRule[]) => onChange({ payloadFilterRules }),
    [onChange]
  );

  const countErrors = useCallback(
    (fields: VisualConfigFieldPath[]) =>
      fields.reduce((total, field) => total + (validationErrors?.[field] ? 1 : 0), 0),
    [validationErrors]
  );

  const sections = useMemo<VisualSection[]>(
    () => [
      {
        id: 'server',
        title: t('config_management.visual.sections.server.title'),
        description: t('config_management.visual.sections.server.description'),
        errorCount: countErrors(['port']),
      },
      {
        id: 'tls',
        title: t('config_management.visual.sections.tls.title'),
        description: t('config_management.visual.sections.tls.description'),
        errorCount: 0,
      },
      {
        id: 'remote',
        title: t('config_management.visual.sections.remote.title'),
        description: t('config_management.visual.sections.remote.description'),
        errorCount: 0,
      },
      {
        id: 'auth',
        title: t('config_management.visual.sections.auth.title'),
        description: t('config_management.visual.sections.auth.description'),
        errorCount: 0,
      },
      {
        id: 'system',
        title: t('config_management.visual.sections.system.title'),
        description: t('config_management.visual.sections.system.description'),
        errorCount: countErrors(['logsMaxTotalSizeMb']),
      },
      {
        id: 'network',
        title: t('config_management.visual.sections.network.title'),
        description: t('config_management.visual.sections.network.description'),
        errorCount: countErrors(['requestRetry', 'maxRetryCredentials', 'maxRetryInterval']),
      },
      {
        id: 'quota',
        title: t('config_management.visual.sections.quota.title'),
        description: t('config_management.visual.sections.quota.description'),
        errorCount: 0,
      },
      {
        id: 'streaming',
        title: t('config_management.visual.sections.streaming.title'),
        description: t('config_management.visual.sections.streaming.description'),
        errorCount: countErrors([
          'streaming.keepaliveSeconds',
          'streaming.bootstrapRetries',
          'streaming.nonstreamKeepaliveInterval',
        ]),
      },
      {
        id: 'payload',
        title: t('config_management.visual.sections.payload.title'),
        description: t('config_management.visual.sections.payload.description'),
        errorCount: hasPayloadValidationErrors ? 1 : 0,
      },
    ],
    [countErrors, hasPayloadValidationErrors, t]
  );

  const hasValidationIssues =
    sections.some((section) => section.errorCount > 0) || hasPayloadValidationErrors;

  useEffect(() => {
    if (!isCurrentLayer || !isMobile) return;
    const scroller = mobileNavScrollerRef.current;
    const button = mobileNavButtonRefs.current[activeSectionId];
    if (!scroller || !button) return;

    const scrollerRect = scroller.getBoundingClientRect();
    const buttonRect = button.getBoundingClientRect();
    const centeredLeft =
      scroller.scrollLeft +
      (buttonRect.left - scrollerRect.left) -
      (scroller.clientWidth - buttonRect.width) / 2;
    const maxScrollLeft = Math.max(scroller.scrollWidth - scroller.clientWidth, 0);
    const targetLeft = Math.min(Math.max(centeredLeft, 0), maxScrollLeft);

    scroller.scrollTo({
      left: targetLeft,
      behavior: 'smooth',
    });
  }, [activeSectionId, isCurrentLayer, isMobile]);

  const handleSectionJump = useCallback((sectionId: VisualSectionId) => {
    setActiveSectionId(sectionId);
    sectionRefs.current[sectionId]?.scrollIntoView({ behavior: 'smooth', block: 'start' });
  }, []);

  useLayoutEffect(() => {
    const floatingElement = floatingSidebarRef.current;
    const anchorElement = sidebarAnchorRef.current;
    const workspaceElement = workspaceRef.current;
    if (!floatingElement) return undefined;

    const clearFloatingStyles = () => {
      floatingElement.style.removeProperty('transform');
      floatingElement.style.removeProperty('width');
      floatingElement.style.removeProperty('max-height');
      floatingElement.style.removeProperty('opacity');
      floatingElement.style.removeProperty('pointer-events');
    };

    if (!shouldRenderFloatingSidebar || !anchorElement || !workspaceElement) {
      clearFloatingStyles();
      return undefined;
    }

    const computeViewportPadding = () => {
      const raw = getComputedStyle(document.documentElement).getPropertyValue('--shell-gutter');
      const parsed = Number.parseFloat(raw);
      return Math.max(Number.isFinite(parsed) ? parsed : 24, 16);
    };
    const computeStickyMinTop = () => {
      const raw = getComputedStyle(document.documentElement).getPropertyValue('--header-height');
      const parsed = Number.parseFloat(raw);
      const headerHeight = Number.isFinite(parsed) ? parsed : 64;
      return headerHeight + 12;
    };
    let viewportPadding = computeViewportPadding();

    const contentScroller = document.querySelector('.content') as HTMLElement | null;

    let cachedFloatingHeight = floatingElement.getBoundingClientRect().height || 200;

    let frameId = 0;

    const updateFloatingPosition = () => {
      frameId = 0;

      const anchorRect = anchorElement.getBoundingClientRect();
      const workspaceRect = workspaceElement.getBoundingClientRect();
      const viewportHeight = window.innerHeight;
      const availableHeight = Math.max(viewportHeight - viewportPadding * 2, 160);
      floatingElement.style.maxHeight = `${availableHeight}px`;
      cachedFloatingHeight =
        floatingElement.getBoundingClientRect().height ||
        Math.min(cachedFloatingHeight, availableHeight);
      const stickyMinTop = computeStickyMinTop();
      const maxTop = workspaceRect.bottom - cachedFloatingHeight;
      const top = Math.min(Math.max(anchorRect.top, stickyMinTop), maxTop);
      const left = Math.max(anchorRect.left, viewportPadding);
      const width = Math.max(
        Math.min(anchorRect.width, window.innerWidth - left - viewportPadding),
        220
      );
      const maxHeight = Math.max(viewportHeight - top - viewportPadding, 160);
      const isVisible =
        workspaceRect.bottom > stickyMinTop + viewportPadding && workspaceRect.top < viewportHeight;

      floatingElement.style.transform = `translate3d(${left}px, ${top}px, 0)`;
      floatingElement.style.width = `${width}px`;
      floatingElement.style.maxHeight = `${maxHeight}px`;
      floatingElement.style.opacity = isVisible ? '1' : '0';
      floatingElement.style.pointerEvents = isVisible ? 'auto' : 'none';
    };

    const requestPositionUpdate = () => {
      if (frameId) cancelAnimationFrame(frameId);
      frameId = requestAnimationFrame(updateFloatingPosition);
    };

    const handleResize = () => {
      viewportPadding = computeViewportPadding();
      cachedFloatingHeight = floatingElement.getBoundingClientRect().height || cachedFloatingHeight;
      requestPositionUpdate();
    };

    requestPositionUpdate();

    window.addEventListener('resize', handleResize);
    window.addEventListener('scroll', requestPositionUpdate, { passive: true });
    contentScroller?.addEventListener('scroll', requestPositionUpdate, { passive: true });

    const resizeObserver =
      typeof ResizeObserver === 'undefined' ? null : new ResizeObserver(requestPositionUpdate);
    resizeObserver?.observe(anchorElement);
    resizeObserver?.observe(workspaceElement);

    return () => {
      if (frameId) cancelAnimationFrame(frameId);
      resizeObserver?.disconnect();
      window.removeEventListener('resize', handleResize);
      window.removeEventListener('scroll', requestPositionUpdate);
      contentScroller?.removeEventListener('scroll', requestPositionUpdate);
      clearFloatingStyles();
    };
  }, [shouldRenderFloatingSidebar]);

  const navContent = (
    <div className={styles.navList}>
      {sections.map((section, index) => (
        <button
          key={section.id}
          type="button"
          className={`${styles.navButton} ${
            activeSectionId === section.id ? styles.navButtonActive : ''
          }`}
          onClick={() => handleSectionJump(section.id)}
        >
          <span className={styles.navIndex}>{index + 1}</span>
          <span className={styles.navMain}>
            <span className={styles.navHeadingRow}>
              <span className={styles.navLabel}>{section.title}</span>
              {section.errorCount > 0 ? (
                <span className={styles.navBadge} aria-hidden="true">
                  {section.errorCount}
                </span>
              ) : null}
            </span>
            <span className={styles.navDescription}>{section.description}</span>
          </span>
        </button>
      ))}
    </div>
  );

  return (
    <div ref={workspaceRef} className={styles.visualEditor}>
      {hasValidationIssues ? (
        <div className={styles.overview}>
          <div className={styles.overviewHeader}>
            <div className={styles.overviewMeta}>
              <span className={`${styles.overviewPill} ${styles.overviewPillWarning}`}>
                {t('config_management.visual.validation.validation_blocked')}
              </span>
            </div>
          </div>
        </div>
      ) : null}

      {isMobile ? (
        <div className={styles.mobileSectionNav}>
          <div ref={mobileNavScrollerRef} className={styles.mobileSectionNavScroller}>
            {sections.map((section, index) => (
              <button
                key={section.id}
                ref={(node) => {
                  mobileNavButtonRefs.current[section.id] = node;
                }}
                type="button"
                className={`${styles.mobileSectionNavButton} ${
                  activeSectionId === section.id ? styles.mobileSectionNavButtonActive : ''
                }`}
                onClick={() => handleSectionJump(section.id)}
              >
                <span className={styles.mobileSectionNavIndex}>{index + 1}</span>
                <span className={styles.mobileSectionNavLabel}>{section.title}</span>
                {section.errorCount > 0 ? (
                  <span className={styles.mobileSectionNavBadge} aria-hidden="true">
                    {section.errorCount}
                  </span>
                ) : null}
              </button>
            ))}
          </div>
        </div>
      ) : null}

      <aside ref={sidebarAnchorRef} className={styles.sidebar}>
        {isWideDesktopNav ? (
          <div className={styles.sidebarPlaceholder} aria-hidden="true" />
        ) : (
          <div className={styles.sidebarRail}>{navContent}</div>
        )}
      </aside>

      <div className={styles.sections}>
        <ConfigSection
          id="server"
          highlighted={activeSectionId === 'server'}
          ref={(node) => {
            sectionRefs.current.server = node;
          }}
          title={t('config_management.visual.sections.server.title')}
          description={t('config_management.visual.sections.server.description')}
        >
          <SectionGrid>
            <Input
              label={t('config_management.visual.sections.server.host')}
              placeholder="0.0.0.0"
              value={values.host}
              onChange={(e) => onChange({ host: e.target.value })}
              disabled={disabled}
            />
            <Input
              label={t('config_management.visual.sections.server.port')}
              type="number"
              placeholder="8317"
              value={values.port}
              onChange={(e) => onChange({ port: e.target.value })}
              disabled={disabled}
              error={portError}
            />
          </SectionGrid>
        </ConfigSection>

        <ConfigSection
          id="tls"
          highlighted={activeSectionId === 'tls'}
          ref={(node) => {
            sectionRefs.current.tls = node;
          }}
          title={t('config_management.visual.sections.tls.title')}
          description={t('config_management.visual.sections.tls.description')}
        >
          <SectionStack>
            <ToggleRow
              title={t('config_management.visual.sections.tls.enable')}
              description={t('config_management.visual.sections.tls.enable_desc')}
              checked={values.tlsEnable}
              disabled={disabled}
              onChange={(tlsEnable) => onChange({ tlsEnable })}
            />

            {values.tlsEnable ? (
              <>
                <Divider />
                <SectionGrid>
                  <Input
                    label={t('config_management.visual.sections.tls.cert')}
                    placeholder="/path/to/cert.pem"
                    value={values.tlsCert}
                    onChange={(e) => onChange({ tlsCert: e.target.value })}
                    disabled={disabled}
                  />
                  <Input
                    label={t('config_management.visual.sections.tls.key')}
                    placeholder="/path/to/key.pem"
                    value={values.tlsKey}
                    onChange={(e) => onChange({ tlsKey: e.target.value })}
                    disabled={disabled}
                  />
                </SectionGrid>
              </>
            ) : null}
          </SectionStack>
        </ConfigSection>

        <ConfigSection
          id="remote"
          highlighted={activeSectionId === 'remote'}
          ref={(node) => {
            sectionRefs.current.remote = node;
          }}
          title={t('config_management.visual.sections.remote.title')}
          description={t('config_management.visual.sections.remote.description')}
        >
          <SectionStack>
            <SectionGrid>
              <ToggleRow
                title={t('config_management.visual.sections.remote.allow_remote')}
                description={t('config_management.visual.sections.remote.allow_remote_desc')}
                checked={values.rmAllowRemote}
                disabled={disabled}
                onChange={(rmAllowRemote) => onChange({ rmAllowRemote })}
              />
              <ToggleRow
                title={t('config_management.visual.sections.remote.disable_panel')}
                description={t('config_management.visual.sections.remote.disable_panel_desc')}
                checked={values.rmDisableControlPanel}
                disabled={disabled}
                onChange={(rmDisableControlPanel) => onChange({ rmDisableControlPanel })}
              />
            </SectionGrid>
            <SectionGrid>
              <Input
                label={t('config_management.visual.sections.remote.secret_key')}
                type="password"
                placeholder={t('config_management.visual.sections.remote.secret_key_placeholder')}
                value={values.rmSecretKey}
                onChange={(e) => onChange({ rmSecretKey: e.target.value })}
                disabled={disabled}
              />
              <Input
                label={t('config_management.visual.sections.remote.panel_repo')}
                placeholder={PANEL_WEBUI_GITHUB_URL}
                value={values.rmPanelRepo}
                onChange={(e) => onChange({ rmPanelRepo: e.target.value })}
                disabled={disabled}
              />
            </SectionGrid>
          </SectionStack>
        </ConfigSection>

        <ConfigSection
          id="auth"
          highlighted={activeSectionId === 'auth'}
          ref={(node) => {
            sectionRefs.current.auth = node;
          }}
          title={t('config_management.visual.sections.auth.title')}
          description={t('config_management.visual.sections.auth.description')}
        >
          <SectionStack>
            <Input
              label={t('config_management.visual.sections.auth.auth_dir')}
              placeholder="~/.cli-proxy-api"
              value={values.authDir}
              onChange={(e) => onChange({ authDir: e.target.value })}
              disabled={disabled}
              hint={t('config_management.visual.sections.auth.auth_dir_hint')}
            />
            <div className={styles.subsection}>
              <ApiKeysCardEditor
                value={values.apiKeysText}
                disabled={disabled}
                onChange={handleApiKeysTextChange}
              />
            </div>
          </SectionStack>
        </ConfigSection>

        <ConfigSection
          id="system"
          highlighted={activeSectionId === 'system'}
          ref={(node) => {
            sectionRefs.current.system = node;
          }}
          title={t('config_management.visual.sections.system.title')}
          description={t('config_management.visual.sections.system.description')}
        >
          <SectionStack>
            <SectionGrid>
              <ToggleRow
                title={t('config_management.visual.sections.system.debug')}
                description={t('config_management.visual.sections.system.debug_desc')}
                checked={values.debug}
                disabled={disabled}
                onChange={(debug) => onChange({ debug })}
              />
              <ToggleRow
                title={t('config_management.visual.sections.system.commercial_mode')}
                description={t('config_management.visual.sections.system.commercial_mode_desc')}
                checked={values.commercialMode}
                disabled={disabled}
                onChange={(commercialMode) => onChange({ commercialMode })}
              />
              <ToggleRow
                title={t('config_management.visual.sections.system.logging_to_file')}
                description={t('config_management.visual.sections.system.logging_to_file_desc')}
                checked={values.loggingToFile}
                disabled={disabled}
                onChange={(loggingToFile) => onChange({ loggingToFile })}
              />
            </SectionGrid>

            <SectionGrid>
              <Input
                label={t('config_management.visual.sections.system.logs_max_size')}
                type="number"
                placeholder="0"
                value={values.logsMaxTotalSizeMb}
                onChange={(e) => onChange({ logsMaxTotalSizeMb: e.target.value })}
                disabled={disabled}
                error={logsMaxSizeError}
              />
            </SectionGrid>

            <SectionGrid>
              <div className={styles.routingPillField}>
                <label className={styles.routingPillTitle}>
                  {t('basic_settings.routing_strategy_label')}
                </label>
                <div className={styles.pillGroup}>
                  <button
                    type="button"
                    className={`${styles.pillButton} ${values.routingStrategy === 'round-robin' ? styles.pillButtonActive : ''}`}
                    onClick={() => onChange({ routingStrategy: 'round-robin' })}
                    disabled={disabled}
                  >
                    {t('basic_settings.routing_strategy_round_robin')}
                  </button>
                  <button
                    type="button"
                    className={`${styles.pillButton} ${values.routingStrategy === 'fill-first' ? styles.pillButtonActive : ''}`}
                    onClick={() => onChange({ routingStrategy: 'fill-first' })}
                    disabled={disabled}
                  >
                    {t('basic_settings.routing_strategy_fill_first')}
                  </button>
                </div>
                <div className={styles.fieldHint}>
                  {t('basic_settings.routing_strategy_hint')}
                </div>
              </div>
            </SectionGrid>
          </SectionStack>
        </ConfigSection>

        <ConfigSection
          id="network"
          highlighted={activeSectionId === 'network'}
          ref={(node) => {
            sectionRefs.current.network = node;
          }}
          title={t('config_management.visual.sections.network.title')}
          description={t('config_management.visual.sections.network.description')}
        >
          <SectionStack>
            <SectionGrid>
              <Input
                label={t('config_management.visual.sections.network.proxy_url')}
                placeholder="socks5://user:pass@127.0.0.1:1080/"
                value={values.proxyUrl}
                onChange={(e) => onChange({ proxyUrl: e.target.value })}
                disabled={disabled}
              />
              <Input
                label={t('config_management.visual.sections.network.request_retry')}
                type="number"
                placeholder="3"
                value={values.requestRetry}
                onChange={(e) => onChange({ requestRetry: e.target.value })}
                disabled={disabled}
                error={requestRetryError}
              />
              <Input
                label={t('config_management.visual.sections.network.max_retry_credentials')}
                type="number"
                placeholder="0"
                value={values.maxRetryCredentials}
                onChange={(e) => onChange({ maxRetryCredentials: e.target.value })}
                disabled={disabled}
                hint={t('config_management.visual.sections.network.max_retry_credentials_hint')}
                error={maxRetryCredentialsError}
              />
              <Input
                label={t('config_management.visual.sections.network.max_retry_interval')}
                type="number"
                placeholder="30"
                value={values.maxRetryInterval}
                onChange={(e) => onChange({ maxRetryInterval: e.target.value })}
                disabled={disabled}
                error={maxRetryIntervalError}
              />
              <Input
                label={t('config_management.visual.sections.network.session_affinity_ttl')}
                placeholder="1h"
                value={values.routingSessionAffinityTTL}
                onChange={(e) => onChange({ routingSessionAffinityTTL: e.target.value })}
                disabled={disabled}
              />
            </SectionGrid>

            <SectionGrid>
              <ToggleRow
                title={t('config_management.visual.sections.network.force_model_prefix')}
                description={t('config_management.visual.sections.network.force_model_prefix_desc')}
                checked={values.forceModelPrefix}
                disabled={disabled}
                onChange={(forceModelPrefix) => onChange({ forceModelPrefix })}
              />
              <ToggleRow
                title={t('config_management.visual.sections.network.session_affinity')}
                checked={values.routingSessionAffinity}
                disabled={disabled}
                onChange={(routingSessionAffinity) => onChange({ routingSessionAffinity })}
              />
              <ToggleRow
                title={t('config_management.visual.sections.network.ws_auth')}
                description={t('config_management.visual.sections.network.ws_auth_desc')}
                checked={values.wsAuth}
                disabled={disabled}
                onChange={(wsAuth) => onChange({ wsAuth })}
              />
            </SectionGrid>
          </SectionStack>
        </ConfigSection>

        <ConfigSection
          id="quota"
          highlighted={activeSectionId === 'quota'}
          ref={(node) => {
            sectionRefs.current.quota = node;
          }}
          title={t('config_management.visual.sections.quota.title')}
          description={t('config_management.visual.sections.quota.description')}
        >
          <SectionGrid>
            <ToggleRow
              title={t('config_management.visual.sections.quota.switch_project')}
              description={t('config_management.visual.sections.quota.switch_project_desc')}
              checked={values.quotaSwitchProject}
              disabled={disabled}
              onChange={(quotaSwitchProject) => onChange({ quotaSwitchProject })}
            />
            <ToggleRow
              title={t('config_management.visual.sections.quota.switch_preview_model')}
              description={t('config_management.visual.sections.quota.switch_preview_model_desc')}
              checked={values.quotaSwitchPreviewModel}
              disabled={disabled}
              onChange={(quotaSwitchPreviewModel) => onChange({ quotaSwitchPreviewModel })}
            />
            <ToggleRow
              title={t('config_management.visual.sections.quota.antigravity_credits')}
              description={t('config_management.visual.sections.quota.antigravity_credits_desc')}
              checked={values.quotaAntigravityCredits}
              disabled={disabled}
              onChange={(quotaAntigravityCredits) => onChange({ quotaAntigravityCredits })}
            />
          </SectionGrid>
        </ConfigSection>

        <ConfigSection
          id="streaming"
          highlighted={activeSectionId === 'streaming'}
          ref={(node) => {
            sectionRefs.current.streaming = node;
          }}
          title={t('config_management.visual.sections.streaming.title')}
          description={t('config_management.visual.sections.streaming.description')}
        >
          <SectionStack>
            <SectionGrid>
              <FieldShell
                label={t('config_management.visual.sections.streaming.keepalive_seconds')}
                htmlFor={keepaliveInputId}
                hint={t('config_management.visual.sections.streaming.keepalive_hint')}
                hintId={keepaliveHintId}
                error={keepaliveError}
                errorId={keepaliveErrorId}
              >
                <div className={styles.fieldControl}>
                  <input
                    id={keepaliveInputId}
                    className="input"
                    type="number"
                    placeholder="0"
                    value={values.streaming.keepaliveSeconds}
                    onChange={(e) =>
                      onChange({
                        streaming: {
                          ...values.streaming,
                          keepaliveSeconds: e.target.value,
                        },
                      })
                    }
                    disabled={disabled}
                  />
                  {isKeepaliveDisabled ? (
                    <span className={styles.inlinePill}>
                      {t('config_management.visual.sections.streaming.disabled')}
                    </span>
                  ) : null}
                </div>
              </FieldShell>

              <Input
                label={t('config_management.visual.sections.streaming.bootstrap_retries')}
                type="number"
                placeholder="1"
                value={values.streaming.bootstrapRetries}
                onChange={(e) =>
                  onChange({
                    streaming: {
                      ...values.streaming,
                      bootstrapRetries: e.target.value,
                    },
                  })
                }
                disabled={disabled}
                hint={t('config_management.visual.sections.streaming.bootstrap_hint')}
                error={bootstrapRetriesError}
              />
            </SectionGrid>

            <SectionGrid>
              <FieldShell
                label={t('config_management.visual.sections.streaming.nonstream_keepalive')}
                htmlFor={nonstreamKeepaliveInputId}
                hint={t('config_management.visual.sections.streaming.nonstream_keepalive_hint')}
                hintId={nonstreamKeepaliveHintId}
                error={nonstreamKeepaliveError}
                errorId={nonstreamKeepaliveErrorId}
              >
                <div className={styles.fieldControl}>
                  <input
                    id={nonstreamKeepaliveInputId}
                    className="input"
                    type="number"
                    placeholder="0"
                    value={values.streaming.nonstreamKeepaliveInterval}
                    onChange={(e) =>
                      onChange({
                        streaming: {
                          ...values.streaming,
                          nonstreamKeepaliveInterval: e.target.value,
                        },
                      })
                    }
                    disabled={disabled}
                  />
                  {isNonstreamKeepaliveDisabled ? (
                    <span className={styles.inlinePill}>
                      {t('config_management.visual.sections.streaming.disabled')}
                    </span>
                  ) : null}
                </div>
              </FieldShell>
            </SectionGrid>
          </SectionStack>
        </ConfigSection>

        <ConfigSection
          id="payload"
          highlighted={activeSectionId === 'payload'}
          ref={(node) => {
            sectionRefs.current.payload = node;
          }}
          title={t('config_management.visual.sections.payload.title')}
          description={t('config_management.visual.sections.payload.description')}
        >
          <SectionStack>
            <SectionSubsection
              title={t('config_management.visual.sections.payload.default_rules')}
              description={t('config_management.visual.sections.payload.default_rules_desc')}
            >
              <PayloadRulesEditor
                value={values.payloadDefaultRules}
                disabled={disabled}
                onChange={handlePayloadDefaultRulesChange}
              />
            </SectionSubsection>

            <SectionSubsection
              title={t('config_management.visual.sections.payload.default_raw_rules')}
              description={t('config_management.visual.sections.payload.default_raw_rules_desc')}
            >
              <PayloadRulesEditor
                value={values.payloadDefaultRawRules}
                disabled={disabled}
                rawJsonValues
                onChange={handlePayloadDefaultRawRulesChange}
              />
            </SectionSubsection>

            <SectionSubsection
              title={t('config_management.visual.sections.payload.override_rules')}
              description={t('config_management.visual.sections.payload.override_rules_desc')}
            >
              <PayloadRulesEditor
                value={values.payloadOverrideRules}
                disabled={disabled}
                protocolFirst
                onChange={handlePayloadOverrideRulesChange}
              />
            </SectionSubsection>

            <SectionSubsection
              title={t('config_management.visual.sections.payload.override_raw_rules')}
              description={t('config_management.visual.sections.payload.override_raw_rules_desc')}
            >
              <PayloadRulesEditor
                value={values.payloadOverrideRawRules}
                disabled={disabled}
                protocolFirst
                rawJsonValues
                onChange={handlePayloadOverrideRawRulesChange}
              />
            </SectionSubsection>

            <SectionSubsection
              title={t('config_management.visual.sections.payload.filter_rules')}
              description={t('config_management.visual.sections.payload.filter_rules_desc')}
            >
              <PayloadFilterRulesEditor
                value={values.payloadFilterRules}
                disabled={disabled}
                onChange={handlePayloadFilterRulesChange}
              />
            </SectionSubsection>
          </SectionStack>
        </ConfigSection>
      </div>

      {shouldRenderFloatingSidebar && typeof document !== 'undefined'
        ? createPortal(
            <div ref={floatingSidebarRef} className={styles.floatingSidebarContainer}>
              <div className={styles.floatingSidebarRail}>{navContent}</div>
            </div>,
            document.body
          )
        : null}
    </div>
  );
}
