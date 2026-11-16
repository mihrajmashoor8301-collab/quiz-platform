-- Host-owned reusable question banks. Bank questions retain the application's
-- existing MCQ JSON shape in question_data so quiz drafts can import them
-- without schema translation.

create table if not exists public.question_banks (
  id uuid primary key default gen_random_uuid(),
  host_id uuid not null references auth.users(id) on delete cascade,
  name text not null check (char_length(name) between 1 and 80),
  description text not null default '' check (char_length(description) <= 500),
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now(),
  unique (id, host_id)
);

create index if not exists question_banks_host_updated_idx
  on public.question_banks (host_id, updated_at desc);

create table if not exists public.bank_questions (
  id uuid primary key default gen_random_uuid(),
  bank_id uuid not null,
  host_id uuid not null references auth.users(id) on delete cascade,
  question_data jsonb not null check (jsonb_typeof(question_data) = 'object'),
  position integer not null default 0 check (position >= 0),
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now(),
  constraint bank_questions_bank_owner_fk
    foreign key (bank_id, host_id)
    references public.question_banks (id, host_id)
    on delete cascade
);

create index if not exists bank_questions_bank_position_idx
  on public.bank_questions (host_id, bank_id, position, id);

alter table public.question_banks enable row level security;
alter table public.bank_questions enable row level security;

revoke all on public.question_banks, public.bank_questions from anon;

drop policy if exists "Hosts manage their question banks" on public.question_banks;
create policy "Hosts manage their question banks" on public.question_banks
  for all to authenticated
  using (host_id = (select auth.uid()))
  with check (host_id = (select auth.uid()));

drop policy if exists "Hosts manage questions in their banks" on public.bank_questions;
create policy "Hosts manage questions in their banks" on public.bank_questions
  for all to authenticated
  using (
    host_id = (select auth.uid())
    and exists (
      select 1 from public.question_banks b
      where b.id = bank_questions.bank_id
        and b.host_id = (select auth.uid())
    )
  )
  with check (
    host_id = (select auth.uid())
    and exists (
      select 1 from public.question_banks b
      where b.id = bank_questions.bank_id
        and b.host_id = (select auth.uid())
    )
  );

grant select, insert, update, delete on public.question_banks, public.bank_questions to authenticated;
grant all on public.question_banks, public.bank_questions to service_role;
