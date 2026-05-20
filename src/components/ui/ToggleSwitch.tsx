import type { ChangeEvent, ReactNode } from 'react';
import styles from './ToggleSwitch.module.scss';

interface ToggleSwitchProps {
  checked: boolean;
  onChange: (value: boolean) => void;
  label?: ReactNode;
  ariaLabel?: string;
  disabled?: boolean;
  labelPosition?: 'left' | 'right';
  checkedText?: string;
  uncheckedText?: string;
  trackClassName?: string;
  tone?: 'default' | 'danger';
}

export function ToggleSwitch({
  checked,
  onChange,
  label,
  ariaLabel,
  disabled = false,
  labelPosition = 'right',
  checkedText,
  uncheckedText,
  trackClassName,
  tone = 'default',
}: ToggleSwitchProps) {
  const handleChange = (event: ChangeEvent<HTMLInputElement>) => {
    onChange(event.target.checked);
  };

  const showInlineState = Boolean(checkedText && uncheckedText);

  const className = [
    styles.root,
    labelPosition === 'left' ? styles.labelLeft : '',
    disabled ? styles.disabled : '',
  ]
    .filter(Boolean)
    .join(' ');

  return (
    <label className={className}>
      <input
        type="checkbox"
        checked={checked}
        onChange={handleChange}
        disabled={disabled}
        aria-label={ariaLabel}
      />
      <span
        className={`${styles.track} ${tone === 'danger' ? styles.trackDanger : ''} ${showInlineState ? styles.trackInlineState : ''} ${trackClassName ?? ''}`.trim()}
      >
        {showInlineState && (
          <>
            <span className={styles.trackInlineSizer} aria-hidden="true">
              <span>{checkedText}</span>
              <span>{uncheckedText}</span>
            </span>
            <span className={styles.trackTextOn} aria-hidden="true">
              {checkedText}
            </span>
            <span className={styles.trackTextOff} aria-hidden="true">
              {uncheckedText}
            </span>
          </>
        )}
        <span className={styles.thumb} />
      </span>
      {label && <span className={styles.label}>{label}</span>}
    </label>
  );
}
