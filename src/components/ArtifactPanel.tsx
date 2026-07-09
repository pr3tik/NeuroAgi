// ArtifactPanel.jsx — Full-screen panel that executes and renders Claude's React artifact code.
// Uses a sandboxed iframe with Babel standalone + React/Recharts from CDN.
// The artifact code runs fully isolated from the host app.

import { useEffect, useRef, useState } from "react";
import { createPortal } from "react-dom";
import { Check } from "lucide-react";

// Escape any </script> inside component code so it doesn't break the HTML parser
function escapeScriptTag(code) {
  return code.replace(/<\/script>/gi, "<\\/script>");
}

// Claude often writes ESM import/export statements in its artifacts.
// Strip them — React, Recharts, etc. are already available as globals in the iframe.
// The typescript Babel preset handles any remaining TS syntax (interfaces, type annotations).
function stripModuleSyntax(code) {
  return code
    // Remove: import Something from 'somewhere'  (single and multi-line)
    .replace(/^import\b[\s\S]*?from\s*['"][^'"]*['"];?[ \t]*\n?/gm, '')
    // Remove: import 'side-effect'
    .replace(/^import\s+['"][^'"]*['"];?[ \t]*\n?/gm, '')
    // Remove: export { Foo, Bar }
    .replace(/^export\s*\{[^}]*\};?[ \t]*\n?/gm, '')
    // Remove export keyword from declarations
    .replace(/\bexport\s+default\s+/g, '')
    .replace(/\bexport\s+(function|const|let|var|class|async)\b/g, '$1')
    // Remove React.FC / React.ReactNode type references that slip through
    .replace(/:\s*React\.(FC|ReactNode|ReactElement|CSSProperties|Dispatch|SetStateAction)[^,);]*/g, '')
    .trim();
}

function buildHtml(componentCode) {
  // Store Claude's code as plain text — browser won't try to parse it as JS.
  // We manually Babel.transform() it at runtime so any syntax error in Claude's
  // code is isolated and caught, never corrupting our helper scripts.
  const clean = stripModuleSyntax(componentCode);

  return `<!DOCTYPE html>
<html lang="en">
<head>
<meta charset="UTF-8">
<meta name="viewport" content="width=device-width, initial-scale=1.0">
<script src="https://unpkg.com/react@18.3.1/umd/react.production.min.js" crossorigin="anonymous" onerror="showCdnErr('React')"><\/script>
<script src="https://unpkg.com/react-dom@18.3.1/umd/react-dom.production.min.js" crossorigin="anonymous" onerror="showCdnErr('ReactDOM')"><\/script>
<script src="https://unpkg.com/prop-types@15.8.1/prop-types.min.js" crossorigin="anonymous"><\/script>
<script src="https://unpkg.com/recharts@2.8.0/umd/Recharts.js" crossorigin="anonymous" onerror="showCdnErr('Recharts')"><\/script>
<script src="https://unpkg.com/@babel/standalone@7.23.10/babel.min.js" crossorigin="anonymous" onerror="showCdnErr('Babel')"><\/script>
<style>
  *, *::before, *::after { box-sizing: border-box; margin: 0; padding: 0; }
  html, body { height: 100%; background: #111111; color: rgba(255,255,255,0.9); }
  body { font-family: -apple-system, BlinkMacSystemFont, 'Helvetica Neue', sans-serif; padding: 20px; overflow: auto; min-height: 100vh; }
  #root { width: 100%; min-height: calc(100vh - 40px); }
  .err { background: rgba(255,59,48,0.1); border: 1px solid rgba(255,59,48,0.3); border-radius: 10px; padding: 18px 20px; color: rgba(255,100,90,0.9); font-family: monospace; font-size: 12px; line-height: 1.7; white-space: pre-wrap; margin-top: 16px; }
  ::-webkit-scrollbar { width: 4px; } ::-webkit-scrollbar-thumb { background: rgba(255,255,255,0.15); border-radius: 2px; }
<\/style>
</head>
<body>
<div id="root"></div>

<!-- Helpers in plain JS — completely separate from Claude's code -->
<script>
function showErr(msg, detail) {
  document.getElementById('root').innerHTML =
    '<div class="err">' + msg + (detail ? '\\n\\n' + detail : '') + '<\/div>';
}
function showCdnErr(lib) {
  showErr(lib + ' failed to load from CDN — check network connection');
}
window.onerror = function(msg, src, line, col, err) {
  if (msg === 'Script error.') return false;
  showErr('Uncaught: ' + msg, err && err.stack);
  return true;
};
<\/script>

<!-- Claude's raw code stored as plain text — browser does NOT parse this as JS -->
<script id="artifact" type="text/plain">${escapeScriptTag(clean)}<\/script>

<!-- Bootstrap: manually compile + run after all CDN scripts have loaded -->
<script>
window.addEventListener('load', function () {
  if (typeof Babel    === 'undefined') return showErr('Babel did not load');
  if (typeof Recharts === 'undefined') return showErr('Recharts did not load');

  // Globals Claude's component can use (injected before its code)
  var globals = [
    'const{useState,useEffect,useCallback,useMemo,useRef,useReducer,useContext,createContext,Fragment}=React;',
    'const{ResponsiveContainer,LineChart,Line,BarChart,Bar,PieChart,Pie,AreaChart,Area,RadarChart,Radar,ScatterChart,Scatter,ComposedChart,Cell,XAxis,YAxis,ZAxis,CartesianGrid,Tooltip,Legend,PolarGrid,PolarAngleAxis,PolarRadiusAxis,ReferenceLine,ReferenceArea,Brush,LabelList}=Recharts;',
  ].join('\\n');

  var src = document.getElementById('artifact').textContent;

  try {
    // Babel.transform compiles JSX → plain JS; any syntax error is caught here
    var compiled = Babel.transform(
      globals + '\\n' + src + '\\nReactDOM.createRoot(document.getElementById("root")).render(React.createElement(App));',
      { presets: ['react', 'typescript'], filename: 'artifact.tsx' }
    ).code;

    // new Function runs the compiled code in global scope (React/Recharts are on window)
    // eslint-disable-next-line no-new-func
    new Function(compiled)();
  } catch (err) {
    showErr('Component error: ' + err.message, err.stack);
  }
});
<\/script>
</body>
</html>`;
}

const PANEL_HEADERS = {
  quiz: "Quiz", flashcard: "Flashcards", plan: "Study Plan",
  diagram: "Diagram", dashboard: "Dashboard", chart: "Chart",
  game: "Game", timer: "Tool", tracker: "Tracker",
  calculator: "Calculator", viz: "Visualization",
};

export default function ArtifactPanel({ code, type = "viz", onClose }) {
  const [loaded, setLoaded] = useState(false);
  const [copied, setCopied] = useState(false);

  const [visible, setVisible] = useState(false);
  useEffect(() => {
    const id = requestAnimationFrame(() => setVisible(true));
    return () => cancelAnimationFrame(id);
  }, []);

  const handleClose = () => {
    setVisible(false);
    setTimeout(onClose, 240);
  };

  const handleCopy = () => {
    navigator.clipboard?.writeText(code).then(() => {
      setCopied(true);
      setTimeout(() => setCopied(false), 2000);
    });
  };

  return createPortal(
    <>
      {/* Backdrop */}
      <div
        onClick={handleClose}
        style={{
          position: "fixed", inset: 0, zIndex: 10000,
          background: "rgba(0,0,0,0.55)",
          backdropFilter: "blur(4px)",
          WebkitBackdropFilter: "blur(4px)",
          opacity: visible ? 1 : 0,
          transition: "opacity 0.24s ease",
        }}
      />

      {/* Panel */}
      <div
        style={{
          position: "fixed", bottom: 0, left: 0, right: 0,
          height: "88vh",
          background: "#111111",
          borderRadius: "20px 20px 0 0",
          border: "1px solid rgba(255,255,255,0.1)",
          borderBottom: "none",
          display: "flex", flexDirection: "column",
          zIndex: 10001,
          boxShadow: "0 -16px 64px rgba(0,0,0,0.7)",
          transform: visible ? "translateY(0)" : "translateY(100%)",
          transition: "transform 0.28s cubic-bezier(0.32,0.72,0,1)",
          fontFamily: "var(--font-sans)",
        }}
      >
        {/* Header */}
        <div style={{
          display: "flex", alignItems: "center", justifyContent: "space-between",
          padding: "16px 18px 14px",
          borderBottom: "1px solid rgba(255,255,255,0.07)",
          flexShrink: 0,
        }}>
          <div style={{ display: "flex", alignItems: "center", gap: "10px" }}>
            <div style={{
              width: 8, height: 8, borderRadius: "50%",
              background: "#C49A3C",
              boxShadow: "0 0 8px rgba(196,154,60,0.5)",
            }} />
            <span style={{ color: "var(--text-primary)", fontSize: "14px", fontWeight: "600" }}>
              {PANEL_HEADERS[type] ?? "Visualization"}
            </span>
            <span style={{ color: "rgba(255,255,255,0.3)", fontSize: "11px" }}>
              Claude Artifact
            </span>
          </div>
          <div style={{ display: "flex", gap: "8px" }}>
            <button
              onClick={handleCopy}
              style={{
                background: copied ? "rgba(52,199,89,0.12)" : "rgba(255,255,255,0.06)",
                border: copied ? "1px solid rgba(52,199,89,0.3)" : "1px solid rgba(255,255,255,0.1)",
                borderRadius: "8px",
                padding: "5px 12px",
                color: copied ? "rgba(52,199,89,0.9)" : "rgba(255,255,255,0.5)",
                fontSize: "12px",
                cursor: "pointer",
                fontFamily: "inherit",
                transition: "all 0.2s",
              }}
            >
              {copied ? <span style={{ display:"inline-flex", alignItems:"center", gap:5 }}>Copied<Check size={13} /></span> : "Copy Code"}
            </button>
            <button
              onClick={handleClose}
              style={{
                background: "rgba(255,255,255,0.07)",
                border: "1px solid rgba(255,255,255,0.1)",
                borderRadius: "8px",
                padding: "5px 12px",
                color: "rgba(255,255,255,0.6)",
                fontSize: "13px",
                cursor: "pointer",
                fontFamily: "inherit",
              }}
            >
              Close
            </button>
          </div>
        </div>

        {/* Loading overlay */}
        {!loaded && (
          <div style={{
            position: "absolute", inset: "57px 0 0 0",
            display: "flex", alignItems: "center", justifyContent: "center",
            background: "#111111", zIndex: 1,
          }}>
            <p style={{ color: "rgba(255,255,255,0.25)", fontSize: "13px", letterSpacing: "0.5px" }}>
              Loading chart…
            </p>
          </div>
        )}

        {/* iframe — always shown, never hidden behind a code view */}
        <iframe
          key={code}
          srcDoc={buildHtml(code)}
          sandbox="allow-scripts"
          onLoad={() => setLoaded(true)}
          style={{
            flex: 1,
            border: "none",
            background: "#111111",
            opacity: loaded ? 1 : 0,
            transition: "opacity 0.2s",
          }}
          title="Claude Visualization"
        />
      </div>
    </>,
    document.body
  );
}
