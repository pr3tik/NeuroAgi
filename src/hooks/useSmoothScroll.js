// SmoothScroll — Lenis gliding scroll for the whole document.
// Call useSmoothScroll() once per page root (App, /card, /claim, waitlist dash).
import { useEffect, useRef, useCallback } from "react";
import Lenis from "lenis";
import "lenis/dist/lenis.css";
import { syncLenisWithScrollTrigger } from "../lib/gsapSetup";

/**
 * @returns {{ lenisRef: React.MutableRefObject<Lenis | null>, scrollTo: (target: string | Element, opts?: object) => void }}
 */
export function useSmoothScroll() {
  const lenisRef = useRef(null);

  useEffect(() => {
    if (typeof window === "undefined") return;
    if (window.matchMedia("(prefers-reduced-motion: reduce)").matches) return;

    const lenis = new Lenis({
      duration: 1.2,
      easing: (t) => Math.min(1, 1.001 - Math.pow(2, -10 * t)),
      smoothWheel: true,
      touchMultiplier: 1.15,
    });
    lenisRef.current = lenis;
    // Allow one-off scrollTo from siblings (e.g. Landing deep-link) without React context.
    window.__fschoolLenis = lenis;

    const unsync = syncLenisWithScrollTrigger(lenis);

    let rafId = 0;
    const raf = (time) => {
      lenis.raf(time);
      rafId = requestAnimationFrame(raf);
    };
    rafId = requestAnimationFrame(raf);

    return () => {
      cancelAnimationFrame(rafId);
      unsync();
      if (window.__fschoolLenis === lenis) window.__fschoolLenis = null;
      lenis.destroy();
      lenisRef.current = null;
    };
  }, []);

  const scrollTo = useCallback((target, { offset = -64, duration = 1.25 } = {}) => {
    const el = typeof target === "string" ? document.getElementById(target) : target;
    if (!el) return;
    if (lenisRef.current) {
      lenisRef.current.scrollTo(el, { offset, duration });
    } else {
      el.scrollIntoView({ behavior: "smooth", block: "start" });
    }
  }, []);

  return { lenisRef, scrollTo };
}
