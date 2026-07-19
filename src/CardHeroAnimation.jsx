import { motion } from "framer-motion";
import { useEffect, useRef, useState } from "react";

const DARK_IMGS = {
  pink:   "/cards/dark-anim-pink.png",
  blue:   "/cards/dark-anim-blue.png",
  green:  "/cards/dark-anim-green.png",
  violet: "/cards/dark-anim-violet.png",
  white:  "/cards/dark-anim-white.png",
};

// Desktop canvas: 1440×960
const DESKTOP_CARDS = [
  { id:"pink",   stack:{ x:563, y:290, r:-9  }, fan:{ x:374, y:506, r:-84 } },
  { id:"blue",   stack:{ x:569, y:292, r:-7  }, fan:{ x:394, y:417, r:-64 } },
  { id:"green",  stack:{ x:584, y:295, r:-5  }, fan:{ x:454, y:303, r:-44 } },
  { id:"violet", stack:{ x:598, y:298, r:-3  }, fan:{ x:549, y:226, r:-22 } },
  { id:"white",  stack:{ x:612, y:304, r:0   }, fan:{ x:663, y:180, r:0   } },
];

// Mobile canvas: 340×300 — cards sized/positioned so the rotated bounding boxes
// (incl. the -84°..0° fan spread) clear both canvas edges with margin to spare
const MOBILE_CARDS = [
  { id:"pink",   stack:{ x:143, y:157, r:-9  }, fan:{ x:55,  y:99,  r:-84 } },
  { id:"blue",   stack:{ x:151, y:159, r:-7  }, fan:{ x:76,  y:65,  r:-64 } },
  { id:"green",  stack:{ x:157, y:161, r:-5  }, fan:{ x:110, y:36,  r:-44 } },
  { id:"violet", stack:{ x:163, y:163, r:-3  }, fan:{ x:153, y:19,  r:-22 } },
  { id:"white",  stack:{ x:169, y:165, r:0   }, fan:{ x:195, y:13,  r:0   } },
];

const CARD_SHADOW = "inset 1px 1px 2px 2px rgba(0,0,0,0.25)";
const CARD_BORDER = "1px solid rgba(255,255,255,0.4)";
const CARD_DROP   = "-20px 10px 8px 5px rgba(0,0,0,0.21)";

export default function CardHeroAnimation({ dark = false, scale = 0.38 }) {
  const containerRef = useRef(null);
  const BG = dark ? "#000" : "#fefefe";

  // Numeric desktop scale. The previous CSS-only version —
  // scale(calc(min(100vw/1440, 100vh/960) * 0.38)) — is invalid CSS (scale()
  // needs a number, the calc yields a length), so the transform was silently
  // dropped and the cards rendered unscaled. Compute the number in JS instead.
  const [vp, setVp] = useState({ w: window.innerWidth, h: window.innerHeight });
  useEffect(() => {
    const onResize = () => setVp({ w: window.innerWidth, h: window.innerHeight });
    window.addEventListener("resize", onResize);
    return () => window.removeEventListener("resize", onResize);
  }, []);
  const desktopScale = Math.min(vp.w / 1440, vp.h / 960) * scale;

  return (
    <div ref={containerRef} style={{ position:"absolute", inset:0 }}>
      {/* Background — desktop only */}
      <div className="anim-desktop" style={{ position:"absolute", inset:0, background:BG }} />

      {/* ── DESKTOP canvas (hidden on mobile) ── */}
      <div style={{
        position:"absolute",
        width:1440, height:960,
        top:"50%", left:"50%",
        marginLeft:-720, marginTop:-480,
        transform:`scale(${desktopScale})`,
        transformOrigin:"center center",
        filter:"drop-shadow(-40px 75px 50px rgba(0,0,0,0.49))",
        display:"var(--desktop-show, block)",
      }} className="anim-desktop">
        {DESKTOP_CARDS.map((card, i) => (
          <motion.div key={card.id+"d"} style={{ position:"absolute", width:214, height:326, left:0, top:0, zIndex:i+1, borderRadius:20, overflow:"hidden" }}
            animate={{ x:[card.stack.x,card.fan.x], y:[card.stack.y,card.fan.y], rotate:[card.stack.r,card.fan.r] }}
            transition={{ duration:1.8, times:[0,1], repeat:0, ease:"easeInOut", delay:i*0.04 }}>
            <img src={DARK_IMGS[card.id]} alt={card.id} style={{ width:"100%", height:"100%", display:"block", objectFit:"cover", borderRadius:20 }} />
            <div style={{ position:"absolute", inset:0, borderRadius:20, boxShadow:CARD_SHADOW, pointerEvents:"none" }} />
            <div style={{ position:"absolute", inset:0, borderRadius:20, border:CARD_BORDER, boxShadow:CARD_DROP, pointerEvents:"none" }} />
          </motion.div>
        ))}
      </div>

      {/* ── MOBILE canvas (hidden on desktop) ── */}
      <div style={{
        position:"absolute",
        width:340, height:300,
        top:"50%", left:"50%",
        marginLeft:-170, marginTop:-150,
        transform:"scale(min(calc(100vw / 340), calc(100vh / 300)))",
        transformOrigin:"center center",
        filter:"drop-shadow(-20px 40px 30px rgba(0,0,0,0.35))",
        display:"var(--mobile-show, none)",
      }} className="anim-mobile">
        {MOBILE_CARDS.map((card, i) => (
          <motion.div key={card.id+"m"} style={{ position:"absolute", width:130, height:198, left:0, top:0, zIndex:i+1, borderRadius:10, overflow:"hidden" }}
            animate={{ x:[card.stack.x,card.fan.x], y:[card.stack.y,card.fan.y], rotate:[card.stack.r,card.fan.r] }}
            transition={{ duration:1.8, times:[0,1], repeat:0, ease:"easeInOut", delay:i*0.04 }}>
            <img src={DARK_IMGS[card.id]} alt={card.id} style={{ width:"100%", height:"100%", display:"block", objectFit:"cover", borderRadius:10 }} />
            <div style={{ position:"absolute", inset:0, borderRadius:10, boxShadow:CARD_SHADOW, pointerEvents:"none" }} />
            <div style={{ position:"absolute", inset:0, borderRadius:10, border:CARD_BORDER, boxShadow:CARD_DROP, pointerEvents:"none" }} />
          </motion.div>
        ))}
      </div>

      <style>{`
        @media(max-width:767px){
          .anim-desktop{display:none!important;}
          .anim-mobile{display:block!important;}
        }
        @media(min-width:768px){
          .anim-desktop{display:block!important;}
          .anim-mobile{display:none!important;}
        }
      `}</style>
    </div>
  );
}