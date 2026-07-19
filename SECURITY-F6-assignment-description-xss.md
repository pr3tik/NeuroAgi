# F-6 · Stored XSS via unsanitized Canvas assignment description · **P2**

**Found:** 2026-07-18 (solo session investigation). **Owner:** Vivek. **Status:** OPEN — confirmed,
NOT auto-fixed (the fix adds a dependency + changes render output, so it needs your review).

### F-6 · `Assignment.tsx` renders an assignment description as raw HTML · **P2**

`src/components/Assignment.tsx:263` injects the assignment description straight into the DOM as HTML,
with no sanitization:

```tsx
// :92
const selectedPrompt = selected ? (selected.description || selected.prompt || "") : "";
// :263
<div ... dangerouslySetInnerHTML={{ __html: selectedPrompt }} />
```

`selected.description` is the **Canvas assignment description** — arbitrary professor-authored HTML
pulled from the LMS. Canvas allows rich HTML in descriptions, so this string can contain **anything**.

**Why it matters.** `dangerouslySetInnerHTML` does not run inserted `<script>` tags, but it *does*
execute HTML that carries JS through other vectors — `<img src=x onerror=…>`, `<svg onload=…>`,
`<iframe>`, `<a href="javascript:…">`, inline `on*` handlers. A crafted or compromised assignment
description therefore runs attacker JS in the browser of **every enrolled student who opens that
assignment** — a **stored XSS** with a course-wide blast radius.

Once JS runs in the page, it can read anything in the page context. **This compounds F-4**: the Canvas
access token currently lives in client state (`AppContext` → `canvasToken`), so an F-6 payload can
**exfiltrate the F-4 token**, plus the Supabase session, and act as the user. F-6 + F-4 together turn
"a professor's course was tampered with" into "every student's Canvas is compromised."

**Severity — P2.** It requires malicious/compromised course content (not arbitrary anonymous input),
which lowers likelihood — but it is a genuine stored-XSS with a broad blast radius and a direct path
to credential theft. Fix before public launch.

**Scope check (other `dangerouslySetInnerHTML` in the app).** The chat-render sites
(`NeuralRing`, `StudyAssistant`, `PreSignupDemo`) go through `renderMessageHTML()`
(`src/lib/markdown.ts`), which **escapes** `& < >` first — those are safe. `Assignment.tsx:263` is the
one that renders **untrusted HTML raw**. (Re-grep `dangerouslySetInnerHTML|innerHTML` before sign-off
to confirm no others slipped in.)

**Fix — sanitize before rendering (preserve safe formatting, strip scripts/handlers).**
The description is *meant* to have formatting (bold, lists, links), so a full escape (`renderMessageHTML`)
would break it — this needs a real **HTML sanitizer**, which the project does **not** currently have
(no DOMPurify / sanitize-html in `package.json`).

1. **Preferred:** add `dompurify` (or `isomorphic-dompurify`) and sanitize with a safe allowlist:
   ```tsx
   import DOMPurify from "dompurify";
   // ...
   dangerouslySetInnerHTML={{ __html: DOMPurify.sanitize(selectedPrompt, {
     ALLOWED_TAGS: ["p","br","b","strong","i","em","u","ul","ol","li","a","h1","h2","h3","h4","blockquote","code","pre","span","div"],
     ALLOWED_ATTR: ["href","target","rel"],
   }) }}
   ```
   (Force `rel="noopener noreferrer"` on links; drop `javascript:` URLs — DOMPurify does this by default.)
2. **Dependency-free alternative** (weaker, more fragile): a minimal pass that removes `<script>`,
   all `on*` attributes, and `javascript:`/`data:` URLs. Only if adding a dep is off the table —
   allowlist sanitizers are much safer than blocklists.

**Verification.** After the fix, an assignment whose `description` is
`<img src=x onerror="alert(document.cookie)"> <b>Real instructions</b>` must render "**Real
instructions**" (bold kept) with the `<img>`/handler stripped and **no alert firing**. Confirm normal
descriptions (headings, lists, links) still render correctly.

**Why not auto-fixed here:** the fix adds a runtime dependency and changes what renders on a live
screen — that belongs in your review, not an unattended change. Code + exact sanitize config are above,
ready to drop in.

## Related
- **F-4** (Canvas token on client) — F-6 is the *delivery vector* that makes F-4's client-side token
  directly stealable. Fixing either reduces the combined risk; fixing both closes it.
