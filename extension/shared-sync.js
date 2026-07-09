// shared-sync.js — functions shared by the popup AND the background worker.
// Loaded via <script> in popup.html and via importScripts() in background.js.
// Both functions are SELF-CONTAINED so they can be serialized and injected into a
// page's MAIN world with chrome.scripting.executeScript({ func }).

// Injected into the page's MAIN world — talks to the LMS's own API using the
// student's existing login session (cookies). Returns normalized courses +
// assignments + grades, or { lms: null } if no supported API → caller scrapes.
// Must be fully self-contained (no outside references — it is serialized + injected).
async function lmsApiSync() {
  const origin = location.origin;
  const D = (...a) => { try { console.log("[NeuroAgi]", ...a); } catch {} };
  const getJSON = async (url, opts = {}) => {
    const r = await fetch(url, {
      credentials: opts.credentials || "same-origin",
      headers: { Accept: "application/json", ...(opts.headers || {}) },
      method: opts.method || "GET",
      body: opts.body,
    });
    if (!r.ok) throw new Error(url + " -> " + r.status);
    return { r, data: await r.json() };
  };

  // File helpers (shared by every LMS block below). Both are pure so they stay
  // valid after this function is serialized + injected into the page.
  const fileType = (name, mime) => {
    const n = String(name || "");
    const ext = n.includes(".") ? n.split(".").pop().toLowerCase() : "";
    if (ext && ext.length <= 5 && /^[a-z0-9]+$/.test(ext)) return ext;
    if (mime) { const m = String(mime).split("/").pop(); if (m) return m.toLowerCase(); }
    return "file";
  };
  // Short, stable, collision-resistant id from a long key (e.g. a file url).
  const hashId = (prefix, k) => {
    let h = 0; const s = String(k);
    for (let i = 0; i < s.length; i++) h = (Math.imul(h, 31) + s.charCodeAt(i)) | 0;
    return prefix + (h >>> 0).toString(36);
  };

  // ── CANVAS ──────────────────────────────────────────────────────────────
  try {
    if (window.ENV && window.ENV.current_user_id) {
      const pageAll = async (path) => {
        let url = origin + "/api/v1" + path + (path.includes("?") ? "&" : "?") + "per_page=100";
        const out = [];
        for (let i = 0; i < 25 && url; i++) {
          const { r, data } = await getJSON(url);
          if (Array.isArray(data)) out.push(...data); else break;
          const m = (r.headers.get("Link") || "").match(/<([^>]+)>;\s*rel="next"/);
          url = m ? m[1] : null;
        }
        return out;
      };
      let rawCourses = await pageAll("/courses?enrollment_state=active&enrollment_type=student&include[]=total_scores");
      if (!rawCourses.length) rawCourses = await pageAll("/courses?include[]=total_scores");
      const courses = rawCourses
        .filter(c => c.name && !c.access_restricted_by_date)
        .map(c => {
          const es = Array.isArray(c.enrollments) ? c.enrollments : [];
          const e = es.find(x => x.type === "student" || x.role === "StudentEnrollment") || es[0] || null;
          return { id: String(c.id), name: c.name || "", course_code: c.course_code || "",
                   current_score: e?.computed_current_score ?? null, final_score: e?.computed_final_score ?? null };
        });
      const assignments = [];
      const files = [];
      await Promise.all(courses.map(async (c) => {
        try {
          const raw = await pageAll(`/courses/${c.id}/assignments?include[]=submission`);
          for (const a of raw) {
            const s = a.submission || {};
            assignments.push({ course_ref: c.id, id: String(a.id), title: a.name || "Assignment",
              due_at: a.due_at || null, points_possible: a.points_possible ?? null,
              score: s.score ?? null, submitted_at: s.submitted_at || null,
              // Assignment instructions (Canvas returns HTML) — strip tags, cap length.
              // Lets the tutor answer "what does this assignment actually ask for?".
              description: a.description ? String(a.description).replace(/<[^>]+>/g, " ").replace(/\s+/g, " ").trim().slice(0, 4000) : null,
              missing: Boolean(s.missing) || s.workflow_state === "unsubmitted" });
            // Submitted attachments → files tagged to this assignment.
            for (const at of (s.attachments || [])) {
              files.push({ course_ref: c.id, assignment_ref: String(a.id),
                id: "canvas_subfile_" + at.id, name: at.display_name || at.filename || ("file_" + at.id),
                file_type: fileType(at.display_name || at.filename, at["content-type"]),
                size_bytes: at.size ?? null, source_url: at.url || null,
                folder: a.name || null, status: "submitted" });
            }
          }
        } catch { /* skip course */ }
        // Course materials (Files tab) — may be disabled per course (403).
        try {
          for (const f of await pageAll(`/courses/${c.id}/files`)) {
            files.push({ course_ref: c.id, assignment_ref: null,
              id: "canvas_file_" + f.id, name: f.display_name || f.filename || ("file_" + f.id),
              file_type: fileType(f.display_name || f.filename, f["content-type"]),
              size_bytes: f.size ?? null, source_url: f.url || null,
              folder: null, status: "course_material" });
          }
        } catch { /* files tab disabled for this course */ }
      }));
      D("Canvas synced — courses", courses.length, "| assignments", assignments.length, "| files", files.length, "| graded courses", courses.filter(c => c.current_score != null).length);
      return { lms: "canvas", courses, assignments, files };
    }
  } catch (e) { D("adapter error:", e && e.message); }

  // ── MOODLE (internal AJAX, needs M.cfg.sesskey) ──────────────────────────
  try {
    if (window.M && window.M.cfg && window.M.cfg.sesskey) {
      const sesskey = window.M.cfg.sesskey;
      const call = async (methodname, args) => {
        const { data } = await getJSON(`${origin}/lib/ajax/service.php?sesskey=${encodeURIComponent(sesskey)}&info=${methodname}`,
          { method: "POST", headers: { "Content-Type": "application/json" }, body: JSON.stringify([{ index: 0, methodname, args }]) });
        if (Array.isArray(data) && data[0] && !data[0].error) return data[0].data;
        throw new Error("moodle " + methodname);
      };
      const cres = await call("core_course_get_enrolled_courses_by_timeline_classification",
        { classification: "all", limit: 0, offset: 0, sort: "fullname" });
      const mc = (cres && cres.courses) || [];
      const gradeBy = {};
      try { (((await call("gradereport_overview_get_course_grades", {})) || {}).grades || [])
        .forEach(x => { gradeBy[x.courseid] = parseFloat(String(x.grade).replace(/[^\d.]/g, "")) || null; }); } catch {}
      const courses = mc.map(c => ({ id: String(c.id), name: c.fullname || "", course_code: c.shortname || "",
        current_score: gradeBy[c.id] ?? null, final_score: null }));
      const assignments = [];
      await Promise.all(courses.map(async (c) => {
        try {
          const ar = await call("mod_assign_get_assignments", { courseids: [Number(c.id)] });
          for (const a of ((ar && ar.courses && ar.courses[0] && ar.courses[0].assignments) || [])) {
            assignments.push({ course_ref: c.id, id: String(a.id), title: a.name || "Assignment",
              due_at: a.duedate ? new Date(a.duedate * 1000).toISOString() : null,
              points_possible: a.grade > 0 ? a.grade : null, score: null, submitted_at: null, missing: false });
          }
        } catch { /* skip */ }
      }));
      // Course materials → files (downloadable via session pluginfile.php).
      const files = [];
      await Promise.all(courses.map(async (c) => {
        try {
          const sections = await call("core_course_get_contents", { courseid: Number(c.id) });
          for (const sec of (sections || [])) {
            for (const mod of (sec.modules || [])) {
              for (const ct of (mod.contents || [])) {
                if (ct.type !== "file" || !ct.fileurl) continue;
                files.push({ course_ref: c.id, assignment_ref: null,
                  id: hashId("moodle_file_" + c.id + "_", ct.fileurl),
                  name: ct.filename || mod.name || "file",
                  file_type: fileType(ct.filename, ct.mimetype),
                  size_bytes: ct.filesize ?? null, source_url: ct.fileurl || null,
                  folder: mod.name || sec.name || null, status: "course_material" });
              }
            }
          }
        } catch { /* core_course_get_contents not exposed via ajax */ }
      }));
      return { lms: "moodle", courses, assignments, files };
    }
  } catch (e) { D("adapter error:", e && e.message); }

  // ── BRIGHTSPACE / D2L (Valence via session + XSRF token) ─────────────────
  try {
    if (window.D2L || localStorage.getItem("XSRF.Token")) {
      const xsrf = localStorage.getItem("XSRF.Token") || "";
      const dget = async (path) => (await getJSON(origin + path,
        { credentials: "include", headers: { "X-Csrf-Token": xsrf } })).data;

      // Tenants run different API versions — discover them, fall back to known-good.
      let lpV = "1.30", leV = "1.50";
      try {
        const vers = await dget("/d2l/api/versions/");
        const pick = (code) => (vers.find(v => v.ProductCode === code) || {}).LatestVersion;
        lpV = pick("lp") || lpV; leV = pick("le") || leV;
      } catch {}

      const courses = [];
      let bookmark = "";
      for (let i = 0; i < 20; i++) {
        const ps = await dget(`/d2l/api/lp/${lpV}/enrollments/myenrollments/?orgUnitTypeId=3&isActive=true${bookmark ? `&bookmark=${encodeURIComponent(bookmark)}` : ""}`);
        for (const it of (ps.Items || [])) { const o = it.OrgUnit || {}; courses.push({ id: String(o.Id), name: o.Name || "", course_code: o.Code || "", current_score: null, final_score: null }); }
        if (ps.PagingInfo && ps.PagingInfo.HasMoreItems) bookmark = ps.PagingInfo.Bookmark; else break;
      }
      const assignments = [];
      await Promise.all(courses.map(async (c) => {
        // One assignment per title: grade items carry score+weight, folders add due dates.
        const norm = s => (s || "").toLowerCase().replace(/\s+/g, " ").trim();
        const byTitle = new Map();
        // Short, stable, COLLISION-FREE id from the full title (hash avoids two long
        // titles that share a prefix mapping to the same id → duplicate-key upsert).
        const titleId = (k) => {
          let h = 0; for (let i = 0; i < k.length; i++) h = (Math.imul(h, 31) + k.charCodeAt(i)) | 0;
          return "d2l_" + c.id + "_" + (h >>> 0).toString(36) + "_" + k.slice(0, 32);
        };
        const upsertAssign = (title, patch) => {
          const k = norm(title);
          if (!k) return;
          const cur = byTitle.get(k) || {
            course_ref: c.id, id: titleId(k), title,
            due_at: null, points_possible: null, score: null,
            weight: null, weight_achieved: null, submitted_at: null, missing: false,
          };
          byTitle.set(k, Object.assign(cur, patch));
        };

        // Assignment folders (Dropbox) → due dates
        try {
          for (const f of (await dget(`/d2l/api/le/${leV}/${c.id}/dropbox/folders/`) || []))
            upsertAssign(f.Name || "Assignment", { due_at: f.DueDate || null });
        } catch (e) { D("dropbox fail", c.id, e && e.message); }

        // Quizzes → due dates
        try {
          const qz = await dget(`/d2l/api/le/${leV}/${c.id}/quizzes/`);
          for (const q of ((qz && qz.Objects) || (Array.isArray(qz) ? qz : [])))
            upsertAssign(q.Name || "Quiz", { due_at: q.DueDate || null });
        } catch (e) { D("quiz fail", c.id, e && e.message); }

        // Discussions (forums → topics)
        try {
          for (const f of (await dget(`/d2l/api/le/${leV}/${c.id}/discussions/forums/`) || [])) {
            for (const t of (await dget(`/d2l/api/le/${leV}/${c.id}/discussions/forums/${f.ForumId}/topics/`) || []))
              upsertAssign(t.Name || "Discussion", {});
          }
        } catch (e) { D("discussion fail", c.id, e && e.message); }

        // Grade structure: a category (e.g. "Weekly Discussions", weight 10) holds
        // sub-items ("Weekly Discussion 1..10"). Its rollup (3/10) ALREADY counts the
        // 7 undone discussions as zeros — so we must NOT trust the rollup. Instead we
        // go inside each category and average only its GRADED children, then weight
        // that by the category's weight. A category with no graded children (e.g.
        // "Critical Reflections") is dropped entirely. Same rule for standalone items:
        // a 0 means "not done yet", not a real zero — so it's excluded.
        let catList = [];
        const childIds = new Set();
        const childWeight = {};   // childId → course-level weight info {catWeight, totalMax, childMax}
        try {
          catList = (await dget(`/d2l/api/le/${leV}/${c.id}/grades/categories/`)) || [];
          for (const cat of catList) {
            const kids = cat.Grades || [];
            const totalMax = kids.reduce((s, g) => s + (g.MaxPoints || 0), 0);
            for (const g of kids) {
              childIds.add(String(g.Id));
              childWeight[String(g.Id)] = { catWeight: cat.Weight, totalMax, childMax: g.MaxPoints || 0 };
            }
          }
        } catch (e) { D("categories fail", c.id, e && e.message); }

        try {
          const items = (await dget(`/d2l/api/le/${leV}/${c.id}/grades/values/myGradeValues/`)) || [];

          const valById = {};
          for (const it of items) valById[String(it.GradeObjectIdentifier)] = it;

          // Each leaf grade item becomes an assignment carrying its score + weight.
          // Category rollups are skipped (they're aggregates, not assignments).
          // Weight is course-level: top-level items use the API's weighted values;
          // category children use catWeight × (childMax / totalChildrenMax).
          const r2 = n => (n == null ? null : Math.round(n * 100) / 100);
          for (const it of items) {
            if (it.GradeObjectTypeName === "Category") continue;
            const id = String(it.GradeObjectIdentifier);
            let weight = null, weightAch = null;
            const ci = childWeight[id];
            if (ci && ci.totalMax > 0) {
              weight = ci.catWeight * (ci.childMax / ci.totalMax);
              weightAch = it.PointsDenominator ? weight * (it.PointsNumerator / it.PointsDenominator) : null;
            } else if (it.WeightedDenominator != null) {
              weight = it.WeightedDenominator; weightAch = it.WeightedNumerator;
            }
            upsertAssign(it.GradeObjectName, {
              score:           it.PointsNumerator != null && it.PointsNumerator > 0 ? it.PointsNumerator : null,
              points_possible: it.PointsDenominator ?? null,
              weight:          r2(weight),
              weight_achieved: r2(weightAch),
            });
          }

          let num = 0, den = 0;

          // 1. Categories → average graded children only, scaled by category weight.
          for (const cat of catList) {
            const w = cat.Weight;
            if (w == null) continue;
            let cn = 0, cd = 0;
            for (const g of (cat.Grades || [])) {
              const v = valById[String(g.Id)];
              if (v && v.PointsNumerator > 0 && v.PointsDenominator) { cn += v.PointsNumerator; cd += v.PointsDenominator; }
            }
            if (cd > 0) { num += w * (cn / cd); den += w; }   // no graded child → drop the category
          }

          // 2. Standalone items (not a category member, not a category rollup) →
          //    weighted contribution, non-zero only.
          for (const it of items) {
            const id = String(it.GradeObjectIdentifier);
            if (childIds.has(id) || it.GradeObjectTypeName === "Category") continue;
            if (!(it.PointsNumerator > 0)) continue;   // 0 = not done yet
            if (it.WeightedNumerator != null && it.WeightedDenominator != null) {
              num += it.WeightedNumerator; den += it.WeightedDenominator;
            }
          }

          if (den > 0) c.current_score = Math.round((num / den) * 1000) / 10;
        } catch (e) { D("grades fail", c.id, e && e.message); }

        // Released final calculated grade overrides the computed one when present
        try {
          const gv = await dget(`/d2l/api/le/${leV}/${c.id}/grades/final/values/myGradeValue/`);
          if (gv && gv.PointsNumerator != null && gv.PointsDenominator)
            c.current_score = Math.round((gv.PointsNumerator / gv.PointsDenominator) * 1000) / 10;
        } catch {}

        assignments.push(...byTitle.values());
      }));
      // Content TOC → file topics (course materials). Modules nest, so walk them.
      const files = [];
      await Promise.all(courses.map(async (c) => {
        try {
          const toc = await dget(`/d2l/api/le/${leV}/${c.id}/content/toc`);
          const walk = (mod) => {
            for (const t of (mod.Topics || [])) {
              if (t.TypeIdentifier === "File" && t.TopicId) {
                // Use the D2L file download API endpoint rather than the viewer URL
                // (/viewContent/.../View) — the viewer returns an HTML wrapper page,
                // not the raw bytes the tutor needs (B3).
                files.push({ course_ref: c.id, assignment_ref: null,
                  id: "d2l_file_" + c.id + "_" + t.TopicId,
                  name: t.Title || ("topic_" + t.TopicId),
                  file_type: fileType(t.Title || (t.Url || ""), null),
                  size_bytes: null,
                  source_url: `${origin}/d2l/api/le/${leV}/${c.id}/content/topics/${t.TopicId}/file`,
                  folder: mod.Title || null, status: "course_material" });
              }
              // Capture external links (YouTube, Google Drive, etc.) so the tutor can
              // list them and YouTube videos can be transcribed (B4).
              if ((t.TypeIdentifier === "Link" || t.TypeIdentifier === "Url" || t.TypeIdentifier === "ResourceLink") && t.Url && t.TopicId) {
                const url = t.Url.startsWith("http") ? t.Url : origin + t.Url;
                const isYt = /youtu\.?be/i.test(url);
                const isGd = /drive\.google|docs\.google/i.test(url);
                files.push({ course_ref: c.id, assignment_ref: null,
                  id: "d2l_link_" + c.id + "_" + t.TopicId,
                  name: t.Title || ("link_" + t.TopicId),
                  file_type: isYt ? "youtube" : isGd ? "gdrive" : "link",
                  size_bytes: null,
                  source_url: url,
                  folder: mod.Title || null, status: "external_link" });
              }
            }
            for (const sub of (mod.Modules || [])) walk(sub);
          };
          for (const m of ((toc && toc.Modules) || [])) walk(m);
        } catch (e) { D("toc fail", c.id, e && e.message); }
      }));
      D("D2L synced — versions", lpV, leV, "| courses", courses.length, "| assignments", assignments.length, "| files", files.length, "| graded courses", courses.filter(c => c.current_score != null).length);
      return { lms: "d2l", courses, assignments, files };
    }
  } catch (e) { D("adapter error:", e && e.message); }

  D("no supported LMS API detected → falling back to scrape");
  return { lms: null };  // Blackboard / unknown → caller falls back to scraping
}

// Injected into the page via scripting API — runs in page context
function extractPageContent() {
  function deepText(root) {
    let out = "";
    const skip = new Set(["SCRIPT", "STYLE", "NOSCRIPT", "SVG"]);
    function walk(node) {
      if (!node) return;
      if (node.nodeType === Node.TEXT_NODE) {
        const t = node.textContent.replace(/\s+/g, " ").trim();
        if (t) out += t + " ";
        return;
      }
      if (node.nodeType !== Node.ELEMENT_NODE) return;
      if (skip.has(node.tagName)) return;
      if (node.shadowRoot) node.shadowRoot.childNodes.forEach(walk);
      if (node.tagName === "IFRAME") {
        try { const doc = node.contentDocument; if (doc?.body) walk(doc.body); } catch {}
        return;
      }
      node.childNodes.forEach(walk);
    }
    walk(root);
    return out;
  }

  const text = deepText(document.body).replace(/\s{3,}/g, "\n").trim().slice(0, 10000);

  const tables = [];
  function collectTables(root) {
    root.querySelectorAll?.("table").forEach(t => {
      const rows = [];
      t.querySelectorAll("tr").forEach(row => {
        const cells = [...row.querySelectorAll("th,td")].map(c => c.innerText.trim());
        if (cells.some(c => c)) rows.push(cells.join(" | "));
      });
      if (rows.length > 1) tables.push(rows.join("\n"));
    });
    root.querySelectorAll?.("*").forEach(el => { if (el.shadowRoot) collectTables(el.shadowRoot); });
  }
  collectTables(document);

  const courseIds = [];
  function addId(id) { if (id && !courseIds.includes(id)) courseIds.push(id); }
  function collectIds(root) {
    root.querySelectorAll?.("a[href]").forEach(a => {
      // D2L course links appear as ?ou=123, /d2l/home/123, or /d2l/le/.../123/
      const patterns = [/[?&]ou=(\d+)/, /\/d2l\/home\/(\d+)/, /\/d2l\/le\/[^/]+\/(\d+)/];
      for (const p of patterns) { const m = a.href.match(p); if (m) addId(m[1]); }
    });
    root.querySelectorAll?.("*").forEach(el => { if (el.shadowRoot) collectIds(el.shadowRoot); });
  }
  collectIds(document);

  // Harvest links (text + href) so the background worker can DISCOVER navigation
  // (courses → assignments → grades) on any portal, instead of hardcoded URLs.
  const links = [];
  const seenHref = new Set();
  function collectLinks(root) {
    root.querySelectorAll?.("a[href]").forEach(a => {
      const h = a.href;
      if (!h || seenHref.has(h) || !h.startsWith(window.location.origin)) return;
      seenHref.add(h);
      links.push({ t: (a.textContent || "").replace(/\s+/g, " ").trim().slice(0, 80), h });
    });
    root.querySelectorAll?.("*").forEach(el => { if (el.shadowRoot) collectLinks(el.shadowRoot); });
  }
  collectLinks(document);

  return {
    text,
    tables:    tables.slice(0, 5).join("\n\n"),
    url:       window.location.href,
    title:     document.title,
    courseIds,
    links:     links.slice(0, 200),
  };
}
