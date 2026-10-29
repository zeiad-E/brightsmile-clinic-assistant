'use client';

import { useEffect, useState } from 'react';
import styles from './Privacy.module.css';

/** The sticky "On this page" list: it highlights the section you are reading (scroll-spy). */
export default function Toc({ title, sections }) {
  const [active, setActive] = useState(sections[0]?.id);

  useEffect(() => {
    // a section counts as "being read" while it crosses a thin band 30% down the screen
    const observer = new IntersectionObserver(
      (entries) => entries.forEach((entry) => entry.isIntersecting && setActive(entry.target.id)),
      { rootMargin: '-30% 0px -65% 0px' },
    );
    sections.forEach(({ id }) => {
      const el = document.getElementById(id);
      if (el) observer.observe(el);
    });
    return () => observer.disconnect();
  }, [sections]);

  return (
    <nav className={styles.toc} aria-label={title}>
      <p>{title}</p>
      <ol>
        {sections.map((section) => (
          <li key={section.id}>
            <a href={`#${section.id}`} aria-current={active === section.id ? 'true' : undefined}>
              {section.title}
            </a>
          </li>
        ))}
      </ol>
    </nav>
  );
}
