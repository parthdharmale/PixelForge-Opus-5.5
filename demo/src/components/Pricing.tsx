import { plans } from '../data/content';
import { PricingCard } from './PricingCard';
import styles from './Pricing.module.css';

export function Pricing() {
  return (
    <section className="section" id="pricing">
      <div className="container">
        <div className="section-heading">
          <span className="eyebrow">Pricing</span>
          <h2 className="section-title">Simple, usage-based pricing</h2>
          <p className="section-subtitle">Start free. Upgrade when your traffic does.</p>
        </div>
        <div className={styles.plans}>
          {plans.map((plan) => (
            <PricingCard key={plan.name} plan={plan} />
          ))}
        </div>
      </div>
    </section>
  );
}
