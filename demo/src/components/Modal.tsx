import { useEffect } from 'react';
import styles from './Modal.module.css';

interface ModalProps {
  open: boolean;
  onClose: () => void;
}

export function Modal({ open, onClose }: ModalProps) {
  useEffect(() => {
    const onKey = (e: KeyboardEvent) => e.key === 'Escape' && onClose();
    window.addEventListener('keydown', onKey);
    return () => window.removeEventListener('keydown', onKey);
  }, [onClose]);

  if (!open) return null;
  return (
    <div className={styles.backdrop} role="dialog" aria-modal="true">
      <div className={styles.dialog}>
        <div className={styles.header}>
          <h3 className={styles.title}>Nimbus in 90 seconds</h3>
          <button className={styles.close} type="button" onClick={onClose} aria-label="Close">
            ×
          </button>
        </div>
        <div className={styles.video}>▶ Demo video</div>
        <p className={styles.caption}>See how a function goes from git push to 312 regions.</p>
      </div>
    </div>
  );
}
