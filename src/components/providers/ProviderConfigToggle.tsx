import { useTranslation } from 'react-i18next';
import { ToggleSwitch } from '@/components/ui/ToggleSwitch';
import styles from '@/pages/AiProvidersPage.module.scss';

interface ProviderConfigToggleProps {
  checked: boolean;
  disabled?: boolean;
  onChange: (value: boolean) => void;
}

export function ProviderConfigToggle({ checked, disabled, onChange }: ProviderConfigToggleProps) {
  const { t } = useTranslation();

  return (
    <div className={styles.providerStatusToggle}>
      <ToggleSwitch
        trackClassName={styles.cardStatusSwitchTrack}
        ariaLabel={
          checked ? t('ai_providers.config_enabled_label') : t('ai_providers.config_disabled_label')
        }
        checked={checked}
        checkedText={t('ai_providers.config_enabled_label')}
        uncheckedText={t('ai_providers.config_disabled_label')}
        disabled={disabled}
        onChange={onChange}
      />
    </div>
  );
}
