import type { plans } from '../data/content';
import { Button } from './Button';
import styles from './Pricing.module.css';

interface PricingCardProps {
  plan: (typeof plans)[number];
}

export function PricingCard({ plan }: PricingCardProps) {
  return (
    <div className={`${styles.plan} ${plan.featured ? styles.featured : ''}`}>
      {plan.featured && <span className={styles.popular}>Most popular</span>}
      <h3 className={styles.planName}>{plan.name}</h3>
      <p className={styles.planDescription}>{plan.description}</p>
      <div className={styles.price}>
        <span className={styles.amount}>{plan.price}</span>
        <span className={styles.period}>{plan.period}</span>
      </div>
      <ul className={styles.featureList}>
        {plan.features.map((feature) => (
          <li key={feature} className={styles.feature}>
            <span className={styles.check}>✓</span>
            {feature}
          </li>
        ))}
      </ul>
      <Button variant={plan.featured ? 'primary' : 'secondary'} href="#signup">
        {plan.cta}
      </Button>
    </div>
  );
}
