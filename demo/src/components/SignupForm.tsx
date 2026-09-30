import { useState, type FormEvent } from 'react';
import { Button } from './Button';
import styles from './SignupForm.module.css';

export function SignupForm() {
  const [email, setEmail] = useState('');
  const [submitted, setSubmitted] = useState(false);

  function handleSubmit(e: FormEvent) {
    e.preventDefault();
    if (email) setSubmitted(true);
  }

  return (
    <section className="section" id="signup">
      <div className="container">
        <div className={styles.panel}>
          <h2 className={styles.title}>Start deploying today</h2>
          <p className={styles.text}>Get 100k requests free every month. No credit card required.</p>
          {submitted ? (
            <p className={styles.success}>Thanks! Check {email} for your invite.</p>
          ) : (
            <form className={styles.form} onSubmit={handleSubmit}>
              <label className={styles.label} htmlFor="email">
                Work email
              </label>
              <input
                id="email"
                className={styles.input}
                type="email"
                placeholder="you@company.com"
                value={email}
                onChange={(e) => setEmail(e.target.value)}
                required
              />
              <Button type="submit">Create account</Button>
            </form>
          )}
        </div>
      </div>
    </section>
  );
}
