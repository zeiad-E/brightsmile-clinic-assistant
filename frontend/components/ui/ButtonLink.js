import Link from 'next/link';

/**
 * A link that looks like a button (trial 003 styles). Works in server and client components.
 *   <ButtonLink href="/en/book" variant="mint" size="lg">Book</ButtonLink>
 */
export const buttonVariants = {
  mint: 'bg-mint text-white shadow-mint',
  dark: 'bg-ink text-white',
  ghost: 'bg-white/85 text-ink shadow-[inset_0_0_0_1.5px_var(--color-line)]',
};

export const buttonSizes = {
  sm: 'px-4 py-[9px] text-sm',
  lg: 'px-7 py-[17px] text-base',
};

export function buttonClasses({ variant = 'dark', size = 'sm', className = '' } = {}) {
  return [
    'inline-flex items-center justify-center gap-2 rounded-full font-[650] leading-[normal] no-underline',
    'transition-[transform,box-shadow] duration-300 ease-out-soft hover:-translate-y-0.5',
    buttonVariants[variant],
    buttonSizes[size],
    className,
  ].join(' ');
}

export default function ButtonLink({ href, variant, size, className, children, ...rest }) {
  return (
    <Link href={href} className={buttonClasses({ variant, size, className })} {...rest}>
      {children}
    </Link>
  );
}
