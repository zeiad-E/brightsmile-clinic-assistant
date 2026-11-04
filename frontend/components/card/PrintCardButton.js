'use client';

import { useEffect, useState } from 'react';
import { createPortal, flushSync } from 'react-dom';
import { apiRequest } from '@/lib/api/client';
import SignInCard from './SignInCard';
import styles from './Card.module.css';

/**
 * Prints the sign-in card. The card is put straight under <body>, because the print rules hide
 * everything else on the page.
 *
 * `load` returns { name, code } when the button is pressed, so a screen that must record the
 * printing (the audit log) only asks for the code then.
 */
export default function PrintCardButton({ label, load, className, disabled, onError }) {
  const [card, setCard] = useState(null);

  useEffect(() => {
    const clear = () => setCard(null);
    window.addEventListener('afterprint', clear);
    return () => window.removeEventListener('afterprint', clear);
  }, []);

  async function print() {
    try {
      const details = await load();
      const clinic = await apiRequest('/clinic', { timeout: 8000 }).catch(() => null); // a card without the address still works
      // flushSync: the card must be on the page before the print window opens.
      flushSync(() => setCard({ ...details, clinic, site: window.location.host }));
      window.print();
    } catch (err) {
      onError?.(err);
    }
  }

  return (
    <>
      <button type="button" className={className} disabled={disabled} onClick={print}>
        {label}
      </button>
      {card && createPortal(<div className={styles.sheet}><SignInCard {...card} /></div>, document.body)}
    </>
  );
}
