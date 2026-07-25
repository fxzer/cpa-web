import styles from '@/pages/AiProvidersPage.module.scss';

interface ProviderPrioritySignalProps {
  value?: number;
}

const BLOCK_COUNT = 10;

function getDisplayPriority(value?: number) {
  if (typeof value !== 'number' || !Number.isFinite(value)) return 0;
  return Math.trunc(value);
}

function getVisualPriority(value: number) {
  if (typeof value !== 'number' || !Number.isFinite(value)) return 0;
  return Math.max(0, Math.min(10, value));
}

function getPriorityTone(value: number) {
  if (value >= 10) return styles.providerPriorityBlockPurpleStrong;
  if (value >= 6) return styles.providerPriorityBlockPurple;
  if (value >= 3) return styles.providerPriorityBlockBlue;
  if (value >= 1) return styles.providerPriorityBlockSlate;
  return '';
}

export function ProviderPrioritySignal({ value }: ProviderPrioritySignalProps) {
  const priority = getDisplayPriority(value);
  const visualPriority = getVisualPriority(priority);
  const filledCount = visualPriority;
  const toneClassName = getPriorityTone(visualPriority);

  return (
    <div className={styles.providerPrioritySignal} aria-label={`priority ${priority}`}>
      <div className={styles.providerPriorityBlocks} aria-hidden="true">
        {Array.from({ length: BLOCK_COUNT }, (_, index) => (
          <span
            key={index}
            className={`${styles.providerPriorityBlock} ${index < filledCount ? toneClassName : styles.providerPriorityBlockEmpty}`}
          />
        ))}
      </div>
      <span
        className={`${styles.providerPriorityValue} ${priority === 0 ? styles.providerPriorityValueEmpty : ''}`}
      >
        {priority}
      </span>
    </div>
  );
}
