import { Button } from './Button';
import styles from './Hero.module.css';

interface HeroProps {
  onWatchDemo: () => void;
}

export function Hero({ onWatchDemo }: HeroProps) {
  return (
    <section className={styles.hero} id="top">
      <div className={`container ${styles.inner}`}>
        <div className={styles.copy}>
          <span className={styles.badge}>New · Streaming responses</span>
          <h1 className={styles.title}>Deploy edge functions in seconds</h1>
          <p className={styles.subtitle}>
            Nimbus runs your code on 300+ locations worldwide. Zero config, instant rollbacks and observability built
            in.
          </p>
          <div className={styles.ctas}>
            <Button href="#signup">Start building</Button>
            <Button variant="secondary" onClick={onWatchDemo}>
              Watch demo
            </Button>
          </div>
          <dl className={styles.stats} style={{ display: 'flex', gap: 40, marginTop: 48 }}>
            <div>
              <dt className={styles.statValue}>12ms</dt>
              <dd className={styles.statLabel}>median latency</dd>
            </div>
            <div>
              <dt className={styles.statValue}>99.99%</dt>
              <dd className={styles.statLabel}>uptime SLA</dd>
            </div>
            <div>
              <dt className={styles.statValue}>4.2B</dt>
              <dd className={styles.statLabel}>requests / day</dd>
            </div>
          </dl>
        </div>
        <div className={styles.visual}>
          <div className={styles.window}>
            <div className={styles.windowBar}>
              <span />
              <span />
              <span />
              <code className={styles.fileName}>api/hello.ts</code>
            </div>
            <pre className={styles.code}>
              <code>{`export default async (req: Request) => {
  const city = req.geo.city ?? 'the edge';
  return Response.json({
    message: \`Hello from \${city}\`,
  });
};`}</code>
            </pre>
          </div>
          <div className={styles.floatingCard}>
            <span className={styles.dot} />
            Deployed to 312 regions
          </div>
        </div>
      </div>
    </section>
  );
}
