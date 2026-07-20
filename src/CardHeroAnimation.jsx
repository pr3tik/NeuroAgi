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

// Mobile canvas: 440×400 — larger cards for phone hero presence
const MOBILE_W = 440;
const MOBILE_H = 400;
const MOBILE_CARD_W = 172;
const MOBILE_CARD_H = 262;
const MOBILE_CARDS = [
  { id:"pink",   stack:{ x:180, y:210, r:-9  }, fan:{ x:58,  y:128, r:-84 } },
  { id:"blue",   stack:{ x:192, y:212, r:-7  }, fan:{ x:88,  y:84,  r:-64 } },
  { id:"green",  stack:{ x:200, y:216, r:-5  }, fan:{ x:134, y:46,  r:-44 } },
  { id:"violet", stack:{ x:208, y:218, r:-3  }, fan:{ x:190, y:22,  r:-22 } },
  { id:"white",  stack:{ x:216, y:222, r:0   }, fan:{ x:248, y:14,  r:0   } },
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
  // Bigger on phones: fill most of the width, up to ~58% of viewport height
  const mobileScale = Math.min(vp.w / 300, (vp.h * 0.58) / MOBILE_H);

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
        width:MOBILE_W, height:MOBILE_H,
        top:"50%", left:"50%",
        marginLeft:-MOBILE_W / 2, marginTop:-MOBILE_H / 2,
        transform:`scale(${mobileScale})`,
        transformOrigin:"center center",
        filter:"drop-shadow(-20px 40px 30px rgba(0,0,0,0.35))",
        display:"var(--mobile-show, none)",
      }} className="anim-mobile">
        {MOBILE_CARDS.map((card, i) => (
          <motion.div key={card.id+"m"} style={{ position:"absolute", width:MOBILE_CARD_W, height:MOBILE_CARD_H, left:0, top:0, zIndex:i+1, borderRadius:14, overflow:"hidden" }}
            animate={{ x:[card.stack.x,card.fan.x], y:[card.stack.y,card.fan.y], rotate:[card.stack.r,card.fan.r] }}
            transition={{ duration:1.8, times:[0,1], repeat:0, ease:"easeInOut", delay:i*0.04 }}>
            <img src={DARK_IMGS[card.id]} alt={card.id} style={{ width:"100%", height:"100%", display:"block", objectFit:"cover", borderRadius:14 }} />
            <div style={{ position:"absolute", inset:0, borderRadius:14, boxShadow:CARD_SHADOW, pointerEvents:"none" }} />
            <div style={{ position:"absolute", inset:0, borderRadius:14, border:CARD_BORDER, boxShadow:CARD_DROP, pointerEvents:"none" }} />
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