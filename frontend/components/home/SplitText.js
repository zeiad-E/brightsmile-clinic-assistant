import styles from './Home.module.css';

/**
 * Splits text into pieces that can animate one by one: one <span class="c"> per letter, grouped in
 * one <span class="w"> per word. Arabic is split per WORD instead: Arabic letters join to their
 * neighbours, and cutting them into separate boxes would break the writing.
 */
export default function SplitText({ text, arabic, start = 0 }) {
  let i = start;
  const words = text.split(/\s+/).filter(Boolean);
  return words.map((word, w) => (
    <span key={w}>
      {w > 0 && ' '}
      <span className={styles.w}>
        {(arabic ? [word] : [...word]).map((piece, p) => (
          <span key={p} className={styles.c} style={{ '--i': i++ }}>
            {piece}
          </span>
        ))}
      </span>
    </span>
  ));
}
