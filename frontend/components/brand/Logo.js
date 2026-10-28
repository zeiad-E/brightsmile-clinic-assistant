/** The BrightSmile tooth mark (same shape as the trial 003 logo and 3D tooth outline). */
const TOOTH_D =
  'M40 30 C60 5 85 20 100 22 C115 20 140 5 160 30 C182 58 175 105 160 130 C150 150 148 175 142 205 C138 225 122 232 116 210 C110 185 106 165 100 165 C94 165 90 185 84 210 C78 232 62 225 58 205 C52 175 50 150 40 130 C25 105 18 58 40 30 Z';

export default function Logo({ className = 'size-[26px]', color = 'var(--color-mint)' }) {
  return (
    <svg viewBox="0 0 200 240" className={className} aria-hidden="true" focusable="false">
      <path d={TOOTH_D} fill={color} />
    </svg>
  );
}
