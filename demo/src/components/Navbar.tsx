import { useState } from 'react';
import { navLinks } from '../data/content';
import { Button } from './Button';
import styles from './Navbar.module.css';

export function Navbar() {
  const [open, setOpen] = useState(false);
  return (
    <header className={styles.header}>
      <nav className={`container ${styles.nav}`}>
        <a className={styles.brand} href="#top">
          <span className={styles.logo}>☁</span>
          Nimbus
        </a>
        <ul className={`${styles.links} ${open ? styles.linksOpen : ''}`}>
          {navLinks.map((link) => (
            <li key={link.href}>
              <a className={styles.link} href={link.href} onClick={() => setOpen(false)}>
                {link.label}
              </a>
            </li>
          ))}
        </ul>
        <div className={styles.actions}>
          <a className={styles.signIn} href="#signup">
            Sign in
          </a>
          <Button size="small" href="#signup">
            Get started
          </Button>
          <button className={styles.menuButton} type="button" aria-label="Toggle menu" onClick={() => setOpen(!open)}>
            <span />
            <span />
          </button>
        </div>
      </nav>
    </header>
  );
}
