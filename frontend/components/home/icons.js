/**
 * Drawings used on the home page (from trial 003), as React components.
 */
export const TOOTH_D =
  'M40 30 C60 5 85 20 100 22 C115 20 140 5 160 30 C182 58 175 105 160 130 C150 150 148 175 142 205 C138 225 122 232 116 210 C110 185 106 165 100 165 C94 165 90 185 84 210 C78 232 62 225 58 205 C52 175 50 150 40 130 C25 105 18 58 40 30 Z';

function Line({ children }) {
  return (
    <svg viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="1.8" strokeLinecap="round" strokeLinejoin="round" aria-hidden="true">
      {children}
    </svg>
  );
}

/** One icon per service, chosen by the service's slug. */
export const SERVICE_ICONS = {
  'check-up': () => (
    <Line>
      <circle cx="11" cy="11" r="6" />
      <path d="M20 20l-4-4" />
    </Line>
  ),
  'teeth-cleaning': () => (
    <Line>
      <path d="M12 3l2 6 6 2-6 2-2 6-2-6-6-2 6-2z" />
    </Line>
  ),
  filling: () => (
    <Line>
      <path d="M12 3l8 3v6c0 5-3.5 8-8 9-4.5-1-8-4-8-9V6z" />
      <path d="M9 12l2 2 4-4" />
    </Line>
  ),
  extraction: () => (
    <Line>
      <path d="M12 3v12M7 10l5 5 5-5M5 21h14" />
    </Line>
  ),
  'root-canal': () => (
    <Line>
      <path d="M3 12h4l2-5 4 10 2-5h6" />
    </Line>
  ),
  whitening: () => (
    <Line>
      <circle cx="12" cy="12" r="9" />
      <path d="M8 14s1.5 2 4 2 4-2 4-2M9 9.5h.01M15 9.5h.01" />
    </Line>
  ),
  'kids-check-up': () => (
    <Line>
      <circle cx="12" cy="8" r="4" />
      <path d="M5 21c0-4 3-6 7-6s7 2 7 6" />
    </Line>
  ),
  'braces-consultation': () => (
    <Line>
      <rect x="3" y="9" width="18" height="6" rx="3" />
      <path d="M7.5 9v6M12 9v6M16.5 9v6" />
    </Line>
  ),
};

export const FallbackServiceIcon = SERVICE_ICONS['check-up'];

export function Brush() {
  return (
    <svg viewBox="0 0 300 60" aria-hidden="true">
      <rect x="0" y="26" width="196" height="16" rx="8" fill="#14b8a6" />
      <rect x="22" y="30" width="60" height="8" rx="4" fill="#0f766e" opacity=".45" />
      <rect x="190" y="22" width="102" height="20" rx="8" fill="#fff" stroke="#bfe9e2" strokeWidth="2" />
      {Array.from({ length: 9 }, (_, i) => (
        <rect key={i} x={204 + i * 9.5} y="2" width="6" height="22" rx="3" fill={i % 2 ? '#5eead4' : '#fff'} stroke="#bfe9e2" />
      ))}
    </svg>
  );
}

export function Floss() {
  return (
    <svg viewBox="0 0 100 120" aria-hidden="true">
      <rect x="10" y="30" width="80" height="80" rx="18" fill="#fff" stroke="#bfe9e2" strokeWidth="3" />
      <rect x="10" y="30" width="80" height="22" rx="11" fill="#14b8a6" />
      <path d="M50 30 C50 10 70 8 86 2" stroke="#0f766e" strokeWidth="2" fill="none" />
      <circle cx="50" cy="80" r="14" fill="#e6faf7" />
    </svg>
  );
}

/** Friendly flat tooth, shown in the hero when the browser can't draw 3D (no WebGL). */
export function Mascot() {
  return (
    <svg viewBox="0 0 200 240" style={{ width: '100%', height: '100%' }} aria-hidden="true">
      <path d={TOOTH_D} fill="#fff" stroke="#bfe9e2" strokeWidth="5" />
      <ellipse cx="76" cy="104" rx="9" ry="12" fill="#0b2545" />
      <ellipse cx="124" cy="104" rx="9" ry="12" fill="#0b2545" />
      <path d="M82 132 Q100 152 118 132" stroke="#0b2545" strokeWidth="6" fill="none" strokeLinecap="round" />
    </svg>
  );
}
