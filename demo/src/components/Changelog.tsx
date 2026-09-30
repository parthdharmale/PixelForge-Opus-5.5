import { changelog } from '../data/content';
import styles from './Changelog.module.css';

export function Changelog() {
  return (
    <section className="section" id="changelog">
      <div className={`container ${styles.layout}`}>
        <div>
          <span className="eyebrow">Changelog</span>
          <h2 className="section-title">Shipping every week</h2>
          <p className="section-subtitle">Follow along as we improve the platform. The feed on the right scrolls independently.</p>
        </div>
        <div className={styles.feed}>
          {changelog.map((entry) => (
            <article key={entry.version} className={styles.entry}>
              <div className={styles.meta}>
                <span className={styles.version}>v{entry.version}</span>
                <time className={styles.date}>{entry.date}</time>
              </div>
              <h3 className={styles.entryTitle}>{entry.title}</h3>
              <p className={styles.entryBody}>{entry.body}</p>
            </article>
          ))}
        </div>
      </div>
    </section>
  );
}
