/**
 * canvasApi.js
 * All Canvas LMS API fetch functions.
 *
 * Each function accepts a `canvasToken` and a `baseUrl` and returns the raw
 * JSON response from the Canvas REST API with no transformation applied.
 * Pass the raw responses to canvasTransform.js for normalization.
 *
 * Pagination is handled transparently by `fetchAll` — callers always receive
 * the complete collection regardless of how many pages Canvas returns.
 *
 * CORS note: Canvas blocks direct browser requests from non-Canvas origins.
 * Route calls through the serverless proxy (proxy.js) in production.
 * The `proxyUrl` parameter in each function accepts a proxy base URL;
 * when omitted, requests go directly to `baseUrl` (works in Node.js / tests).
 */

import {
  CANVAS_PER_PAGE,
  CANVAS_REQUEST_TIMEOUT_MS,
} from './canvasConfig';

// ─── internal helpers ────────────────────────────────────────────────────────

function _resolveUrl(path, baseUrl, canvasToken, proxyUrl) {
  if (proxyUrl) {
    const params = new URLSearchParams({
      token: canvasToken,
      path,
      base: baseUrl,
    });
    return `${proxyUrl}?${params.toString()}`;
  }
  const full = baseUrl.replace(/\/+$/, '') + '/' + path.replace(/^\/+/, '');
  const sep = full.includes('?') ? '&' : '?';
  return `${full}${sep}access_token=${canvasToken}`;
}

export async function fetchOne(path, canvasToken, baseUrl, proxyUrl, extraHeaders = {}) {
  const url = _resolveUrl(path, baseUrl, canvasToken, proxyUrl);
  const controller = new AbortController();
  const timer = setTimeout(() => controller.abort(), CANVAS_REQUEST_TIMEOUT_MS);
  try {
    const response = await fetch(url, {
      headers: {
        Authorization: `Bearer ${canvasToken}`,
        Accept: 'application/json',
        ...extraHeaders,
      },
      signal: controller.signal,
    });
    if (!response.ok) {
      throw new Error(`Canvas API ${response.status} for ${path}`);
    }
    const data = await response.json();
    return { response, data };
  } finally {
    clearTimeout(timer);
  }
}

export async function fetchAll(path, canvasToken, baseUrl, proxyUrl, extraHeaders = {}) {
  const sep = path.includes('?') ? '&' : '?';
  let currentPath = `${path}${sep}per_page=${CANVAS_PER_PAGE}`;
  const all = [];

  while (currentPath) {
    const { response, data } = await fetchOne(
      currentPath, canvasToken, baseUrl, proxyUrl, extraHeaders
    );
    if (!Array.isArray(data)) return all;
    all.push(...data);

    const link = response.headers.get('Link') || '';
    const next = link.match(/<([^>]+)>;\s*rel="next"/);
    if (next) {
      currentPath = next[1]
        .replace(baseUrl, '')
        .replace(/[?&]access_token=[^&]+/g, '')
        .replace(/[?&]per_page=\d+/g, '');
    } else {
      currentPath = null;
    }
  }

  return all;
}

// ─── public API functions ────────────────────────────────────────────────────

export async function fetchCurrentUser(canvasToken, baseUrl, proxyUrl) {
  const { data } = await fetchOne('/users/self', canvasToken, baseUrl, proxyUrl);
  return data;
}

export async function fetchUserGroups(canvasToken, baseUrl, proxyUrl) {
  return fetchAll('/users/self/groups', canvasToken, baseUrl, proxyUrl);
}

export async function fetchCourses(canvasToken, baseUrl, proxyUrl) {
  // Some Canvas instances return 500 on specific includes (commonly
  // current_grading_period_scores, or course_image when the account feature
  // is off). A single failing include must not kill the entire sync, so try
  // progressively simpler include sets until one succeeds.
  // include[]=teachers rides through the /api/canvas proxy passthrough and makes Canvas
  // return a per-course teachers:[{id,display_name}] array. Keep teachers-free fallbacks so
  // an instance that 500s on the teachers include still syncs (professor just comes back null).
  const includeSets = [
    'include[]=total_scores&include[]=current_grading_period_scores&include[]=course_image&include[]=teachers',
    'include[]=total_scores&include[]=course_image&include[]=teachers',
    'include[]=total_scores&include[]=teachers',
    'include[]=teachers',
    'include[]=total_scores',
    '',
  ];
  for (const includes of includeSets) {
    try {
      const q = includes ? `&${includes}` : '';
      let courses = await fetchAll(
        `/courses?enrollment_state=active${q}`,
        canvasToken, baseUrl, proxyUrl
      );
      if (!courses.length) {
        courses = await fetchAll(
          `/courses${includes ? `?${includes}` : ''}`,
          canvasToken, baseUrl, proxyUrl
        );
      }
      return courses;
    } catch {
      // fall through to the next, simpler include set
    }
  }
  return [];
}

export async function fetchAssignments(canvasToken, baseUrl, courseId, proxyUrl) {
  return fetchAll(
    `/courses/${courseId}/assignments?include[]=submission&include[]=rubric_settings&order_by=due_at`,
    canvasToken, baseUrl, proxyUrl
  );
}

export async function fetchSubmission(
  canvasToken, baseUrl, courseId, assignmentId,
  { includeComments = true, includeRubric = false } = {},
  proxyUrl
) {
  const extras = [
    includeComments ? 'include[]=submission_comments' : '',
    includeRubric  ? 'include[]=rubric_assessment'   : '',
  ].filter(Boolean).join('&');
  const path = `/courses/${courseId}/assignments/${assignmentId}/submissions/self${extras ? `?${extras}` : ''}`;
  const { data } = await fetchOne(path, canvasToken, baseUrl, proxyUrl);
  return data;
}

export async function fetchAnnouncements(canvasToken, baseUrl, courseIds, proxyUrl) {
  const ctx = courseIds.map(id => `context_codes[]=course_${id}`).join('&');
  return fetchAll(`/announcements?${ctx}`, canvasToken, baseUrl, proxyUrl);
}

export async function fetchConversations(canvasToken, baseUrl, scope = 'inbox', proxyUrl) {
  return fetchAll(`/conversations?scope=${scope}`, canvasToken, baseUrl, proxyUrl);
}

export async function fetchConversation(canvasToken, baseUrl, conversationId, proxyUrl) {
  const { data } = await fetchOne(`/conversations/${conversationId}`, canvasToken, baseUrl, proxyUrl);
  return data;
}

export async function fetchModules(canvasToken, baseUrl, courseId, proxyUrl) {
  return fetchAll(
    `/courses/${courseId}/modules?include[]=items`,
    canvasToken, baseUrl, proxyUrl
  );
}

export async function fetchPage(canvasToken, baseUrl, courseId, pageSlug, proxyUrl) {
  const { data } = await fetchOne(
    `/courses/${courseId}/pages/${pageSlug}`,
    canvasToken, baseUrl, proxyUrl
  );
  return data;
}

export async function fetchDiscussionTopics(canvasToken, baseUrl, courseId, proxyUrl) {
  return fetchAll(
    `/courses/${courseId}/discussion_topics?order_by=recent_activity`,
    canvasToken, baseUrl, proxyUrl
  );
}

export async function fetchAssignmentGroups(canvasToken, baseUrl, courseId, proxyUrl) {
  return fetchAll(
    `/courses/${courseId}/assignment_groups?include[]=assignments&include[]=group_weight`,
    canvasToken, baseUrl, proxyUrl
  );
}

/** Fetch all past/completed courses (previous semesters) */
export async function fetchPastCourses(canvasToken, baseUrl, proxyUrl) {
  const includeSets = [
    'include[]=total_scores&include[]=course_image',
    'include[]=total_scores',
    '',
  ];
  for (const includes of includeSets) {
    try {
      return await fetchAll(
        `/courses?enrollment_state=completed${includes ? `&${includes}` : ''}`,
        canvasToken, baseUrl, proxyUrl
      );
    } catch {
      // try a simpler include set
    }
  }
  return [];
}

/** Fetch files for a course — filters to slides, PDFs, and docs */
export async function fetchCourseFiles(canvasToken, baseUrl, courseId, proxyUrl) {
  return fetchAll(
    `/courses/${courseId}/files?content_types[]=application/pdf&content_types[]=application/vnd.ms-powerpoint&content_types[]=application/vnd.openxmlformats-officedocument.presentationml.presentation&content_types[]=application/msword&content_types[]=application/vnd.openxmlformats-officedocument.wordprocessingml.document&sort=updated_at&order=desc`,
    canvasToken, baseUrl, proxyUrl
  );
}

/** Fetch all pages for a course (lecture notes, reading pages, syllabus) */
export async function fetchCoursePages(canvasToken, baseUrl, courseId, proxyUrl) {
  return fetchAll(
    `/courses/${courseId}/pages?sort=updated_at&order=desc`,
    canvasToken, baseUrl, proxyUrl
  );
}

/** Fetch quizzes for a course */
export async function fetchQuizzes(canvasToken, baseUrl, courseId, proxyUrl) {
  return fetchAll(
    `/courses/${courseId}/quizzes`,
    canvasToken, baseUrl, proxyUrl
  );
}
