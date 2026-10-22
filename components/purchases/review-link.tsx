'use client';

import { forwardRef, type ComponentProps } from 'react';
import Link from 'next/link';
import { useRouter } from 'next/navigation';
import { reviewNavigationDispatcher } from './incoming-review-history';

type ReviewLinkProps = Omit<ComponentProps<typeof Link>, 'href' | 'as' | 'legacyBehavior' | 'onNavigate'> & { href: string };

/** Opt-in internal string links only. Next's onNavigate excludes modifiers, new tabs and downloads. */
export const ReviewLink = forwardRef<HTMLAnchorElement, ReviewLinkProps>(function ReviewLink({ href, replace, scroll, ...props }, ref) {
  const router = useRouter();
  return <Link {...props} ref={ref} href={href} replace={replace} scroll={scroll} onNavigate={event => {
    if (!reviewNavigationDispatcher.hasOwner()) return;
    event.preventDefault();
    // The route-stable review owner validates session, source URL and intent.
    // Do not bind this to the link's lifetime: a menu closes after selection.
    reviewNavigationDispatcher.request(() => { if (replace) router.replace(href, { scroll }); else router.push(href, { scroll }); }, () => true);
  }} />;
});
