"use client";

import React, { useEffect, useRef, useState } from "react";

type RevealProps = {
  children: React.ReactNode;
  className?: string;
  delay?: number; // ms
  y?: number; // px translate on enter
  as?: React.ElementType;
};

export function Reveal({ children, className = "", delay = 0, y = 12, as: Tag = "div" }: RevealProps) {
  const ref = useRef<HTMLDivElement | null>(null);
  const [visible, setVisible] = useState(false);
  const [reduceMotion, setReduceMotion] = useState(false);

  useEffect(() => {
    const mediaQuery = window.matchMedia("(prefers-reduced-motion: reduce)");
    const updateMotionPreference = () => setReduceMotion(mediaQuery.matches);
    updateMotionPreference();
    mediaQuery.addEventListener("change", updateMotionPreference);

    const el = ref.current;
    if (!el) {
      mediaQuery.removeEventListener("change", updateMotionPreference);
      return;
    }
    const observer = new IntersectionObserver(
      (entries) => {
        entries.forEach((entry) => {
          if (entry.isIntersecting) {
            setVisible(true);
            observer.unobserve(entry.target);
          }
        });
      },
      { rootMargin: "0px 0px -10% 0px", threshold: 0.1 }
    );
    observer.observe(el);
    return () => {
      observer.disconnect();
      mediaQuery.removeEventListener("change", updateMotionPreference);
    };
  }, []);

  const style: React.CSSProperties = {
    transition: reduceMotion
      ? "opacity 120ms ease"
      : "opacity 300ms var(--ease-out), transform 300ms var(--ease-out)",
    transitionDelay: reduceMotion ? "0ms" : `${delay}ms`,
    transform: reduceMotion || visible ? "translateY(0px)" : `translateY(${y}px)`,
    opacity: visible ? 1 : 0,
  };

  return (
    // Dynamic tag element
    <Tag ref={ref} className={className} style={style}>
      {children}
    </Tag>
  );
}
