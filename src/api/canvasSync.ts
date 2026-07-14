/**
 * canvasSync.js — Orchestrates Canvas API fetches → Supabase storage.
 * Uses canvas-module as the source of truth for all API calls.
 * All writes are upserts to avoid duplicates on re-sync.
 *
 * Structured tables: public.courses + public.assignments
 * Blob storage (canvas_data): announcements, modules, assignment_groups, discussion_topics
 */

import { replaceFlashcardDeck } from "../lib/flashcardsSave";
import {
  fetchCourses,
  fetchAssignments,
  fetchAnnouncements,
  fetchModules,
  fetchAssignmentGroups,
  fetchDiscussionTopics,
  fetchPastCourses,
  fetchCourseFiles,
  fetchCoursePages,
  fetchQuizzes,
} from '../../canvas-module/canvasApi';
import {
  normalizeCourses,
  normalizeAssignments,
  normalizeAnnouncements,
  normalizeModule,
  normalizeAssignmentGroup,
  normalizeDiscussionTopic,
  normalizeCourseFiles,
  normalizeCourseFile,
  normalizeCoursePageSummary,
  normalizeQuiz,
  normalizePastCourses,
} from '../../canvas-module/canvasTransform';
import { supabase }      from './supabase';
import { awardTokens } from './tokens';

const PROXY_URL = '/api/canvas';
const CACHE_TTL_MS = 60 * 60 * 1000; // 1 hour

const GROQ_URL = '/api/groq';

const FLASHCARD_SYSTEM =
  'You are a study assistant. Generate exactly 8 flashcards from the course material. ' +
  'Format EVERY card as exactly: Q: [question] | A: [answer] — one per line, no extra text, no numbering.';

/** Generate flashcards for one course via Groq and upsert into flashcards table */
async function generateAndSaveFlashcards(userId, courseDbId, courseName, assignments, modules) {
  try {
    const assignmentList = assignments
      .slice(0, 20)
      .map(a => `- ${a.name}${a.description ? ': ' + a.description.replace(/<[^>]+>/g, '').slice(0, 120) : ''}`)
      .join('\n');

    const moduleList = modules
      .flatMap(m => m.modules ?? [])
      .slice(0, 15)
      .map(m => `- ${m.name}`)
      .join('\n');

    const prompt =
      `Course: ${courseName}\n\nModules:\n${moduleList || '(none)'}\n\n` +
      `Assignments:\n${assignmentList || '(none)'}\n\nGenerate 8 study flashcards for this course.`;

    const res = await fetch(GROQ_URL, {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({
        system:   FLASHCARD_SYSTEM,
        messages: [{ role: 'user', content: prompt }],
      }),
    });

    if (!res.ok) return null;
    const data = await res.json();
    const text = data.content ?? '';

    const allLines = text.split('\n').map(l => l.trim()).filter(Boolean);
    const cards = [];
    const pipeLines = allLines.filter(l => l.includes('Q:') && l.includes(' | ') && l.includes('A:'));
    if (pipeLines.length > 0) {
      pipeLines.forEach((line, i) => {
        const [qPart, aPart] = line.split(' | ');
        const question = (qPart || '').replace(/^(?:\d+[\.\)]\s*)?(?:\*+)?Q:\s*(?:\*+)?/i, '').trim();
        const answer   = (aPart || '').replace(/^(?:\d+[\.\)]\s*)?(?:\*+)?A:\s*(?:\*+)?/i, '').trim();
        if (question && answer) cards.push({ id: i, question, answer });
      });
    } else {
      for (let i = 0; i < allLines.length - 1; i++) {
        const qMatch = allLines[i].match(/^(?:\d+[\.\)]\s*)?(?:\*+)?Q:\s*(?:\*+)?(.+)/i);
        if (qMatch) {
          const aMatch = allLines[i + 1].match(/^(?:\*+)?A:\s*(?:\*+)?(.+)/i);
          if (aMatch) {
            cards.push({ id: cards.length, question: qMatch[1].trim(), answer: aMatch[1].trim() });
            i++;
          }
        }
      }
    }

    if (!cards.length) return null;

    // flashcards_v2 (per-row) is the table the app READS; the old single-row
    // `flashcards` table is retired + unread. Replace this course's deck.
    await replaceFlashcardDeck(supabase, userId, courseDbId, cards);

    return cards;
  } catch (err) {
    console.warn(`Flashcard gen failed for ${courseName}:`, err.message);
    return null;
  }
}

/** Build a structured syllabus from modules + assignments per course */
function buildSyllabus(courses, allModules, allAssignments, allAssignmentGroups) {
  return courses.map(course => {
    const cid = String(course.id);
    const courseModules     = (allModules.find(m => String(m.courseId) === cid))?.modules ?? [];
    const courseAssignments = allAssignments.filter(a => String(a.courseId) === cid);
    const courseGroups      = (allAssignmentGroups.find(g => String(g.courseId) === cid))?.groups ?? [];
    return {
      courseId:     course.id,
      courseName:   course.name,
      courseCode:   course.courseCode,
      modules:      courseModules.map(m => ({
        name:  m.name,
        items: (m.items ?? []).map(i => i.title ?? i.name).filter(Boolean),
      })),
      assignments:  courseAssignments.map(a => ({
        name:           a.name,
        dueAt:          a.dueAt,
        pointsPossible: a.pointsPossible,
      })),
      gradeWeights: courseGroups.map(g => ({ name: g.name, weight: g.weight })),
    };
  });
}

export function buildApiBase(rawUrl) {
  let url = rawUrl.trim().replace(/\/+$/, '');
  if (!url.startsWith('http')) url = `https://${url}`;
  if (!url.includes('/api/v1')) url = `${url}/api/v1`;
  return url;
}

function scoreToGpa(pct) {
  if (pct >= 90) return 4.0;
  if (pct >= 85) return 3.7;
  if (pct >= 80) return 3.3;
  if (pct >= 75) return 3.0;
  if (pct >= 70) return 2.7;
  if (pct >= 65) return 2.3;
  if (pct >= 60) return 2.0;
  return 1.0;
}

/**
 * Save a single blob row into canvas_data.
 * Uses delete-then-insert instead of upsert to avoid 400 errors when the
 * Supabase onConflict constraint lookup fails (missing or mis-named index).
 */
async function saveBlob(userId, dataType, payload, now) {
  await supabase
    .from('canvas_data')
    .delete()
    .eq('user_id', userId)
    .eq('data_type', dataType);

  const { error } = await supabase
    .from('canvas_data')
    .insert({ user_id: userId, data_type: dataType, payload, synced_at: now });

  if (error) console.error('canvas_data save failed:', dataType, error.message);
}

/**
 * Main sync function. Fetches all available Canvas data and upserts into Supabase.
 * Returns { cached: true } if data is less than 1 hour old.
 * Returns { courses, assignments, announcements, modules, assignmentGroups, discussionTopics, gpa } on fresh sync.
 */
export async function syncCanvasData(userId, canvasToken, canvasBaseUrl) {
  const baseUrl = buildApiBase(canvasBaseUrl);

  // Check cache
  const { data: user } = await supabase
    .from('users')
    .select('canvas_synced_at')
    .eq('id', userId)
    .maybeSingle();

  if (user?.canvas_synced_at) {
    const age = Date.now() - new Date(user.canvas_synced_at).getTime();
    if (age < CACHE_TTL_MS) return { cached: true };
  }

  const proxy = PROXY_URL || undefined;
  const now = new Date().toISOString();

  // ── 1. Courses ───────────────────────────────────────────────────
  const rawCourses = await fetchCourses(canvasToken, baseUrl, proxy);
  const courses = normalizeCourses(rawCourses);

  const courseRows = courses.map(c => ({
    user_id:          userId,
    canvas_course_id: c.id,
    name:             c.name,
    course_code:      c.courseCode,
    professor:        c.professor ?? null,
    current_score:    c.currentScore,
    final_score:      c.finalScore,
    image_url:        c.imageUrl,
    source:           'canvas',
    updated_at:       now,
  }));

  let { data: upsertedCourses, error: courseError } = await supabase
    .from('courses')
    .upsert(courseRows, { onConflict: 'user_id,canvas_course_id' })
    .select('id, canvas_course_id');

  // `professor` ships with supabase-course-professor-migration.sql (run manually in the SQL
  // editor). If that migration hasn't run yet, PostgREST rejects the whole upsert (PGRST204).
  // Rather than break the entire sync, drop professor and retry — it persists automatically
  // once the migration is applied.
  if (courseError && /professor/i.test(courseError.message || '')) {
    const stripped = courseRows.map(({ professor, ...rest }) => rest);
    ({ data: upsertedCourses, error: courseError } = await supabase
      .from('courses')
      .upsert(stripped, { onConflict: 'user_id,canvas_course_id' })
      .select('id, canvas_course_id'));
    if (!courseError) console.warn("courses.professor missing — run supabase-course-professor-migration.sql; synced without professor");
  }

  if (courseError) throw new Error(`Courses upsert failed: ${courseError.message}`);

  const courseIdMap = {};
  (upsertedCourses || []).forEach(c => { courseIdMap[c.canvas_course_id] = c.id; });

  // Also map any past courses the user explicitly added via "Add" on the Canvas page,
  // so their assignments get the correct course_id linkage.
  const { data: pastAddedCourses } = await supabase
    .from("courses")
    .select("id, canvas_course_id")
    .eq("user_id", userId)
    .eq("source", "past_canvas");
  (pastAddedCourses ?? []).forEach(c => {
    if (c.canvas_course_id) courseIdMap[String(c.canvas_course_id)] = c.id;
  });

  const courseIds = courses.map(c => c.id);

  // Collection arrays (declared up here so past-course extraction below can
  // push into the same files/pages blobs as current courses).
  const allAssignments      = [];
  const allModules          = [];
  const allAssignmentGroups = [];
  const allDiscussionTopics = [];
  const allCourseFiles      = [];
  const allCoursePages      = [];
  const allQuizzes          = [];

  // ── 1b. Past/completed courses ───────────────────────────────────
  let pastCourses = [];
  try {
    const rawPast = await fetchPastCourses(canvasToken, baseUrl, proxy);
    pastCourses = normalizePastCourses(rawPast);
  } catch { /* skip */ }

  // ── 1c. Extract assignments + files + notes for past courses ─────
  const allPastAssignments = [];
  const recentPast = pastCourses.slice(0, 5);
  for (const pastCourse of recentPast) {
    const meta = { courseId: pastCourse.id, courseCode: pastCourse.courseCode, courseName: pastCourse.name };
    try {
      const raw = await fetchAssignments(canvasToken, baseUrl, pastCourse.id, proxy);
      allPastAssignments.push(...normalizeAssignments(raw, meta));
    } catch { /* skip — past courses may return 404 */ }
    // Slides / PDFs / docs for the past course
    try {
      const raw = await fetchCourseFiles(canvasToken, baseUrl, pastCourse.id, proxy);
      allCourseFiles.push({ courseId: pastCourse.id, courseCode: pastCourse.courseCode, courseName: pastCourse.name, files: normalizeCourseFiles(raw), past: true });
    } catch { /* skip */ }
    // Lecture notes / reading pages for the past course
    try {
      const raw = await fetchCoursePages(canvasToken, baseUrl, pastCourse.id, proxy);
      allCoursePages.push({ courseId: pastCourse.id, courseCode: pastCourse.courseCode, courseName: pastCourse.name, pages: raw.map(normalizeCoursePageSummary), past: true });
    } catch { /* skip */ }
  }

  // Upsert past assignments if any were fetched
  if (allPastAssignments.length > 0) {
    const pastAssignRows = allPastAssignments.map(a => ({
      user_id:              userId,
      course_id:            courseIdMap[String(a.courseId)] ?? null,
      canvas_assignment_id: a.id ? String(a.id) : null,
      title:                a.name,
      description:          a.description ?? null,
      due_at:               a.dueAt ?? null,
      points_possible:      a.pointsPossible ?? null,
      score:                a.submission?.score ?? null,
      source:               'past_canvas',
      is_manual:            false,
      updated_at:           now,
    }));
    const { error: pastAssignErr } = await supabase
      .from('assignments')
      .upsert(pastAssignRows.filter(r => r.canvas_assignment_id), { onConflict: 'user_id,canvas_assignment_id' });
    if (pastAssignErr) console.error('assignments save failed (past):', pastAssignErr.message);
  }

  // ── 2. Per-course data (parallel within each course, sequential across courses) ──
  // Running all 7 fetch types in parallel per course reduces wall-clock time by ~7×
  // compared to the old sequential approach. Promise.allSettled means one slow or
  // failing endpoint can't block the others.
  for (const course of courses) {
    const meta = { courseId: course.id, courseCode: course.courseCode, courseName: course.name };

    const [
      assignRes, moduleRes, groupRes,
      discussRes, filesRes, pagesRes, quizRes,
    ] = await Promise.allSettled([
      fetchAssignments(canvasToken, baseUrl, course.id, proxy),
      fetchModules(canvasToken, baseUrl, course.id, proxy),
      fetchAssignmentGroups(canvasToken, baseUrl, course.id, proxy),
      fetchDiscussionTopics(canvasToken, baseUrl, course.id, proxy),
      fetchCourseFiles(canvasToken, baseUrl, course.id, proxy),
      fetchCoursePages(canvasToken, baseUrl, course.id, proxy),
      fetchQuizzes(canvasToken, baseUrl, course.id, proxy),
    ]);

    if (assignRes.status === "fulfilled")
      allAssignments.push(...normalizeAssignments(assignRes.value, meta));

    if (moduleRes.status === "fulfilled")
      allModules.push({ courseId: course.id, courseCode: course.courseCode, courseName: course.name, modules: moduleRes.value.map(normalizeModule) });

    if (groupRes.status === "fulfilled")
      allAssignmentGroups.push({ courseId: course.id, courseCode: course.courseCode, courseName: course.name, groups: groupRes.value.map(normalizeAssignmentGroup) });

    if (discussRes.status === "fulfilled")
      allDiscussionTopics.push({ courseId: course.id, courseCode: course.courseCode, courseName: course.name, topics: discussRes.value.map(normalizeDiscussionTopic) });

    if (filesRes.status === "fulfilled")
      allCourseFiles.push({ courseId: course.id, courseCode: course.courseCode, courseName: course.name, files: normalizeCourseFiles(filesRes.value) });

    if (pagesRes.status === "fulfilled")
      allCoursePages.push({ courseId: course.id, courseCode: course.courseCode, courseName: course.name, pages: pagesRes.value.map(normalizeCoursePageSummary) });

    if (quizRes.status === "fulfilled")
      allQuizzes.push({ courseId: course.id, courseCode: course.courseCode, courseName: course.name, quizzes: quizRes.value.map(normalizeQuiz) });
  }

  // ── 3. Announcements (global, across all courses) ────────────────
  let announcements = [];
  try {
    const raw = await fetchAnnouncements(canvasToken, baseUrl, courseIds, proxy);
    announcements = normalizeAnnouncements(raw);
  } catch { /* skip */ }

  // ── 4. Upsert assignments to structured table ────────────────────
  if (allAssignments.length) {
    const assignmentRows = allAssignments.map(a => ({
      user_id:              userId,
      course_id:            courseIdMap[a.courseId] ?? null,
      canvas_assignment_id: a.id,
      title:                a.name,
      description:          a.description           || null,
      due_at:               a.dueAt                 || null,
      points_possible:      a.pointsPossible         ?? null,
      score:                a.submission?.score       ?? null,
      submitted_at:         a.submission?.submittedAt ?? null,
      submission_type:      a.submission?.submissionType ?? null,
      late:                 a.submission?.late    ?? false,
      missing:              a.submission?.missing ?? false,
      source:               'canvas',
      updated_at:           now,
    }));

    const { error: assignError } = await supabase
      .from('assignments')
      .upsert(assignmentRows, { onConflict: 'user_id,canvas_assignment_id' });

    if (assignError) {
      console.error('assignments save failed:', assignError.message);
      throw new Error(`Assignments upsert failed: ${assignError.message}`);
    }
  }

  // ── 4b. Upsert quizzes to structured table (real dates, queryable by the reminder
  // cron) — was previously only saved to the canvas_data blob below, which a cron
  // scanning across all users can't query efficiently.
  const flatQuizzes = allQuizzes.flatMap(group =>
    group.quizzes.map(q => ({ ...q, courseId: group.courseId }))
  );
  if (flatQuizzes.length) {
    const quizRows = flatQuizzes
      .filter(q => courseIdMap[String(q.courseId)] != null)
      .map(q => ({
        user_id:          userId,
        course_id:        String(courseIdMap[String(q.courseId)]),
        external_quiz_id: String(q.id),
        title:            q.title,
        due_at:           q.dueAt || null,
        quiz_type:        q.quizType || null,
        points_possible:  q.pointsPossible ?? null,
      }));
    if (quizRows.length) {
      const { error: quizError } = await supabase
        .from('canvas_quizzes')
        .upsert(quizRows, { onConflict: 'user_id,external_quiz_id' });
      if (quizError) console.error('canvas_quizzes save failed:', quizError.message);
    }
  }

  // ── 5. Save blob data to canvas_data ────────────────────────────
  const syllabus = buildSyllabus(courses, allModules, allAssignments, allAssignmentGroups);

  await Promise.all([
    saveBlob(userId, 'announcements',     announcements,       now),
    saveBlob(userId, 'modules',           allModules,          now),
    saveBlob(userId, 'assignment_groups', allAssignmentGroups, now),
    saveBlob(userId, 'discussion_topics', allDiscussionTopics, now),
    saveBlob(userId, 'syllabus',          syllabus,            now),
    saveBlob(userId, 'course_files',      allCourseFiles,      now),
    saveBlob(userId, 'course_pages',      allCoursePages,      now),
    saveBlob(userId, 'quizzes',           allQuizzes,          now),
    saveBlob(userId, 'past_courses',      pastCourses,         now),
  ]);

  // ── 6. GPA + update user ─────────────────────────────────────────
  const scoredCourses = courses.filter(c => c.currentScore !== null);
  const avgScore = scoredCourses.length
    ? scoredCourses.reduce((s, c) => s + c.currentScore, 0) / scoredCourses.length
    : null;
  const gpa = avgScore !== null ? scoreToGpa(avgScore) : null;

  await supabase
    .from('users')
    .upsert({ id: userId, gpa, canvas_synced_at: now }, { onConflict: 'id' });

  // ── 7. Auto-generate flashcards per course (non-blocking) ────────
  Promise.allSettled(
    courses.map(course => {
      const dbId       = courseIdMap[course.id];
      const courseAssn = allAssignments.filter(a => a.courseId === course.id);
      return generateAndSaveFlashcards(userId, dbId, course.name, courseAssn, allModules);
    })
  ).catch(() => {/* non-fatal */});

  // Award canvas_sync token (non-blocking, server deduplicates daily)
  awardTokens("canvas_sync").catch(() => {});

  // ── 8. Sync to NeuroAGI Brain DB (fire-and-forget) ────────────────────────
  // Writes course + assignment summaries to fschool.* tables in Brain DB.
  // Only fires if BRAIN_SUPABASE_URL and BRAIN_SUPABASE_KEY env vars are set.
  // Requires user to have a brain_person_id (set by brain-person-link.js on signup).
  syncToBrainDB(userId, courses, allAssignments, courseIdMap, now).catch(
    err => console.error('[canvasSync] brain sync failed:', err.message)
  );

  // Manual + past courses live only in the DB (the Canvas API doesn't return them).
  // Without merging them in, this sync's result would be Canvas-only and overwrite
  // them in the UI's `courses` state — so a manually-added course would vanish on the
  // next sync even though it's saved. Re-read them and append (deduped against Canvas).
  let extraCourses = [];
  try {
    const { data: extra } = await supabase
      .from('courses')
      .select('*')
      .eq('user_id', userId)
      .or('source.eq.manual,source.eq.past_canvas,is_manual.eq.true');
    const canvasIds = new Set(courses.map(c => String(c.id)));
    extraCourses = (extra || [])
      .map(c => ({
        id:               c.canvas_course_id ?? c.id,
        dbId:             c.id,
        name:             c.name,
        courseCode:       c.course_code,
        professor:        c.professor ?? null,
        currentScore:     c.current_score,
        finalScore:       c.final_score,
        imageUrl:         c.image_url,
        source:           c.source,
        isManual:         c.source === 'manual' || c.is_manual === true,
        enrollmentState:  'active',
        accessRestricted: false,
        assignmentGroups: null,
      }))
      .filter(c => !canvasIds.has(String(c.id))); // Canvas (live) rows win on overlap
  } catch { /* non-fatal — return Canvas courses alone */ }

  // Preserve in-app "Mark as done" across this Canvas re-sync. Canvas returns
  // submitted_at=null for work the student finished only inside FschoolAI, which would
  // resurface the task. manual_done_at is our app-only completion flag (Canvas never
  // writes it) — OR it into submittedAt so a mid-session force-sync doesn't undo it.
  try {
    const { data: doneRows } = await supabase
      .from('assignments')
      .select('canvas_assignment_id, manual_done_at')
      .eq('user_id', userId)
      .not('manual_done_at', 'is', null);
    if (doneRows?.length) {
      const doneMap = new Map(doneRows.map(r => [String(r.canvas_assignment_id), r.manual_done_at]));
      for (const a of allAssignments) {
        const dm = doneMap.get(String(a.id));
        if (dm && !a.submission?.submittedAt) a.submission = { ...(a.submission || {}), submittedAt: dm };
      }
    }
  } catch { /* manual_done_at column may not exist yet — non-fatal */ }

  return {
    courses:          [...courses, ...extraCourses],
    assignments:      allAssignments,
    announcements,
    modules:          allModules,
    assignmentGroups: allAssignmentGroups,
    discussionTopics: allDiscussionTopics,
    syllabus,
    courseFiles:      allCourseFiles,
    coursePages:      allCoursePages,
    quizzes:          allQuizzes,
    pastCourses,
    gpa,
  };
}

/**
 * Load all synced Canvas data from Supabase (Canvas + manual courses).
 * FIX: manual courses have no canvas_course_id — use DB id as fallback.
 */
export async function loadCanvasData(userId) {
  // Files index. `storage_path` only exists once supabase-files-storage-migration.sql
  // has run; selecting an unknown column makes PostgREST 400 the WHOLE query (→ the
  // Files page shows "No files yet"). So fall back to the column set without it,
  // keeping the page working pre-migration — storage_path is null then anyway.
  const FILE_COLS      = 'id, course_id, assignment_id, name, file_type, size_bytes, source_url, folder, status, storage_path';
  const FILE_COLS_BASE = 'id, course_id, assignment_id, name, file_type, size_bytes, source_url, folder, status';
  const loadFiles = async () => {
    const res = await supabase.from('files').select(FILE_COLS).eq('user_id', userId);
    if (res.error && /storage_path/.test(res.error.message || '')) {
      return supabase.from('files').select(FILE_COLS_BASE).eq('user_id', userId);
    }
    return res;
  };

  // Assignments: explicit columns, WITHOUT description — it holds the full Canvas HTML
  // brief (1-10KB/row) and only the Assignment detail view needs it (lazy-fetched there).
  // Falls back to * if the live schema is missing one of these columns (same pattern as
  // loadFiles' storage_path fallback).
  const ASSIGNMENT_COLS = 'id, canvas_assignment_id, course_id, title, due_at, points_possible, '
    + 'score, submitted_at, submission_type, late, missing, source, weight, weight_achieved, manual_done_at';
  const loadAssignments = async () => {
    const res = await supabase.from('assignments')
      .select(`${ASSIGNMENT_COLS}, courses(id, canvas_course_id, course_code, name)`).eq('user_id', userId);
    if (res.error) {
      return supabase.from('assignments').select('*, courses(id, canvas_course_id, course_code, name)').eq('user_id', userId);
    }
    return res;
  };

  // Blob types the boot path actually consumes. The unlisted rows are the expensive dead
  // weight: the raw `assignments` Canvas dump (~480KB/user — the structured assignments
  // TABLE is what boot reads) and Study's per-course `study_guide_<id>` blobs (Study
  // loads its own guide by exact key). Excluding them cuts most of the boot download.
  const BOOT_BLOB_TYPES = [
    'announcements', 'modules', 'assignment_groups', 'discussion_topics', 'syllabus',
    'course_files', 'course_pages', 'quizzes', 'past_courses',
    'ext_courses', 'ext_assignments', 'ext_grades',
  ];

  const [cResult, aResult, blobResult, fcResult, fileResult] = await Promise.all([
    supabase.from('courses').select('*').eq('user_id', userId),
    loadAssignments(),
    // Single query for all blob types — avoids 5 separate requests and 400s on missing rows
    supabase.from('canvas_data').select('data_type, payload').eq('user_id', userId).in('data_type', BOOT_BLOB_TYPES),
    supabase.from('flashcards_v2').select('course_id, id, question, answer, created_at').eq('user_id', userId).order('created_at', { ascending: false }),
    loadFiles(),
  ]);

  // Build a lookup map from the single blob query
  const blobMap = {};
  (blobResult.data || []).forEach(row => { blobMap[row.data_type] = row.payload; });

  const annResult  = { data: { payload: blobMap['announcements']    ?? [] } };
  const modResult  = { data: { payload: blobMap['modules']          ?? [] } };
  const agResult   = { data: { payload: blobMap['assignment_groups']?? [] } };
  const dtResult   = { data: { payload: blobMap['discussion_topics']?? [] } };
  const sylResult  = { data: { payload: blobMap['syllabus']          ?? [] } };
  const filesResult  = { data: { payload: blobMap['course_files']   ?? [] } };
  const pagesResult  = { data: { payload: blobMap['course_pages']   ?? [] } };
  const quizResult   = { data: { payload: blobMap['quizzes']        ?? [] } };
  const pastResult   = { data: { payload: blobMap['past_courses']   ?? [] } };

  const courses = (cResult.data || []).map(c => ({
    // Canvas courses: expose canvas_course_id as the id (used for assignment matching)
    // Manual courses: canvas_course_id is null, so use the DB UUID (matches course_id on assignments)
    id:               c.canvas_course_id ?? c.id,
    dbId:             c.id,
    name:             c.name,
    courseCode:       c.course_code,
    professor:        c.professor ?? null,
    currentScore:     c.current_score,
    finalScore:       c.final_score,
    imageUrl:         c.image_url,
    source:           c.source,
    isManual:         c.source === 'manual' || c.is_manual === true,
    enrollmentState:  'active',
    accessRestricted: false,
    assignmentGroups: null,
  }));

  const assignments = (aResult.data || []).map(a => {
    const isManual = a.source === 'manual' || a.is_manual === true;
    // Canvas: courseId = canvas_course_id from the joined course row
    // Manual: courseId = course_id (DB UUID), which matches c.canvas_course_id ?? c.id above
    const courseId = isManual
      ? (a.course_id ?? null)
      : (a.courses?.canvas_course_id ?? a.course_id ?? null);

    return {
      id:             a.canvas_assignment_id ?? a.id,
      // Kept separately so writes (markAssignmentDone) can key on the right column:
      // canvas_assignment_id when it exists (Canvas rows AND syllabus-extracted rows,
      // whose ids are the deterministic `syl:…` strings), else the DB row id. Matching
      // a `syl:…` string against the bigint id column would 400 the whole update.
      canvasAssignmentId: a.canvas_assignment_id ?? null,
      name:           a.title ?? a.name,
      description:    a.description,
      dueAt:          a.due_at,
      pointsPossible: a.points_possible,
      // Per-assignment grade weighting (public schema columns).
      // weight = % of final grade this assignment is worth.
      // weightAchieved = portion of that weight the student earned.
      weight:         a.weight,
      weightAchieved: a.weight_achieved,
      courseId,
      courseCode:     a.courses?.course_code ?? '',
      courseName:     a.courses?.name        ?? '',
      source:         a.source,
      isManual,
      submission: {
        score:          a.score,
        // manual_done_at = the student marked this done inside FschoolAI (Canvas doesn't
        // know). OR it in so every "done" check (which keys off submittedAt) reflects it,
        // and it survives a Canvas re-sync (sync writes submitted_at only, never this column).
        submittedAt:    a.submitted_at ?? a.manual_done_at ?? null,
        submissionType: a.submission_type,
        late:           a.late    ?? false,
        missing:        a.missing ?? false,
      },
    };
  });

  // Extension file index → app shape. `courseDbId` matches a course's DB UUID
  // (course.dbId in the mapped courses above), so the UI can group by course.
  const files = (fileResult.data || []).map((f: any) => ({
    id:             f.id,
    courseDbId:     f.course_id,
    assignmentDbId: f.assignment_id,
    name:           f.name,
    fileType:       f.file_type,
    sizeBytes:      f.size_bytes,
    sourceUrl:      f.source_url,
    storagePath:    f.storage_path,   // path in the private `course-files` bucket (null until uploaded)
    folder:         f.folder,
    status:         f.status,
  }));

  // Build flashcard map from v2 individual rows: course_id → { cards[], generatedAt }
  const flashcardMap = {};
  (fcResult.data || []).forEach(row => {
    if (!flashcardMap[row.course_id]) {
      flashcardMap[row.course_id] = { cards: [], generatedAt: row.created_at };
    }
    flashcardMap[row.course_id].cards.push({ id: row.id, question: row.question, answer: row.answer });
  });

  // ── Merge browser-extension data (non-Canvas users) ──────────────────────────
  // The Chrome extension writes ext_courses / ext_assignments / ext_grades blobs.
  // Convert them to the app's shape and append so they show on the dashboard.
  const extCourses     = blobMap['ext_courses']     ?? [];
  const extAssignments = blobMap['ext_assignments'] ?? [];
  const extGrades      = blobMap['ext_grades']      ?? [];

  // Parse a percentage/score string ("85%", "85/100", "A") into a 0-100 number
  function parseScore(g) {
    if (g == null) return null;
    const s = String(g);
    const pct = s.match(/(\d{1,3}(?:\.\d+)?)\s*%/);
    if (pct) return parseFloat(pct[1]);
    const frac = s.match(/(\d+(?:\.\d+)?)\s*\/\s*(\d+(?:\.\d+)?)/);
    if (frac) return (parseFloat(frac[1]) / parseFloat(frac[2])) * 100;
    const num = s.match(/^\s*(\d{1,3}(?:\.\d+)?)\s*$/);
    if (num) return parseFloat(num[1]);
    return null; // letter grades left unscored
  }

  if (extCourses.length) {
    // Map course name → score from ext_grades
    const gradeByCourse = {};
    extGrades.forEach(g => {
      const score = parseScore(g.percentage) ?? parseScore(g.score) ?? null;
      if (g.course) gradeByCourse[g.course.toLowerCase()] = score;
    });

    extCourses.forEach((c, i) => {
      const key = (c.name ?? c.code ?? `ext${i}`).toLowerCase();
      const score = gradeByCourse[key]
        ?? gradeByCourse[(c.code ?? "").toLowerCase()]
        ?? null;
      courses.push({
        id:               `ext_${c.code ?? i}`,
        dbId:             null,
        name:             c.name ?? c.code ?? "Course",
        courseCode:       c.code ?? "",
        professor:        c.professor ?? c.teacher ?? null,
        currentScore:     score,
        finalScore:       null,
        imageUrl:         null,
        source:           "extension",
        isManual:         false,
        enrollmentState:  "active",
        accessRestricted: false,
        assignmentGroups: null,
      });
    });
  }

  if (extAssignments.length) {
    extAssignments.forEach((a, i) => {
      const due = a.dueDate ? new Date(a.dueDate) : null;
      const validDue = due && !isNaN(due.getTime()) ? due.toISOString() : null;
      const submitted = a.status === "submitted" || a.status === "graded";
      assignments.push({
        id:             `ext_a_${i}_${(a.name ?? "").slice(0, 20)}`,
        name:           a.name ?? "Assignment",
        description:    null,
        dueAt:          validDue,
        pointsPossible: a.pointsPossible != null ? Number(String(a.pointsPossible).replace(/[^\d.]/g, "")) || null : null,
        courseId:       `ext_${a.course ?? ""}`,
        courseCode:     a.course ?? "",
        courseName:     a.course ?? "",
        source:         "extension",
        isManual:       false,
        submission: {
          score:          parseScore(a.grade),
          submittedAt:    submitted ? new Date().toISOString() : null,
          submissionType: null,
          late:           false,
          missing:        a.status === "missing",
        },
      } as any);
    });
  }

  // Past courses (manually added or imported) live in the courses table with a
  // past-ish source — surface them in the Past Courses section, and keep them out of
  // the main/current course list (semester isn't a column, so they group under "Past").
  const isPastCourse = (c) => c.source === 'manual_past' || c.source === 'past_canvas';
  const pastDbCourses = courses.filter(isPastCourse).map(c => ({
    id:           c.dbId ?? c.id,
    dbId:         c.dbId ?? c.id,
    name:         c.name,
    courseCode:   c.courseCode,
    currentScore: c.currentScore,
    semester:     'Past',
    manual:       true,
  }));

  return {
    courses:          courses.filter(c => !isPastCourse(c)),
    assignments,
    files,
    announcements:    annResult.data?.payload  ?? [],
    modules:          modResult.data?.payload  ?? [],
    assignmentGroups: agResult.data?.payload   ?? [],
    discussionTopics: dtResult.data?.payload   ?? [],
    syllabus:         sylResult.data?.payload  ?? [],
    courseFiles:      filesResult.data?.payload ?? [],
    coursePages:      pagesResult.data?.payload ?? [],
    quizzes:          quizResult.data?.payload  ?? [],
    pastCourses:      [...(pastResult.data?.payload ?? []), ...pastDbCourses],
    flashcardMap,
    syncedAt:         null,
  };
}

// ── Brain DB Sync Helper ──────────────────────────────────────────────────────
// Writes course and assignment data to fschool.* tables in NeuroAGI Brain DB.
// Called fire-and-forget after each Canvas sync — never blocks the main sync.
//
// Brain DB schema (fschool schema):
//   fschool.courses:     person_id, canvas_course_id, name, course_code, current_score, final_score, synced_at
//   fschool.assignments: person_id, canvas_assignment_id, course_id, title, due_at, score, points_possible, missing, late, synced_at

async function syncToBrainDB(userId, courses, assignments, courseIdMap, now) {
  const brainUrl = import.meta.env?.VITE_BRAIN_SUPABASE_URL;
  const brainKey = import.meta.env?.VITE_BRAIN_SUPABASE_KEY;

  // Gracefully skip if Brain DB not configured
  if (!brainUrl || !brainKey) return;

  // Fetch user's brain_person_id from FschoolAI DB
  const { data: userData } = await supabase
    .from('users')
    .select('brain_person_id')
    .eq('id', userId)
    .maybeSingle();

  const brainPersonId = userData?.brain_person_id;
  if (!brainPersonId) return; // User not yet linked to Brain DB

  const brainHeaders = {
    'apikey':        brainKey,
    'Authorization': `Bearer ${brainKey}`,
    'Content-Type':  'application/json',
    'Prefer':        'resolution=merge-duplicates,return=minimal',
  };

  // Upsert courses to fschool.courses
  if (courses.length) {
    const courseRows = courses.map(c => ({
      person_id:        brainPersonId,
      canvas_course_id: String(c.id),
      name:             c.name,
      course_code:      c.courseCode ?? null,
      current_score:    c.currentScore ?? null,
      final_score:      c.finalScore ?? null,
      synced_at:        now,
    }));

    // Courses go to fschool_COURSES (was wrongly POSTing to fschool_assignments — the
    // assignments table lacks name/course_code/*_score, so PostgREST 400'd and, since
    // fetch doesn't reject on 4xx, the .catch never fired and courses silently never synced).
    const cr = await fetch(`${brainUrl}/rest/v1/fschool_courses`, {
      method:  'POST',
      headers: brainHeaders,
      body:    JSON.stringify(courseRows),
    }).catch(err => { console.error('[syncToBrainDB] courses write failed:', err.message); return null; });
    if (cr && !cr.ok) console.error('[syncToBrainDB] courses write HTTP', cr.status, (await cr.text().catch(() => '')).slice(0, 200));
  }

  // Upsert assignments to fschool.assignments (cap at 100 most recent)
  const recentAssignments = assignments
    .filter(a => a.dueAt)
    .sort((a, b) => +new Date(b.dueAt) - +new Date(a.dueAt))
    .slice(0, 100);

  if (recentAssignments.length) {
    const assignRows = recentAssignments.map(a => ({
      person_id:            brainPersonId,
      canvas_assignment_id: String(a.id),
      canvas_course_id:     String(a.courseId),
      title:                a.name,
      due_at:               a.dueAt ?? null,
      score:                a.submission?.score ?? null,
      points_possible:      a.pointsPossible ?? null,
      missing:              a.submission?.missing ?? false,
      late:                 a.submission?.late ?? false,
      synced_at:            now,
    }));

    await fetch(`${brainUrl}/rest/v1/fschool_assignments`, {
      method:  'POST',
      headers: brainHeaders,
      body:    JSON.stringify(assignRows),
    }).catch(err => console.error('[syncToBrainDB] assignments write failed:', err.message));
  }
}
