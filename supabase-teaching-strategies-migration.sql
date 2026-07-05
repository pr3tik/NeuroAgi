-- Study Room "shared wisdom" pattern-recognition layer.
-- Stores de-identified teaching methods (never a specific student's data) so a
-- resolved concept can help a different, similarly-responsive student later.
-- strategy_kind matches an evidence-ranked taxonomy of learning techniques
-- (Dunlosky et al. 2013-style: retrieval practice, spaced practice, elaborative
-- interrogation, etc.), not a fixed "learning style" label — matching content to
-- a stated learning style has no solid research support (Pashler et al. 2008).
-- Per-student personalization instead comes from student_strategy_affinity, an
-- empirical track record, not from grouping students into archetypes.

create extension if not exists vector;

-- ── teaching_strategies — the identity-free "recipe box" ──────────────────
-- No user_id, no room_id, no raw transcript text. By construction.
create table if not exists public.teaching_strategies (
  strategy_id       uuid primary key default gen_random_uuid(),
  concept           text not null,
  concept_embedding vector(1536),                -- same embedder as RAG (text-embedding-3-small)
  strategy_kind     text not null,                -- retrieval_practice | elaborative_interrogation |
                                                   -- self_explanation | concrete_example | dual_coding |
                                                   -- interleaving | spaced_callback
  strategy_summary  text not null,                -- de-identified method description
  success_count     int not null default 0,
  attempt_count     int not null default 1,
  last_used_at      timestamptz,
  created_at        timestamptz default now()
);

-- Deliberately NO approximate-search index (hnsw/ivfflat) yet: this pool starts
-- small, and exact cosine search (`order by concept_embedding <=> $query`) is
-- both fast enough and always exactly correct at this scale — no recall
-- trade-off to accept. Add an approximate index later only once row count
-- actually justifies it (tens of thousands+ rows).
create index if not exists teaching_strategies_kind_idx on public.teaching_strategies (strategy_kind);

-- ── student_strategy_affinity — per-student, per-technique track record ───
-- The "trait" signal: an observed fact about ONE student's own history, never
-- compared against or exposed to any other student. Replaces an earlier
-- "trait_bucket"/archetype design (see note above on learning-styles matching)
-- with personalized, empirical technique effectiveness.
create table if not exists public.student_strategy_affinity (
  user_id       text not null references public.users(id) on delete cascade,
  strategy_kind text not null,
  success_count int not null default 0,
  attempt_count int not null default 0,
  updated_at    timestamptz default now(),
  primary key (user_id, strategy_kind)
);

-- ── strategy_provenance — identity, quarantined for erasure only ──────────
-- The read path (context assembly, matching) must NEVER join this table — it
-- exists solely so a student's contributions can be deleted on request.
create table if not exists public.strategy_provenance (
  strategy_id uuid references public.teaching_strategies(strategy_id) on delete cascade,
  user_id     text not null references public.users(id) on delete cascade,
  created_at  timestamptz default now()
);
create index if not exists strategy_provenance_user_idx on public.strategy_provenance (user_id);

-- RLS-off + service-key pattern, matching every other table in this app.
alter table public.teaching_strategies       disable row level security;
alter table public.student_strategy_affinity disable row level security;
alter table public.strategy_provenance       disable row level security;

-- ── harvest_teaching_strategy — find-and-reinforce OR insert, atomically ──
-- Used on write: when a concept resolves, either strengthen an existing very
-- similar card (same technique, same concept) or insert a new one — as one
-- locked transaction, so two concurrent sessions resolving the same concept
-- can't race each other into a lost update or a duplicate row. Returns the
-- resulting strategy_id either way.
create or replace function public.harvest_teaching_strategy(
  p_concept           text,
  p_concept_embedding vector(1536),
  p_strategy_kind     text,
  p_strategy_summary  text,
  p_max_distance      double precision default 0.15
)
returns uuid
language plpgsql
as $$
declare
  v_id uuid;
begin
  select strategy_id into v_id
  from public.teaching_strategies
  where strategy_kind = p_strategy_kind
    and concept_embedding is not null
    and (concept_embedding <=> p_concept_embedding) < p_max_distance
  order by concept_embedding <=> p_concept_embedding
  limit 1
  for update;

  if v_id is not null then
    update public.teaching_strategies
    set success_count = success_count + 1,
        attempt_count = attempt_count + 1,
        last_used_at  = now()
    where strategy_id = v_id;
  else
    insert into public.teaching_strategies
      (concept, concept_embedding, strategy_kind, strategy_summary, success_count, attempt_count, last_used_at)
    values
      (p_concept, p_concept_embedding, p_strategy_kind, p_strategy_summary, 1, 1, now())
    returning strategy_id into v_id;
  end if;

  return v_id;
end;
$$;

-- ── bump_student_strategy_affinity — atomic increment, not overwrite ─────
-- A plain PostgREST upsert (Prefer: resolution=merge-duplicates) would SET
-- the given columns on conflict, wiping out prior counts. This does a real
-- increment via ON CONFLICT DO UPDATE with the existing row's own value.
create or replace function public.bump_student_strategy_affinity(
  p_user_id       text,
  p_strategy_kind text,
  p_success       boolean
)
returns void
language sql
as $$
  insert into public.student_strategy_affinity (user_id, strategy_kind, success_count, attempt_count, updated_at)
  values (p_user_id, p_strategy_kind, case when p_success then 1 else 0 end, 1, now())
  on conflict (user_id, strategy_kind) do update set
    success_count = public.student_strategy_affinity.success_count + excluded.success_count,
    attempt_count = public.student_strategy_affinity.attempt_count + excluded.attempt_count,
    updated_at    = now();
$$;

-- ── find_teaching_strategy_hint — the read-side match ─────────────────────
-- Used when a student asks about a concept: find candidate cards, ranked by
-- (1) this specific student's own personal success rate with that technique
-- if they have history, (2) the card's global success rate, (3) closeness.
-- No cross-student comparison happens here — p_user_id only looks up that
-- one student's own affinity row, never another student's.
--
-- p_max_distance = 0.45, empirically measured (not guessed): a stored concept
-- phrase ("Binary Search Tree structure and search mechanism") vs. a real,
-- colloquially-phrased student question about the same topic ("Can you explain
-- how binary search trees work? I don't get them.") sits at ~0.32 cosine
-- distance — the original 0.25 default rejected every realistic match. A
-- genuinely different-but-related topic (hash tables vs. BSTs) sits at ~0.69,
-- and unrelated domains (history, chemistry) sit at ~0.94+. 0.45 sits with
-- comfortable margin above the real "same topic" cases and well below the
-- nearest false-positive risk.
create or replace function public.find_teaching_strategy_hint(
  p_concept_embedding vector(1536),
  p_user_id           text,
  p_max_distance      double precision default 0.45,
  p_limit             int default 3
)
returns table (
  strategy_id      uuid,
  strategy_kind    text,
  strategy_summary text,
  global_rate      double precision,
  personal_rate    double precision,
  distance         double precision
)
language sql stable
as $$
  select
    ts.strategy_id,
    ts.strategy_kind,
    ts.strategy_summary,
    (ts.success_count::double precision / greatest(ts.attempt_count, 1)) as global_rate,
    coalesce(sa.success_count::double precision / nullif(sa.attempt_count, 0), null) as personal_rate,
    (ts.concept_embedding <=> p_concept_embedding) as distance
  from public.teaching_strategies ts
  left join public.student_strategy_affinity sa
    on sa.user_id = p_user_id and sa.strategy_kind = ts.strategy_kind
  where ts.concept_embedding is not null
    and (ts.concept_embedding <=> p_concept_embedding) < p_max_distance
  order by
    coalesce(sa.success_count::double precision / nullif(sa.attempt_count, 0), 0) desc,
    (ts.success_count::double precision / greatest(ts.attempt_count, 1)) desc,
    (ts.concept_embedding <=> p_concept_embedding) asc
  limit p_limit;
$$;

notify pgrst, 'reload schema';
