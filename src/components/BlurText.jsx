// React Bits–inspired BlurText (JS + framer-motion, no Tailwind).
// Adapted from https://github.com/DavidHDev/react-bits BlurText (MIT + Commons Clause).
import { useEffect, useMemo, useRef, useState } from "react";
import { motion } from "framer-motion";

function buildKeyframes(from, steps) {
  const keys = new Set([...Object.keys(from), ...steps.flatMap((s) => Object.keys(s))]);
  const keyframes = {};
  keys.forEach((k) => {
    keyframes[k] = [from[k], ...steps.map((s) => s[k])];
  });
  return keyframes;
}

/**
 * Soft blur-in text for marketing headlines.
 * @param {{ text?: string, delay?: number, animateBy?: "words"|"letters", direction?: "top"|"bottom", style?: React.CSSProperties, as?: keyof JSX.IntrinsicElements }} props
 */
export default function BlurText({
  text = "",
  delay = 120,
  animateBy = "words",
  direction = "top",
  style = {},
  className,
}) {
  const elements = animateBy === "words" ? text.split(" ") : text.split("");
  const [inView, setInView] = useState(false);
  const [reduced, setReduced] = useState(false);
  const ref = useRef(null);

  useEffect(() => {
    if (typeof window !== "undefined" && window.matchMedia("(prefers-reduced-motion: reduce)").matches) {
      setReduced(true);
      setInView(true);
      return;
    }
    if (!ref.current) return;
    const obs = new IntersectionObserver(
      ([entry]) => {
        if (entry.isIntersecting) {
          setInView(true);
          obs.disconnect();
        }
      },
      { threshold: 0.2 },
    );
    obs.observe(ref.current);
    return () => obs.disconnect();
  }, []);

  const from = useMemo(
    () =>
      reduced
        ? { filter: "blur(0px)", opacity: 1, y: 0 }
        : direction === "top"
          ? { filter: "blur(8px)", opacity: 0, y: -18 }
          : { filter: "blur(8px)", opacity: 0, y: 18 },
    [direction, reduced],
  );

  const to = useMemo(
    () =>
      reduced
        ? [{ filter: "blur(0px)", opacity: 1, y: 0 }]
        : [
            { filter: "blur(3px)", opacity: 0.65, y: direction === "top" ? 4 : -4 },
            { filter: "blur(0px)", opacity: 1, y: 0 },
          ],
    [direction, reduced],
  );

  const keyframes = buildKeyframes(from, to);
  const stepCount = to.length + 1;
  const times = Array.from({ length: stepCount }, (_, i) => (stepCount === 1 ? 0 : i / (stepCount - 1)));

  return (
    <span ref={ref} className={className} style={{ display: "inline", ...style }}>
      {elements.map((segment, index) => (
        <motion.span
          key={`${segment}-${index}`}
          initial={from}
          animate={inView ? keyframes : from}
          transition={{
            duration: reduced ? 0 : 0.55,
            times,
            delay: reduced ? 0 : (index * delay) / 1000,
            ease: [0.22, 1, 0.36, 1],
          }}
          style={{
            display: "inline-block",
            willChange: reduced ? "auto" : "transform, filter, opacity",
          }}
        >
          {segment === " " ? "\u00A0" : segment}
          {animateBy === "words" && index < elements.length - 1 ? "\u00A0" : null}
        </motion.span>
      ))}
    </span>
  );
}
