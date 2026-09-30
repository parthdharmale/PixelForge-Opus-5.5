import { features } from '../data/content';
import { FeatureCard } from './FeatureCard';
import styles from './Features.module.css';

export function Features() {
  return (
    <section className="section" id="features">
      <div className="container">
        <div className="section-heading">
          <span className="eyebrow">Platform</span>
          <h2 className="section-title">Everything you need to ship at the edge</h2>
          <p className="section-subtitle">A complete toolkit for building, deploying and observing globally distributed apps.</p>
        </div>
        <div className={styles.grid}>
          {features.map((feature) => (
            <FeatureCard key={feature.title} {...feature} />
          ))}
        </div>
      </div>
    </section>
  );
}
