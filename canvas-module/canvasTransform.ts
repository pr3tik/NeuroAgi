/**
 * canvasTransform.js
 * Pure functions that normalize raw Canvas API responses into clean,
 * app-agnostic objects. No API calls or side effects; input comes from
 * canvasApi.js, output goes to your application layer.
 */

// ─── Courses ─────────────────────────────────────────────────────────────────

function extractProfessor(raw) {
  const teachers = Array.isArray(raw.teachers) ? raw.teachers : [];
  const names = teachers.map(t => t && (t.display_name || t.name)).filter(Boolean);
  return names.length ? [...new Set(names)].join(', ') : null;
}

export function normalizeCourse(raw) {
  const enrollment = Array.isArray(raw.enrollments) ? raw.enrollments[0] : null;
  return {
    id: raw.id,
    // Cross-fallback: a Canvas course can return only one of name/course_code (name-less
    // access-restricted stubs, unpublished sections). Without this, a code-only course got
    // name:'' and was silently dropped by the normalizeCourses() filter — never reaching the
    // DB or any UI. Keep both fields populated so the course survives and always has a label.
    name: raw.name || raw.course_code || raw.original_name || '',
    courseCode: raw.course_code || raw.name || '',
    professor: extractProfessor(raw),
    imageUrl: raw.image_download_url || null,
    currentScore: enrollment ? (enrollment.computed_current_score ?? null) : null,
    finalScore:   enrollment ? (enrollment.computed_final_score   ?? null) : null,
    enrollmentState: enrollment ? (enrollment.enrollment_state || '') : '',
    accessRestricted: Boolean(raw.access_restricted_by_date),
    assignmentGroups: null,
  };
}

export function normalizeCourses(rawCourses, limit = 12) {
  return rawCourses
    // Keep a course if it has EITHER a name or a course_code (the normalizeCourse fallback
    // turns a code-only course into a usable labelled course). Previously required c.name,
    // which dropped code-only courses at ingest.
    .filter(c => (c.name || c.course_code) && !c.access_restricted_by_date)
    .slice(0, limit)
    .map(normalizeCourse);
}

// ─── Assignments ─────────────────────────────────────────────────────────────

export function normalizeAssignment(raw, courseMeta: any = {}) {
  const sub = raw.submission || {};
  return {
    id: raw.id,
    name: raw.name || '',
    description: raw.description || '',
    dueAt: raw.due_at || null,
    pointsPossible: raw.points_possible || 0,
    submissionTypes: raw.submission_types || [],
    hasRubric: Array.isArray(raw.rubric) && raw.rubric.length > 0,
    courseId: courseMeta.courseId ?? raw.course_id ?? null,
    courseCode: courseMeta.courseCode || '',
    courseName: courseMeta.courseName || '',
    submission: {
      submittedAt: sub.submitted_at || null,
      score: sub.score ?? null,
      missing: Boolean(sub.missing),
      late: Boolean(sub.late),
      submissionType: sub.submission_type || null,
      body: sub.body || null,
    },
  };
}

export function normalizeAssignments(rawAssignments, courseMeta = {}) {
  return rawAssignments.map(a => normalizeAssignment(a, courseMeta));
}

// ─── Submissions ─────────────────────────────────────────────────────────────

export function normalizeSubmission(raw) {
  const comments = (raw.submission_comments || [])
    .map(c => c.comment)
    .filter(Boolean);

  const rubricScores = [];
  if (raw.rubric_assessment) {
    Object.entries(raw.rubric_assessment).forEach(([critId, assessment]: [string, any]) => {
      const points = assessment.points ?? null;
      const comment = (assessment.comments || '').trim();
      const maxPoints = assessment._maxPoints ?? null;
      const pct = (points != null && maxPoints) ? Math.round((points / maxPoints) * 100) : null;
      rubricScores.push({
        criterionId: critId,
        criterionName: assessment._description || critId,
        points,
        maxPoints,
        pct,
        comment,
        praised:   pct != null && pct >= 85 && comment.length > 0,
        penalised: pct != null && pct < 70  && comment.length > 0,
      });
    });
  }

  const allFeedback = [comments.join(' | '), ...rubricScores.map(r => r.comment).filter(Boolean)]
    .filter(Boolean)
    .join(' || ');

  return {
    id: raw.id,
    assignmentId: raw.assignment_id,
    userId: raw.user_id,
    submittedAt: raw.submitted_at || null,
    score: raw.score ?? null,
    grade: raw.grade || null,
    body: (raw.body || '').replace(/<[^>]*>/g, ' ').replace(/\s+/g, ' ').trim(),
    submissionType: raw.submission_type || null,
    late: Boolean(raw.late),
    missing: Boolean(raw.missing),
    comments,
    rubricScores,
    feedback: allFeedback,
    attachments: (raw.attachments || []).map(att => ({
      id: att.id,
      filename: att.filename || att.display_name || '',
      url: att.url || '',
    })),
  };
}

// ─── Announcements ───────────────────────────────────────────────────────────

export function normalizeAnnouncement(raw) {
  return {
    id: raw.id,
    title: raw.title || '',
    body: (raw.message || '').replace(/<[^>]*>/g, ' ').replace(/\s+/g, ' ').trim(),
    postedAt: raw.posted_at || null,
    authorName: raw.author ? (raw.author.display_name || '') : '',
    courseCode: raw.context_code || '',
  };
}

export function normalizeAnnouncements(rawAnnouncements) {
  return rawAnnouncements
    .map(normalizeAnnouncement)
    .sort((a, b) => +new Date(b.postedAt || 0) - +new Date(a.postedAt || 0));
}

// ─── Conversations / Inbox ────────────────────────────────────────────────────

export function normalizeConversationSummary(raw) {
  return {
    id: raw.id,
    subject: raw.subject || '(no subject)',
    courseName: raw.context_name || '',
    preview: (raw.last_message || '').replace(/<[^>]*>/g, ' ').replace(/&nbsp;/g, ' ').replace(/\s+/g, ' ').trim().substring(0, 300),
    lastAuthor: raw.last_authored_message_at ? (raw.participants?.[0]?.name || '') : '',
    messageCount: raw.message_count || 0,
    hasUnread: Boolean(raw.unread),
  };
}

export function normalizeConversation(raw) {
  return {
    id: raw.id,
    subject: raw.subject || '(no subject)',
    courseName: raw.context_name || '',
    messages: (raw.messages || []).map(m => ({
      id: m.id,
      authorName: m.author ? (m.author.name || '') : '',
      body: (m.body || '').replace(/<[^>]*>/g, ' ').replace(/\s+/g, ' ').trim(),
      createdAt: m.created_at || null,
    })),
  };
}

// ─── Modules & Pages ─────────────────────────────────────────────────────────

export function normalizeModule(raw) {
  return {
    id: raw.id,
    name: raw.name || '',
    items: (raw.items || []).map(it => ({
      id: it.id,
      title: it.title || '',
      type: it.type || '',
      url: it.url || null,
      htmlUrl: it.html_url || null,
      contentId: it.content_id || null,
    })),
  };
}

export function normalizePage(raw) {
  return {
    id: raw.page_id || raw.id,
    title: raw.title || '',
    slug: raw.url || '',
    body: (raw.body || '').replace(/<[^>]*>/g, ' ').replace(/\s+/g, ' ').trim(),
    updatedAt: raw.updated_at || null,
  };
}

// ─── Discussion Topics ────────────────────────────────────────────────────────

export function normalizeDiscussionTopic(raw) {
  return {
    id: raw.id,
    title: raw.title || '',
    message: (raw.message || '').replace(/<[^>]*>/g, ' ').replace(/\s+/g, ' ').trim().substring(0, 500),
    postedAt: raw.posted_at || null,
    lastReplyAt: raw.last_reply_at || null,
  };
}

// ─── Assignment Groups (grade weights) ───────────────────────────────────────

export function normalizeAssignmentGroup(raw) {
  return {
    id: raw.id,
    name: raw.name || '',
    weight: raw.group_weight || 0,
    assignmentIds: (raw.assignments || []).map(a => a.id),
  };
}

// ─── User Groups ─────────────────────────────────────────────────────────────

export function normalizeUserGroup(raw) {
  return {
    id: raw.id,
    name: raw.name || '',
    courseId: raw.course_id || null,
    description: raw.description || '',
  };
}

// ─── Course Files (slides, PDFs, docs) ───────────────────────────────────────

export function normalizeCourseFile(raw) {
  return {
    id: raw.id,
    filename: raw.display_name || raw.filename || '',
    contentType: raw.content_type || '',
    size: raw.size || 0,
    url: raw.url || null,
    updatedAt: raw.updated_at || null,
    folderId: raw.folder_id || null,
  };
}

export function normalizeCourseFiles(rawFiles) {
  return rawFiles.map(normalizeCourseFile);
}

// ─── Course Pages ─────────────────────────────────────────────────────────────

export function normalizeCoursePageSummary(raw) {
  return {
    id: raw.page_id || raw.url,
    title: raw.title || '',
    slug: raw.url || '',
    updatedAt: raw.updated_at || null,
    editedBy: raw.last_edited_by?.display_name || null,
  };
}

// ─── Quizzes ─────────────────────────────────────────────────────────────────

export function normalizeQuiz(raw) {
  return {
    id: raw.id,
    title: raw.title || '',
    dueAt: raw.due_at || null,
    pointsPossible: raw.points_possible || 0,
    questionCount: raw.question_count || 0,
    timeLimit: raw.time_limit || null,
    quizType: raw.quiz_type || '',
  };
}

// ─── Past Courses ─────────────────────────────────────────────────────────────

export function normalizePastCourse(raw) {
  const enrollment = Array.isArray(raw.enrollments) ? raw.enrollments[0] : null;
  // Extract semester from course name or course_code e.g. "Fall 2024", "Winter 2025"
  const semesterMatch = (raw.name || raw.course_code || '').match(/(fall|winter|spring|summer)\s*(20\d{2})/i);
  const semester = semesterMatch
    ? `${semesterMatch[1].charAt(0).toUpperCase() + semesterMatch[1].slice(1).toLowerCase()} ${semesterMatch[2]}`
    : (enrollment?.enrollment_state === 'completed' ? 'Past' : '');
  return {
    id: raw.id,
    name: raw.name || raw.course_code || raw.original_name || '',
    courseCode: raw.course_code || raw.name || '',
    professor: extractProfessor(raw),
    imageUrl: raw.image_download_url || null,
    finalScore: enrollment ? (enrollment.computed_final_score ?? null) : null,
    enrollmentState: 'completed',
    semester,
    accessRestricted: Boolean(raw.access_restricted_by_date),
  };
}

export function normalizePastCourses(rawCourses, limit = 20) {
  return rawCourses
    .filter(c => (c.name || c.course_code) && !c.access_restricted_by_date)
    .slice(0, limit)
    .map(normalizePastCourse);
}
