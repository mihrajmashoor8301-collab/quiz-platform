-- Local-first schema for the personal live quiz platform.
-- Applied with `pg` by src/db/init.js; there is no migration tooling.
-- `id` columns are sequential bigints so test seeds keep stable ids.
-- All arrays are `text[]` (Supabase JSONB is equivalent for the app).

CREATE SCHEMA IF NOT EXISTS public;

GRANT USAGE ON SCHEMA public TO quiz_app;

-- Participants in a live room: users table holds hosts (Supabase Auth)
-- and guests (nickname only).
CREATE TABLE IF NOT EXISTS users (
  id          bigserial PRIMARY KEY,
  nickname    text NOT NULL,
  email       text NULL,
  role        text NOT NULL DEFAULT 'participant',
  room_id     bigint NULL,
  created_at  timestamptz NOT NULL DEFAULT now()
);

-- Live rooms. `status` drives what participants may do:
-- queued/running accepts submissions, paused only lets the host edit,
-- finished shows results.
CREATE TABLE IF NOT EXISTS rooms (
  id             bigserial PRIMARY KEY,
  pin            text NOT NULL CHECK (char_length(pin) = 6),
  host_id        bigint REFERENCES users(id) ON DELETE RESTRICT,
  title          text NOT NULL,
  max_participants int8 CHECK (max_participants BETWEEN 1 AND 200) NOT NULL DEFAULT 200,
  current_participants int8 NOT NULL DEFAULT 0,
  status         text NOT NULL DEFAULT 'queued',
  started_at     timestamptz NULL,
  finished_at    timestamptz NULL,
  created_at     timestamptz NOT NULL DEFAULT now(),
  UNIQUE (pin)
);

-- Questions and their accepted answers. `status` is set to `closed`
-- before scores are computed; `correct` is only read once closed.
CREATE TABLE IF NOT EXISTS questions (
  id             bigserial PRIMARY KEY,
  room_id        bigint REFERENCES rooms(id) ON DELETE CASCADE,
  creator_id     bigint REFERENCES users(id) ON DELETE RESTRICT,
  type           text NOT NULL CHECK (type IN ('mcq', 'poll', 'word_cloud')),
  question       jsonb NOT NULL,
  options        text[] NOT NULL,
  time_limit     int8 NULL,
  status         text NOT NULL DEFAULT 'queued',
  correct        text[] NULL,
  created_at     timestamptz NOT NULL DEFAULT now()
);

-- Answers to closed questions. One row per participant per question;
-- `valid` is computed server-side.
CREATE TABLE IF NOT EXISTS answers (
  id             bigserial PRIMARY KEY,
  question_id    bigint REFERENCES questions(id) ON DELETE CASCADE,
  participant_id bigint REFERENCES users(id) ON DELETE CASCADE,
  room_pin       text NOT NULL,
  answer         text NOT NULL,
  valid          boolean NOT NULL,
  created_at     timestamptz NOT NULL DEFAULT now(),
  UNIQUE (question_id, participant_id)
);

-- Submission log kept for the leaderboard and history. One row per
-- participant per question, whether or not the answer was valid.
CREATE TABLE IF NOT EXISTS submissions (
  id             bigserial PRIMARY KEY,
  question_id    bigint REFERENCES questions(id) ON DELETE CASCADE,
  participant_id bigint REFERENCES users(id) ON DELETE CASCADE,
  room_pin       text NOT NULL,
  answer         text NOT NULL,
  valid          boolean NOT NULL,
  score          float8 NULL,
  created_at     timestamptz NOT NULL DEFAULT now(),
  UNIQUE (question_id, participant_id)
);

-- Quiz history: final results per room.
CREATE TABLE IF NOT EXISTS archives (
  id             bigserial PRIMARY KEY,
  room_id        bigint REFERENCES rooms(id) ON DELETE CASCADE,
  data           jsonb NOT NULL,
  created_at     timestamptz NOT NULL DEFAULT now()
);

-- Indexes speed up the room-scoped lookups and the per-participant
-- "already answered" checks on the hot path.
CREATE INDEX IF NOT EXISTS idx_users_room_id ON users (room_id);
CREATE INDEX IF NOT EXISTS idx_rooms_pin ON rooms (pin);
CREATE INDEX IF NOT EXISTS idx_rooms_host_id ON rooms (host_id);
CREATE INDEX IF NOT EXISTS idx_questions_room ON questions (room_id, status);
CREATE INDEX IF NOT EXISTS idx_answers_question_participant ON answers (question_id, participant_id);
CREATE INDEX IF NOT EXISTS idx_submissions_question_participant ON submissions (question_id, participant_id);
CREATE INDEX IF NOT EXISTS idx_archives_room ON archives (room_id);
