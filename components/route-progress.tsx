"use client";

import { useEffect, useRef, useState } from "react";
import { usePathname, useSearchParams } from "next/navigation";

/**
 * Slim top progress bar that animates on route changes.
 * Inspired by NProgress, but lightweight and dependency-free.
 */
export function RouteProgress() {
  const pathname = usePathname();
  const searchParams = useSearchParams();
  const [progress, setProgress] = useState(0);
  const [visible, setVisible] = useState(false);
  const timerRef = useRef<ReturnType<typeof setTimeout> | null>(null);
  const initialRender = useRef(true);

  useEffect(() => {
    if (initialRender.current) {
      initialRender.current = false;
      return;
    }

    if (timerRef.current) clearTimeout(timerRef.current);

    setVisible(true);
    setProgress(20);
    const t1 = setTimeout(() => setProgress(60), 80);
    const t2 = setTimeout(() => setProgress(85), 200);
    const t3 = setTimeout(() => {
      setProgress(100);
      timerRef.current = setTimeout(() => {
        setVisible(false);
        setProgress(0);
      }, 220);
    }, 380);

    return () => {
      clearTimeout(t1);
      clearTimeout(t2);
      clearTimeout(t3);
    };
  }, [pathname, searchParams]);

  return (
    <div
      aria-hidden="true"
      className="pointer-events-none fixed left-0 right-0 top-0 z-[100] h-0.5"
      style={{ opacity: visible ? 1 : 0, transition: "opacity 200ms ease-out" }}
    >
      <div
        className="h-full bg-primary shadow-[0_0_8px_var(--primary)]"
        style={{
          width: `${progress}%`,
          transition: "width 200ms ease-out",
        }}
      />
    </div>
  );
}
