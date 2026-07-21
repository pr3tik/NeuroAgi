// Shared GSAP registration + Lenis ↔ ScrollTrigger sync for marketing pages.
import gsap from "gsap";
import { ScrollTrigger } from "gsap/ScrollTrigger";
import { useGSAP } from "@gsap/react";

gsap.registerPlugin(ScrollTrigger, useGSAP);

export { gsap, ScrollTrigger, useGSAP };

export function prefersReducedMotion() {
  if (typeof window === "undefined") return false;
  return window.matchMedia("(prefers-reduced-motion: reduce)").matches;
}

/** Keep ScrollTrigger measurements correct while Lenis owns the scroll. */
export function syncLenisWithScrollTrigger(lenis) {
  if (!lenis) return () => {};
  const onScroll = () => ScrollTrigger.update();
  lenis.on("scroll", onScroll);
  // After Lenis mounts, recalc trigger positions.
  requestAnimationFrame(() => ScrollTrigger.refresh());
  return () => {
    lenis.off("scroll", onScroll);
  };
}
