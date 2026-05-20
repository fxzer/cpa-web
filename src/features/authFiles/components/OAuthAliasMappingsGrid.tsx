import { useMemo } from 'react';
import type { OAuthModelAliasEntry } from '@/types';
import styles from '@/pages/AuthFilesPage.module.scss';

type OAuthAliasMappingsGridProps = {
  mappings: OAuthModelAliasEntry[];
};

export function OAuthAliasMappingsGrid({ mappings }: OAuthAliasMappingsGridProps) {
  const items = useMemo(() => {
    return [...(mappings ?? [])]
      .filter((entry) => String(entry.name ?? '').trim() && String(entry.alias ?? '').trim())
      .sort((a, b) => {
        const aliasCompare = String(a.alias).localeCompare(String(b.alias));
        if (aliasCompare !== 0) return aliasCompare;
        return String(a.name).localeCompare(String(b.name));
      });
  }, [mappings]);

  if (items.length === 0) {
    return null;
  }

  return (
    <div className={styles.oauthAliasGrid}>
      {items.map((entry, index) => (
        <div
          key={`${entry.name}\u0000${entry.alias}\u0000${index}`}
          className={styles.oauthAliasCell}
          title={`${entry.name} → ${entry.alias}`}
        >
          <span className={styles.oauthAliasUpstream}>{entry.name}</span>
          <span className={styles.oauthAliasTarget}>{entry.alias}</span>
        </div>
      ))}
    </div>
  );
}
