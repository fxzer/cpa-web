import { forwardRef, type HTMLAttributes, type PropsWithChildren, type ReactNode } from 'react';
import styles from './ConfigSection.module.scss';

interface ConfigSectionProps extends Omit<HTMLAttributes<HTMLElement>, 'title'> {
  title: ReactNode;
  description?: ReactNode;
  /** 与主侧栏 `nav-item.active` 一致的成功色底，用于与左侧章节导航联动 */
  highlighted?: boolean;
}

export const ConfigSection = forwardRef<HTMLElement, PropsWithChildren<ConfigSectionProps>>(
  function ConfigSection({ title, description, highlighted, className, children, ...rest }, ref) {
    const sectionClassName = [styles.section, highlighted ? styles.sectionActive : '', className]
      .filter(Boolean)
      .join(' ');

    return (
      <section ref={ref} className={sectionClassName} {...rest}>
        <header className={styles.header}>
          <div className={styles.headingGroup}>
            <h2 className={styles.title}>{title}</h2>
            {description ? <p className={styles.description}>{description}</p> : null}
          </div>
        </header>
        <div className={styles.content}>{children}</div>
      </section>
    );
  }
);
