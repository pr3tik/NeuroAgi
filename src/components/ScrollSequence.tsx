// Scroll-linked image sequence (Apple AirPods technique) rendered on a canvas.
// Preloads every frame, pins a centred stage, and scrubs the frame index to the
// scroll position via GSAP ScrollTrigger. Respects prefers-reduced-motion.
//
// The stage is intentionally *contained* (not full-bleed): the source frames are
// 1280x720, so filling a large viewport would upscale them and look soft. A
// capped, centred stage keeps the upscale factor low and the frames crisp.
import { useEffect, useRef } from "react";
// Use the page's shared GSAP instance so there's a single ScrollTrigger that the
// page's Lenis smooth-scroll already drives (see lib/gsapSetup + useSmoothScroll).
import { gsap, ScrollTrigger } from "../lib/gsapSetup";
import type { ScrollTrigger as ScrollTriggerInstance } from "gsap/ScrollTrigger";

/* ---- config ---------------------------------------------------------------- */

// Base URL the frames are served from (Vite serves /public at the site root).
const FRAMES_DIR = "/frames-extractor-all/";

// Native size of the source frames — used for the aspect-correct draw.
const FRAME_W = 1280;
const FRAME_H = 720;

// Scroll distance the pinned sequence occupies. Bigger = slower scrub, but each
// frame holds over more scroll => finer steps => smoother-looking sequence.
const SCROLL_PER_FRAME = 16; // px of scroll per frame (desktop)

// On narrow screens, keep every Nth frame to cut download + decode cost.
const MOBILE_BREAKPOINT = 700; // px
const MOBILE_FRAME_STEP = 2; //  2 = half the frames on phones

// Full ordered frame list (generated from public/frames-extractor-all/).
const ALL_FRAMES: string[] = ["frames-extractor-0001-0-00.webp","frames-extractor-0002-0-03.webp","frames-extractor-0003-0-07.webp","frames-extractor-0004-0-10.webp","frames-extractor-0005-0-13.webp","frames-extractor-0006-0-17.webp","frames-extractor-0007-0-20.webp","frames-extractor-0008-0-23.webp","frames-extractor-0009-0-27.webp","frames-extractor-0010-0-30.webp","frames-extractor-0011-0-33.webp","frames-extractor-0012-0-37.webp","frames-extractor-0013-0-40.webp","frames-extractor-0014-0-43.webp","frames-extractor-0015-0-47.webp","frames-extractor-0016-0-50.webp","frames-extractor-0017-0-53.webp","frames-extractor-0018-0-57.webp","frames-extractor-0019-0-60.webp","frames-extractor-0020-0-63.webp","frames-extractor-0021-0-67.webp","frames-extractor-0022-0-70.webp","frames-extractor-0023-0-73.webp","frames-extractor-0024-0-77.webp","frames-extractor-0025-0-80.webp","frames-extractor-0026-0-83.webp","frames-extractor-0027-0-87.webp","frames-extractor-0028-0-90.webp","frames-extractor-0029-0-93.webp","frames-extractor-0030-0-97.webp","frames-extractor-0031-1-00.webp","frames-extractor-0032-1-03.webp","frames-extractor-0033-1-07.webp","frames-extractor-0034-1-10.webp","frames-extractor-0035-1-13.webp","frames-extractor-0036-1-17.webp","frames-extractor-0037-1-20.webp","frames-extractor-0038-1-23.webp","frames-extractor-0039-1-27.webp","frames-extractor-0040-1-30.webp","frames-extractor-0041-1-33.webp","frames-extractor-0042-1-37.webp","frames-extractor-0043-1-40.webp","frames-extractor-0044-1-43.webp","frames-extractor-0045-1-47.webp","frames-extractor-0046-1-50.webp","frames-extractor-0047-1-53.webp","frames-extractor-0048-1-57.webp","frames-extractor-0049-1-60.webp","frames-extractor-0050-1-63.webp","frames-extractor-0051-1-67.webp","frames-extractor-0052-1-70.webp","frames-extractor-0053-1-73.webp","frames-extractor-0054-1-77.webp","frames-extractor-0055-1-80.webp","frames-extractor-0056-1-83.webp","frames-extractor-0057-1-87.webp","frames-extractor-0058-1-90.webp","frames-extractor-0059-1-93.webp","frames-extractor-0060-1-97.webp","frames-extractor-0061-2-00.webp","frames-extractor-0062-2-03.webp","frames-extractor-0063-2-07.webp","frames-extractor-0064-2-10.webp","frames-extractor-0065-2-13.webp","frames-extractor-0066-2-17.webp","frames-extractor-0067-2-20.webp","frames-extractor-0068-2-23.webp","frames-extractor-0069-2-27.webp","frames-extractor-0070-2-30.webp","frames-extractor-0071-2-33.webp","frames-extractor-0072-2-37.webp","frames-extractor-0073-2-40.webp","frames-extractor-0074-2-43.webp","frames-extractor-0075-2-47.webp","frames-extractor-0076-2-50.webp","frames-extractor-0077-2-53.webp","frames-extractor-0078-2-57.webp","frames-extractor-0079-2-60.webp","frames-extractor-0080-2-63.webp","frames-extractor-0081-2-67.webp","frames-extractor-0082-2-70.webp","frames-extractor-0083-2-73.webp","frames-extractor-0084-2-77.webp","frames-extractor-0085-2-80.webp","frames-extractor-0086-2-83.webp","frames-extractor-0087-2-87.webp","frames-extractor-0088-2-90.webp","frames-extractor-0089-2-93.webp","frames-extractor-0090-2-97.webp","frames-extractor-0091-3-00.webp","frames-extractor-0092-3-03.webp","frames-extractor-0093-3-07.webp","frames-extractor-0094-3-10.webp","frames-extractor-0095-3-13.webp","frames-extractor-0096-3-17.webp","frames-extractor-0097-3-20.webp","frames-extractor-0098-3-23.webp","frames-extractor-0099-3-27.webp","frames-extractor-0100-3-30.webp","frames-extractor-0101-3-33.webp","frames-extractor-0102-3-37.webp","frames-extractor-0103-3-40.webp","frames-extractor-0104-3-43.webp","frames-extractor-0105-3-47.webp","frames-extractor-0106-3-50.webp","frames-extractor-0107-3-53.webp","frames-extractor-0108-3-57.webp","frames-extractor-0109-3-60.webp","frames-extractor-0110-3-63.webp","frames-extractor-0111-3-67.webp","frames-extractor-0112-3-70.webp","frames-extractor-0113-3-73.webp","frames-extractor-0114-3-77.webp","frames-extractor-0115-3-80.webp","frames-extractor-0116-3-83.webp","frames-extractor-0117-3-87.webp","frames-extractor-0118-3-90.webp","frames-extractor-0119-3-93.webp","frames-extractor-0120-3-97.webp","frames-extractor-0121-4-00.webp","frames-extractor-0122-4-03.webp","frames-extractor-0123-4-07.webp","frames-extractor-0124-4-10.webp","frames-extractor-0125-4-13.webp","frames-extractor-0126-4-17.webp","frames-extractor-0127-4-20.webp","frames-extractor-0128-4-23.webp","frames-extractor-0129-4-27.webp","frames-extractor-0130-4-30.webp","frames-extractor-0131-4-33.webp","frames-extractor-0132-4-37.webp","frames-extractor-0133-4-40.webp","frames-extractor-0134-4-43.webp","frames-extractor-0135-4-47.webp","frames-extractor-0136-4-50.webp","frames-extractor-0137-4-53.webp","frames-extractor-0138-4-57.webp","frames-extractor-0139-4-60.webp","frames-extractor-0140-4-63.webp","frames-extractor-0141-4-67.webp","frames-extractor-0142-4-70.webp","frames-extractor-0143-4-73.webp","frames-extractor-0144-4-77.webp","frames-extractor-0145-4-80.webp","frames-extractor-0146-4-83.webp","frames-extractor-0147-4-87.webp","frames-extractor-0148-4-90.webp","frames-extractor-0149-4-93.webp","frames-extractor-0150-4-97.webp","frames-extractor-0151-5-00.webp","frames-extractor-0152-5-03.webp","frames-extractor-0153-5-07.webp","frames-extractor-0154-5-10.webp","frames-extractor-0155-5-13.webp","frames-extractor-0156-5-17.webp","frames-extractor-0157-5-20.webp","frames-extractor-0158-5-23.webp","frames-extractor-0159-5-27.webp","frames-extractor-0160-5-30.webp","frames-extractor-0161-5-33.webp","frames-extractor-0162-5-37.webp","frames-extractor-0163-5-40.webp","frames-extractor-0164-5-43.webp","frames-extractor-0165-5-47.webp","frames-extractor-0166-5-50.webp","frames-extractor-0167-5-53.webp","frames-extractor-0168-5-57.webp","frames-extractor-0169-5-60.webp","frames-extractor-0170-5-63.webp","frames-extractor-0171-5-67.webp","frames-extractor-0172-5-70.webp","frames-extractor-0173-5-73.webp","frames-extractor-0174-5-77.webp","frames-extractor-0175-5-80.webp","frames-extractor-0176-5-83.webp","frames-extractor-0177-5-87.webp","frames-extractor-0178-5-90.webp","frames-extractor-0179-5-93.webp","frames-extractor-0180-5-97.webp","frames-extractor-0181-6-00.webp","frames-extractor-0182-6-03.webp","frames-extractor-0183-6-07.webp","frames-extractor-0184-6-10.webp","frames-extractor-0185-6-13.webp","frames-extractor-0186-6-17.webp","frames-extractor-0187-6-20.webp","frames-extractor-0188-6-23.webp","frames-extractor-0189-6-27.webp","frames-extractor-0190-6-30.webp","frames-extractor-0191-6-33.webp","frames-extractor-0192-6-37.webp","frames-extractor-0193-6-40.webp","frames-extractor-0194-6-43.webp","frames-extractor-0195-6-47.webp","frames-extractor-0196-6-50.webp","frames-extractor-0197-6-53.webp","frames-extractor-0198-6-57.webp","frames-extractor-0199-6-60.webp","frames-extractor-0200-6-63.webp","frames-extractor-0201-6-67.webp","frames-extractor-0202-6-70.webp","frames-extractor-0203-6-73.webp","frames-extractor-0204-6-77.webp","frames-extractor-0205-6-80.webp","frames-extractor-0206-6-83.webp","frames-extractor-0207-6-87.webp","frames-extractor-0208-6-90.webp","frames-extractor-0209-6-93.webp","frames-extractor-0210-6-97.webp","frames-extractor-0211-7-00.webp","frames-extractor-0212-7-03.webp","frames-extractor-0213-7-07.webp","frames-extractor-0214-7-10.webp","frames-extractor-0215-7-13.webp","frames-extractor-0216-7-17.webp","frames-extractor-0217-7-20.webp","frames-extractor-0218-7-23.webp","frames-extractor-0219-7-27.webp","frames-extractor-0220-7-30.webp","frames-extractor-0221-7-33.webp","frames-extractor-0222-7-37.webp","frames-extractor-0223-7-40.webp","frames-extractor-0224-7-43.webp","frames-extractor-0225-7-47.webp","frames-extractor-0226-7-50.webp","frames-extractor-0227-7-53.webp","frames-extractor-0228-7-57.webp","frames-extractor-0229-7-60.webp","frames-extractor-0230-7-63.webp","frames-extractor-0231-7-67.webp","frames-extractor-0232-7-70.webp","frames-extractor-0233-7-73.webp","frames-extractor-0234-7-77.webp","frames-extractor-0235-7-80.webp","frames-extractor-0236-7-83.webp","frames-extractor-0237-7-87.webp","frames-extractor-0238-7-90.webp","frames-extractor-0239-7-93.webp","frames-extractor-0240-7-97.webp","frames-extractor-0241-8-00.webp","frames-extractor-0242-8-03.webp","frames-extractor-0243-8-07.webp","frames-extractor-0244-8-10.webp","frames-extractor-0245-8-13.webp","frames-extractor-0246-8-17.webp","frames-extractor-0247-8-20.webp","frames-extractor-0248-8-23.webp","frames-extractor-0249-8-27.webp","frames-extractor-0250-8-30.webp","frames-extractor-0251-8-33.webp","frames-extractor-0252-8-37.webp","frames-extractor-0253-8-40.webp","frames-extractor-0254-8-43.webp","frames-extractor-0255-8-47.webp","frames-extractor-0256-8-50.webp","frames-extractor-0257-8-53.webp","frames-extractor-0258-8-57.webp","frames-extractor-0259-8-60.webp","frames-extractor-0260-8-63.webp","frames-extractor-0261-8-67.webp","frames-extractor-0262-8-70.webp","frames-extractor-0263-8-73.webp","frames-extractor-0264-8-77.webp","frames-extractor-0265-8-80.webp","frames-extractor-0266-8-83.webp","frames-extractor-0267-8-87.webp","frames-extractor-0268-8-90.webp","frames-extractor-0269-8-93.webp","frames-extractor-0270-8-97.webp","frames-extractor-0271-9-00.webp","frames-extractor-0272-9-03.webp","frames-extractor-0273-9-07.webp","frames-extractor-0274-9-10.webp","frames-extractor-0275-9-13.webp","frames-extractor-0276-9-17.webp","frames-extractor-0277-9-20.webp","frames-extractor-0278-9-23.webp","frames-extractor-0279-9-27.webp","frames-extractor-0280-9-30.webp","frames-extractor-0281-9-33.webp","frames-extractor-0282-9-37.webp","frames-extractor-0283-9-40.webp","frames-extractor-0284-9-43.webp","frames-extractor-0285-9-47.webp","frames-extractor-0286-9-50.webp","frames-extractor-0287-9-53.webp","frames-extractor-0288-9-57.webp","frames-extractor-0289-9-60.webp","frames-extractor-0290-9-63.webp","frames-extractor-0291-9-67.webp","frames-extractor-0292-9-70.webp","frames-extractor-0293-9-73.webp","frames-extractor-0294-9-77.webp","frames-extractor-0295-9-80.webp","frames-extractor-0296-9-83.webp","frames-extractor-0297-9-87.webp","frames-extractor-0298-9-90.webp","frames-extractor-0299-9-93.webp","frames-extractor-0300-9-96.webp","frames-extractor-0301-9-96.webp"];

/* ---- component ------------------------------------------------------------- */

type Props = {
  headline?: string;
  subhead?: string;
};

export default function ScrollSequence({
  headline = "See it in motion.",
  subhead = "",
}: Props) {
  const sectionRef = useRef<HTMLElement | null>(null);
  const stageRef = useRef<HTMLDivElement | null>(null);
  const canvasRef = useRef<HTMLCanvasElement | null>(null);
  const headlineRef = useRef<HTMLDivElement | null>(null);
  const loaderRef = useRef<HTMLDivElement | null>(null);
  const fillRef = useRef<HTMLDivElement | null>(null);
  const pctRef = useRef<HTMLDivElement | null>(null);

  useEffect(() => {
    const section = sectionRef.current;
    const stage = stageRef.current;
    const canvas = canvasRef.current;
    if (!section || !stage || !canvas) return;

    const ctx = canvas.getContext("2d", { alpha: false });
    if (!ctx) return;

    const prefersReducedMotion = window.matchMedia(
      "(prefers-reduced-motion: reduce)"
    ).matches;
    const isMobile = window.matchMedia(
      `(max-width: ${MOBILE_BREAKPOINT}px)`
    ).matches;

    // Which frames do we actually load?
    let frameList: string[];
    if (prefersReducedMotion) {
      frameList = [ALL_FRAMES[0], ALL_FRAMES[ALL_FRAMES.length - 1]];
    } else if (isMobile && MOBILE_FRAME_STEP > 1) {
      frameList = ALL_FRAMES.filter((_, i) => i % MOBILE_FRAME_STEP === 0);
      if (frameList[frameList.length - 1] !== ALL_FRAMES[ALL_FRAMES.length - 1]) {
        frameList.push(ALL_FRAMES[ALL_FRAMES.length - 1]);
      }
    } else {
      frameList = ALL_FRAMES;
    }

    const frameCount = frameList.length;
    const images: HTMLImageElement[] = new Array(frameCount);
    const state = { frame: 0 };
    const triggers: ScrollTriggerInstance[] = [];
    let disposed = false;

    const sizeCanvas = () => {
      const dpr = Math.min(window.devicePixelRatio || 1, 2);
      // Measure the canvas's OWN box (the visual frame), not the outer pin
      // container — otherwise the backing store takes the full-height stage size
      // and the frame gets squashed into the smaller box.
      const w = canvas.clientWidth || stage.clientWidth;
      const h = canvas.clientHeight || stage.clientHeight;
      canvas.width = Math.round(w * dpr);
      canvas.height = Math.round(h * dpr);
      // setting width/height resets the 2D context state, re-apply smoothing
      ctx.imageSmoothingEnabled = true;
      ctx.imageSmoothingQuality = "high";
    };

    const drawFrame = (index: number) => {
      const img = images[index];
      if (!img || !img.complete) return;
      const cw = canvas.width;
      const ch = canvas.height;
      const scale = Math.max(cw / FRAME_W, ch / FRAME_H); // cover
      const dw = FRAME_W * scale;
      const dh = FRAME_H * scale;
      const dx = (cw - dw) / 2;
      const dy = (ch - dh) / 2;
      ctx.fillStyle = "#05060a";
      ctx.fillRect(0, 0, cw, ch);
      ctx.drawImage(img, dx, dy, dw, dh);
    };

    // Only redraw when the *integer* frame changes. scrub:1 fires onUpdate many
    // times per frame-step as it eases toward the scroll target; without this
    // guard each one repaints a 720p webp at "high" smoothing and the sequence
    // stutters as wheel momentum decays. Dedup => one draw per visible frame.
    let lastDrawn = -1;
    const render = () => {
      const idx = Math.round(state.frame);
      if (idx === lastDrawn) return;
      lastDrawn = idx;
      drawFrame(idx);
    };

    const onResize = () => {
      sizeCanvas();
      lastDrawn = -1; // canvas was cleared by the resize — force a repaint
      render();
      ScrollTrigger.refresh();
    };

    const showFirstAndLastReducedMotion = () => {
      // No pin, no scrub. First frame, swap to last past halfway.
      if (headlineRef.current) headlineRef.current.style.opacity = "1";
      section.style.minHeight = "180vh";
      const update = () => {
        const rect = section.getBoundingClientRect();
        const denom = rect.height - window.innerHeight;
        const progress = denom > 0 ? -rect.top / denom : 0;
        state.frame = progress >= 0.5 ? frameCount - 1 : 0;
        render();
      };
      update();
      window.addEventListener("scroll", update, { passive: true });
      cleanupFns.push(() => window.removeEventListener("scroll", update));
    };

    const initScrub = () => {
      const distance =
        frameCount * (isMobile ? SCROLL_PER_FRAME * 1.4 : SCROLL_PER_FRAME);

      const t1 = gsap.to(state, {
        frame: frameCount - 1,
        ease: "none",
        onUpdate: render,
        scrollTrigger: {
          trigger: section,
          start: "top top",
          end: "+=" + distance,
          pin: stage,
          scrub: 1,
          anticipatePin: 1,
          invalidateOnRefresh: true,
        },
      });
      if (t1.scrollTrigger) triggers.push(t1.scrollTrigger);

      // Headline overlay: one scrubbed timeline across the whole pinned range so
      // the fade timing is reliable (relative-start ScrollTriggers didn't fire).
      // Durations are proportions of the scroll range: in early, out fast, then
      // stay gone for the rest of the sequence.
      const tl = gsap.timeline({
        scrollTrigger: {
          trigger: section,
          start: "top top",
          end: "+=" + distance,
          scrub: true,
        },
      });
      tl.fromTo(
        headlineRef.current,
        { opacity: 0, y: 24 },
        { opacity: 1, y: 0, ease: "power2.out", duration: 0.1 }
      )
        .to(headlineRef.current, { duration: 0.06 }) // brief hold
        .to(headlineRef.current, {
          opacity: 0,
          y: -24,
          ease: "power2.in",
          duration: 0.08,
        })
        .to(headlineRef.current, { duration: 0.76 }); // stay gone for the rest
      if (tl.scrollTrigger) triggers.push(tl.scrollTrigger);
    };

    const cleanupFns: Array<() => void> = [];

    const init = () => {
      if (disposed) return;
      sizeCanvas();
      render();
      loaderRef.current?.classList.add("is-hidden");
      window.addEventListener("resize", onResize);
      cleanupFns.push(() => window.removeEventListener("resize", onResize));
      if (prefersReducedMotion) showFirstAndLastReducedMotion();
      else initScrub();
    };

    // preload AND fully decode every frame before we start. Decoding up front
    // means the first paint of each frame during scroll has no main-thread
    // decode hitch — that on-demand decode was the remaining source of stutter.
    let loaded = 0;
    const done = () => {
      loaded++;
      const pct = Math.round((loaded / frameCount) * 100);
      if (fillRef.current) fillRef.current.style.width = pct + "%";
      if (pctRef.current) pctRef.current.textContent = pct + "%";
      if (loaded >= frameCount) init();
    };
    frameList.forEach((name, i) => {
      const img = new Image();
      img.decoding = "async";
      images[i] = img;
      let counted = false;
      const finish = () => {
        if (counted) return;
        counted = true;
        done();
      };
      img.onerror = finish; // don't let one bad frame stall the loader
      img.src = FRAMES_DIR + name;
      if (typeof img.decode === "function") {
        img.decode().then(finish).catch(finish);
      } else {
        img.onload = finish;
      }
    });

    return () => {
      disposed = true;
      triggers.forEach((t) => t.kill());
      cleanupFns.forEach((fn) => fn());
    };
  }, []);

  return (
    <section
      ref={sectionRef}
      style={{
        position: "relative",
        width: "100%",
        background: "#05060a",
      }}
    >
      {/* pinned stage — centred, contained (keeps 720p source crisp) */}
      <div
        ref={stageRef}
        style={{
          position: "relative",
          width: "100%",
          height: "100svh",
          display: "flex",
          alignItems: "center",
          justifyContent: "center",
          overflow: "hidden",
          background: "#05060a",
        }}
      >
        {/* the actual visual box. Desktop: contained 16:9 (keeps 720p source
            crisp). Mobile: fills the screen (cover) so it isn't a tiny strip. */}
        <div className="scrollseq-box">
          <canvas
            ref={canvasRef}
            style={{
              position: "absolute",
              inset: 0,
              width: "100%",
              height: "100%",
              display: "block",
            }}
          />
          {/* headline fades in over the top of the sequence */}
          <div
            ref={headlineRef}
            style={{
              position: "absolute",
              inset: 0,
              zIndex: 2,
              display: "flex",
              flexDirection: "column",
              alignItems: "center",
              justifyContent: "center",
              textAlign: "center",
              padding: "0 6%",
              pointerEvents: "none",
              opacity: 0,
              color: "#f5f7fa",
            }}
          >
            <h2
              style={{
                margin: 0,
                fontWeight: 700,
                letterSpacing: "-0.02em",
                lineHeight: 1.03,
                fontSize: "clamp(1.8rem, 5vw, 4rem)",
                textShadow: "0 2px 40px rgba(0,0,0,0.55)",
              }}
            >
              {headline}
            </h2>
            {subhead ? (
              <p
                style={{
                  margin: "0.8rem 0 0",
                  fontSize: "clamp(0.95rem, 2vw, 1.35rem)",
                  opacity: 0.85,
                  textShadow: "0 1px 24px rgba(0,0,0,0.55)",
                }}
              >
                {subhead}
              </p>
            ) : null}
          </div>
        </div>

        {/* loading overlay — shown until every frame is decoded */}
        <div
          ref={loaderRef}
          role="status"
          aria-live="polite"
          aria-label="Loading animation frames"
          style={{
            position: "absolute",
            inset: 0,
            zIndex: 5,
            display: "flex",
            flexDirection: "column",
            alignItems: "center",
            justifyContent: "center",
            gap: "1.1rem",
            background: "#05060a",
            transition: "opacity 0.6s ease",
          }}
          className="scrollseq-loader"
        >
          <div
            style={{
              width: "min(280px, 60vw)",
              height: 3,
              borderRadius: 3,
              background: "rgba(255,255,255,0.14)",
              overflow: "hidden",
            }}
          >
            <div
              ref={fillRef}
              style={{
                height: "100%",
                width: "0%",
                background: "#f5f7fa",
                transition: "width 0.2s ease",
              }}
            />
          </div>
          <div
            ref={pctRef}
            style={{
              fontVariantNumeric: "tabular-nums",
              fontSize: "0.85rem",
              opacity: 0.7,
              letterSpacing: "0.04em",
              color: "#f5f7fa",
            }}
          >
            0%
          </div>
        </div>
      </div>

      <style>{`
        .scrollseq-loader.is-hidden { opacity: 0; pointer-events: none; }
        .scrollseq-box {
          position: relative;
          width: min(92vw, 1000px);
          aspect-ratio: 16 / 9;
          max-height: 82svh;
          border-radius: 20px;
          overflow: hidden;
          box-shadow: 0 30px 80px rgba(0,0,0,0.55);
        }
        @media (max-width: 700px) {
          /* fill the screen on phones instead of a short letterboxed strip */
          .scrollseq-box {
            width: 100%;
            height: 100%;
            max-height: none;
            aspect-ratio: auto;
            border-radius: 0;
            box-shadow: none;
          }
        }
      `}</style>
    </section>
  );
}
