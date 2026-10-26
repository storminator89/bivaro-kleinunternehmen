import { Suspense, type ReactNode } from 'react';

/** Keep login query suspension local, without hiding the public app shell. */
export default function LoginLayout({ children }: { children: ReactNode }) {
  return <Suspense fallback={null}>{children}</Suspense>;
}
