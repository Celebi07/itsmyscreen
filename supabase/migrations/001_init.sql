create extension if not exists "pgcrypto";

create table if not exists public.polls (
  id uuid primary key default gen_random_uuid(),
  room_code text not null unique,
  question text not null,
  is_closed boolean not null default false,
  created_at timestamptz not null default now()
);

create table if not exists public.poll_options (
  id uuid primary key default gen_random_uuid(),
  poll_id uuid not null references public.polls(id) on delete cascade,
  text text not null,
  created_at timestamptz not null default now()
);

create table if not exists public.votes (
  id uuid primary key default gen_random_uuid(),
  poll_id uuid not null references public.polls(id) on delete cascade,
  option_id uuid not null references public.poll_options(id) on delete cascade,
  created_at timestamptz not null default now(),
  voter_hash text not null,
  ip_hash text not null,
  constraint votes_poll_voter_unique unique (poll_id, voter_hash)
);

create index if not exists votes_poll_id_idx on public.votes (poll_id);
create index if not exists votes_poll_option_idx on public.votes (poll_id, option_id);
create index if not exists votes_poll_ip_created_idx on public.votes (poll_id, ip_hash, created_at desc);

alter publication supabase_realtime add table public.votes;
