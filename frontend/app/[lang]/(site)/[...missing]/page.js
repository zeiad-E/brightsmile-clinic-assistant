import { notFound } from 'next/navigation';

/**
 * Catches every URL that matches no page (/en/whatever/here) and shows our 404 inside the site
 * layout, with the header and footer. "[...missing]" means "any number of path parts".
 * Real pages always win over this catch-all.
 */

// This page only ever says "not found", so there is nothing for the dev-mode instant-navigation
// check to measure; switch that check off here.
export const instant = false;

export default function MissingPage() {
  notFound();
}
