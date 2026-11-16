-- Cloudflare-hosted quiz platform schema.
-- Public clients never query these tables directly. The Worker validates
-- Supabase Auth users and performs server-side writes with its service key.

create extension if not exists pgcrypto;

create table if not exists public.quizzes (
  id uuid primary key default gen_random_uuid(),
  owner_id uuid not null unique references auth.users(id) on delete cascade,
  title text not null check (char_length(title) between 3 and 100),
  max_participants smallint not null default 50 check (max_participants between 1 and 200),
  global_time_limit smallint not null default 20 check (global_time_limit between 5 and 120),
  questions jsonb not null default '[]'::jsonb check (jsonb_typeof(questions) = 'array'),
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now()
);

create table if not exists public.rooms (
  pin char(6) primary key check (pin ~ '^[0-9]{6}$'),
  quiz_id uuid not null references public.quizzes(id) on delete restrict,
  host_id uuid not null references auth.users(id) on delete cascade,
  title text not null check (char_length(title) between 3 and 100),
  max_participants smallint not null check (max_participants between 1 and 200),
  status text not null default 'lobby' check (status in ('lobby', 'running', 'finished', 'cancelled')),
  created_at timestamptz not null default now(),
  started_at timestamptz,
  finished_at timestamptz
);

create index if not exists rooms_host_created_idx on public.rooms (host_id, created_at desc);
create index if not exists rooms_status_created_idx on public.rooms (status, created_at desc);

create table if not exists public.room_participants (
  id uuid primary key,
  room_pin char(6) not null references public.rooms(pin) on delete cascade,
  nickname text not null check (char_length(nickname) between 2 and 20),
  score integer not null default 0 check (score >= 0),
  joined_at timestamptz not null default now(),
  unique (room_pin, id)
);

create unique index if not exists room_participants_nickname_unique_idx
  on public.room_participants (room_pin, lower(nickname));
create index if not exists room_participants_room_score_idx
  on public.room_participants (room_pin, score desc);

create table if not exists public.room_answers (
  id bigint generated always as identity primary key,
  room_pin char(6) not null references public.rooms(pin) on delete cascade,
  participant_id uuid not null references public.room_participants(id) on delete cascade,
  question_index smallint not null check (question_index >= 0),
  answer text not null check (char_length(answer) between 1 and 200),
  is_correct boolean not null,
  score_awarded integer not null default 0 check (score_awarded >= 0),
  submitted_at timestamptz not null default now(),
  unique (room_pin, participant_id, question_index)
);

create index if not exists room_answers_room_question_idx
  on public.room_answers (room_pin, question_index);

create table if not exists public.quiz_results (
  room_pin char(6) primary key references public.rooms(pin) on delete cascade,
  host_id uuid not null references auth.users(id) on delete cascade,
  leaderboard jsonb not null check (jsonb_typeof(leaderboard) = 'array'),
  rounds jsonb not null check (jsonb_typeof(rounds) = 'array'),
  completed_at timestamptz not null default now()
);

create index if not exists quiz_results_host_completed_idx
  on public.quiz_results (host_id, completed_at desc);

alter table public.quizzes enable row level security;
alter table public.rooms enable row level security;
alter table public.room_participants enable row level security;
alter table public.room_answers enable row level security;
alter table public.quiz_results enable row level security;

revoke all on public.quizzes, public.rooms, public.room_participants, public.room_answers, public.quiz_results from anon;
revoke all on sequence public.room_answers_id_seq from anon;

drop policy if exists "Owners manage their quizzes" on public.quizzes;
create policy "Owners manage their quizzes" on public.quizzes
  for all to authenticated
  using (owner_id = (select auth.uid()))
  with check (owner_id = (select auth.uid()));

drop policy if exists "Hosts read their rooms" on public.rooms;
create policy "Hosts read their rooms" on public.rooms
  for select to authenticated
  using (host_id = (select auth.uid()));

drop policy if exists "Hosts read their participants" on public.room_participants;
create policy "Hosts read their participants" on public.room_participants
  for select to authenticated
  using (exists (
    select 1 from public.rooms r
    where r.pin = room_participants.room_pin and r.host_id = (select auth.uid())
  ));

drop policy if exists "Hosts read their answers" on public.room_answers;
create policy "Hosts read their answers" on public.room_answers
  for select to authenticated
  using (exists (
    select 1 from public.rooms r
    where r.pin = room_answers.room_pin and r.host_id = (select auth.uid())
  ));

drop policy if exists "Hosts read their results" on public.quiz_results;
create policy "Hosts read their results" on public.quiz_results
  for select to authenticated
  using (host_id = (select auth.uid()));

grant select, insert, update, delete on public.quizzes to authenticated;
grant select on public.rooms, public.room_participants, public.room_answers, public.quiz_results to authenticated;
grant all on public.quizzes, public.rooms, public.room_participants, public.room_answers, public.quiz_results to service_role;
grant usage, select on sequence public.room_answers_id_seq to service_role;
