-- OurTube private two-person connections.
-- The public functions at the bottom are the only supported lifecycle mutation API.

begin;

create schema if not exists extensions;
create extension if not exists pgcrypto with schema extensions;
create schema if not exists private;

revoke all on schema private from public;

create table private.connection_system_config (
  singleton boolean primary key default true check (singleton),
  code_ttl interval not null default interval '24 hours'
    check (code_ttl >= interval '1 minute' and code_ttl <= interval '30 days'),
  code_generation_limit integer not null default 10 check (code_generation_limit between 1 and 100),
  code_generation_window interval not null default interval '1 hour'
    check (code_generation_window between interval '1 minute' and interval '1 day'),
  join_attempt_limit integer not null default 10 check (join_attempt_limit between 1 and 100),
  join_window interval not null default interval '10 minutes'
    check (join_window between interval '1 minute' and interval '1 day'),
  join_block interval not null default interval '15 minutes'
    check (join_block between interval '1 minute' and interval '1 day')
);

insert into private.connection_system_config (singleton, code_ttl)
values (true, interval '24 hours')
on conflict (singleton) do nothing;

create table private.connection_join_attempts (
  user_id uuid primary key references auth.users (id) on delete cascade,
  window_started_at timestamptz not null default statement_timestamp(),
  attempts integer not null default 0 check (attempts >= 0),
  blocked_until timestamptz,
  last_attempt_at timestamptz not null default statement_timestamp()
);

create index connection_join_attempts_cleanup_idx
  on private.connection_join_attempts (last_attempt_at);

create table private.content_quota_config (
  operation text primary key check (operation in ('message', 'reaction', 'favorite')),
  user_rate_limit integer not null check (user_rate_limit between 1 and 10000),
  connection_rate_limit integer not null check (connection_rate_limit between 1 and 20000),
  rate_window interval not null check (rate_window between interval '1 second' and interval '1 day'),
  connection_row_limit integer not null check (connection_row_limit between 1 and 1000000),
  check (connection_rate_limit >= user_rate_limit)
);

insert into private.content_quota_config
  (operation, user_rate_limit, connection_rate_limit, rate_window, connection_row_limit)
values
  ('message', 30, 60, interval '1 minute', 10000),
  ('reaction', 60, 120, interval '1 minute', 20000),
  ('favorite', 20, 40, interval '1 minute', 1000)
on conflict (operation) do nothing;

create table private.content_mutation_counters (
  operation text not null references private.content_quota_config (operation) on delete restrict,
  scope_kind text not null check (scope_kind in ('connection', 'user')),
  scope_id uuid not null,
  window_started_at timestamptz not null default clock_timestamp(),
  mutations integer not null default 0 check (mutations >= 0),
  last_mutation_at timestamptz not null default clock_timestamp(),
  primary key (operation, scope_kind, scope_id)
);

create index content_mutation_counters_cleanup_idx
  on private.content_mutation_counters (last_mutation_at);

comment on table private.connection_system_config is
  'Server-owned connection settings. Change code_ttl with an admin/service migration; clients have no access.';
comment on table private.content_quota_config is
  'Server-owned content rate and retained-row limits. Changes apply to subsequent RPC calls.';

create table public.profiles (
  id uuid primary key references auth.users (id) on delete cascade,
  email text,
  display_name text not null check (char_length(btrim(display_name)) between 1 and 120),
  avatar_url text check (
    avatar_url is null or (
      char_length(avatar_url) <= 2048
      and avatar_url ~* '^https://([a-z0-9-]+[.])*googleusercontent[.]com/'
    )
  ),
  created_at timestamptz not null default statement_timestamp(),
  updated_at timestamptz not null default statement_timestamp()
);

create table public.connections (
  id uuid primary key default extensions.gen_random_uuid(),
  status text not null default 'pending'
    check (status in ('pending', 'connected', 'cancelled', 'expired', 'disconnected')),
  created_by uuid not null references auth.users (id) on delete restrict,
  created_at timestamptz not null default statement_timestamp(),
  connected_at timestamptz,
  disconnected_at timestamptz,
  updated_at timestamptz not null default statement_timestamp(),
  constraint connections_status_timestamps_check check (
    (status = 'pending' and connected_at is null and disconnected_at is null)
    or (status in ('cancelled', 'expired') and connected_at is null and disconnected_at is null)
    or (status = 'connected' and connected_at is not null and disconnected_at is null)
    or (
      status = 'disconnected'
      and connected_at is not null
      and disconnected_at is not null
      and disconnected_at >= connected_at
    )
  ),
  check (updated_at >= created_at),
  check (connected_at is null or connected_at >= created_at)
);

create table public.connection_codes (
  id uuid primary key default extensions.gen_random_uuid(),
  connection_id uuid not null unique references public.connections (id) on delete cascade,
  code text not null unique
    check (code ~ '^[ABCDEFGHJKMNPQRSTUVWXYZ23456789]{4}-[ABCDEFGHJKMNPQRSTUVWXYZ23456789]{4}$'),
  created_by uuid not null references auth.users (id) on delete restrict,
  expires_at timestamptz not null,
  used_at timestamptz,
  is_active boolean not null default true,
  created_at timestamptz not null default statement_timestamp(),
  check (expires_at > created_at),
  check (used_at is null or used_at >= created_at),
  check (used_at is null or not is_active)
);

create table public.connection_members (
  id uuid primary key default extensions.gen_random_uuid(),
  connection_id uuid not null references public.connections (id) on delete cascade,
  user_id uuid not null references auth.users (id) on delete restrict,
  member_slot smallint not null check (member_slot in (1, 2)),
  joined_at timestamptz not null default statement_timestamp(),
  left_at timestamptz,
  unique (connection_id, user_id),
  unique (connection_id, member_slot),
  check (left_at is null or left_at >= joined_at)
);

-- This partial unique index is the database-level one-active-connection rule.
-- Pending creators are active members too, so they cannot create/join elsewhere.
create unique index connection_members_one_active_connection_per_user
  on public.connection_members (user_id)
  where left_at is null;

create table public.conversations (
  id uuid primary key default extensions.gen_random_uuid(),
  connection_id uuid not null unique references public.connections (id) on delete cascade,
  created_at timestamptz not null default statement_timestamp(),
  updated_at timestamptz not null default statement_timestamp(),
  unique (id, connection_id)
);

create table public.messages (
  id uuid primary key default extensions.gen_random_uuid(),
  connection_id uuid not null references public.connections (id) on delete cascade,
  conversation_id uuid not null,
  sender_id uuid not null references auth.users (id) on delete restrict,
  type text not null check (type in ('text', 'video', 'short')),
  content text check (content is null or char_length(content) <= 4000),
  youtube_video_id text check (youtube_video_id is null or char_length(youtube_video_id) between 1 and 128),
  youtube_url text check (youtube_url is null or char_length(youtube_url) between 1 and 2048),
  metadata jsonb not null default '{}'::jsonb
    check (jsonb_typeof(metadata) = 'object' and pg_column_size(metadata) <= 16384),
  created_at timestamptz not null default statement_timestamp(),
  updated_at timestamptz not null default statement_timestamp(),
  foreign key (conversation_id, connection_id)
    references public.conversations (id, connection_id) on delete cascade,
  unique (id, connection_id),
  constraint messages_payload_check check (
    (type = 'text' and nullif(btrim(content), '') is not null
      and youtube_video_id is null and youtube_url is null)
    or (
      type in ('video', 'short')
      and youtube_video_id is not null
      and youtube_url is not null
      and youtube_video_id ~ '^[A-Za-z0-9_-]{11}$'
      and (
        (type = 'video' and youtube_url = ('https://www.youtube.com/watch?v=' || youtube_video_id))
        or (type = 'short' and youtube_url = ('https://www.youtube.com/shorts/' || youtube_video_id))
      )
    )
  )
);

create table public.message_reactions (
  id uuid primary key default extensions.gen_random_uuid(),
  connection_id uuid not null references public.connections (id) on delete cascade,
  message_id uuid not null,
  user_id uuid not null references auth.users (id) on delete restrict,
  reaction text not null check (
    reaction in ('LIKE', 'LOVE', 'LAUGH', 'WOW', 'SAD', 'FIRE', '👍', '❤️', '😂', '😮', '😢', '🔥')
  ),
  created_at timestamptz not null default statement_timestamp(),
  updated_at timestamptz not null default statement_timestamp(),
  foreign key (message_id, connection_id)
    references public.messages (id, connection_id) on delete cascade,
  unique (message_id, user_id)
);

create table public.favorites (
  id uuid primary key default extensions.gen_random_uuid(),
  connection_id uuid not null references public.connections (id) on delete cascade,
  created_by uuid not null references auth.users (id) on delete restrict,
  youtube_video_id text not null check (char_length(btrim(youtube_video_id)) between 1 and 128),
  youtube_url text not null check (char_length(btrim(youtube_url)) between 1 and 2048),
  type text not null check (type in ('video', 'short')),
  visibility text not null default 'private' check (visibility in ('private', 'shared')),
  created_at timestamptz not null default statement_timestamp(),
  updated_at timestamptz not null default statement_timestamp(),
  unique (connection_id, created_by, type, youtube_video_id),
  constraint favorites_media_check check (
    youtube_video_id ~ '^[A-Za-z0-9_-]{11}$'
    and (
      (type = 'video' and youtube_url = ('https://www.youtube.com/watch?v=' || youtube_video_id))
      or (type = 'short' and youtube_url = ('https://www.youtube.com/shorts/' || youtube_video_id))
    )
  )
);

create index connections_created_by_created_at_idx
  on public.connections (created_by, created_at desc);
create index connections_status_updated_at_idx
  on public.connections (status, updated_at desc);
create index connection_codes_lookup_idx
  on public.connection_codes (code) include (connection_id, created_by, expires_at, is_active, used_at);
create index connection_codes_creator_created_at_idx
  on public.connection_codes (created_by, created_at desc);
create index connection_members_connection_active_idx
  on public.connection_members (connection_id, member_slot) where left_at is null;
create index connection_members_user_history_idx
  on public.connection_members (user_id, joined_at desc);
create index messages_connection_created_at_idx
  on public.messages (connection_id, created_at desc);
create index messages_conversation_created_at_idx
  on public.messages (conversation_id, created_at desc);
create index message_reactions_connection_message_idx
  on public.message_reactions (connection_id, message_id);
create index favorites_connection_created_at_idx
  on public.favorites (connection_id, created_at desc);
create index favorites_owner_created_at_idx
  on public.favorites (created_by, created_at desc);

create function private.set_updated_at()
returns trigger
language plpgsql
security invoker
set search_path = ''
as $function$
begin
  new.updated_at := clock_timestamp();
  return new;
end;
$function$;


create trigger profiles_set_updated_at
before update on public.profiles
for each row execute function private.set_updated_at();
create trigger connections_set_updated_at
before update on public.connections
for each row execute function private.set_updated_at();
create trigger conversations_set_updated_at
before update on public.conversations
for each row execute function private.set_updated_at();
create trigger messages_set_updated_at
before update on public.messages
for each row execute function private.set_updated_at();
create trigger message_reactions_set_updated_at
before update on public.message_reactions
for each row execute function private.set_updated_at();
create trigger favorites_set_updated_at
before update on public.favorites
for each row execute function private.set_updated_at();

create function private.handle_new_auth_user()
returns trigger
language plpgsql
security definer
set search_path = ''
as $function$
begin
  insert into public.profiles (id, email, display_name, avatar_url)
  values (
    new.id,
    new.email,
    left(coalesce(
      nullif(btrim(new.raw_user_meta_data ->> 'full_name'), ''),
      nullif(btrim(new.raw_user_meta_data ->> 'name'), ''),
      nullif(split_part(coalesce(new.email, ''), '@', 1), ''),
      'OurTube user'
    ), 120),
    case
      when coalesce(new.raw_user_meta_data ->> 'avatar_url', new.raw_user_meta_data ->> 'picture', '')
        ~* '^https://([a-z0-9-]+[.])*googleusercontent[.]com/'
      then left(coalesce(new.raw_user_meta_data ->> 'avatar_url', new.raw_user_meta_data ->> 'picture'), 2048)
      else null
    end
  )
  on conflict (id) do nothing;
  return new;
end;
$function$;

create trigger ourtube_create_profile_after_signup
after insert on auth.users
for each row execute function private.handle_new_auth_user();

insert into public.profiles (id, email, display_name, avatar_url)
select
  u.id,
  u.email,
  left(coalesce(
    nullif(btrim(u.raw_user_meta_data ->> 'full_name'), ''),
    nullif(btrim(u.raw_user_meta_data ->> 'name'), ''),
    nullif(split_part(coalesce(u.email, ''), '@', 1), ''),
    'OurTube user'
  ), 120),
  case
    when coalesce(u.raw_user_meta_data ->> 'avatar_url', u.raw_user_meta_data ->> 'picture', '')
      ~* '^https://([a-z0-9-]+[.])*googleusercontent[.]com/'
    then left(coalesce(u.raw_user_meta_data ->> 'avatar_url', u.raw_user_meta_data ->> 'picture'), 2048)
    else null
  end
from auth.users u
on conflict (id) do nothing;

create function private.current_user_id()
returns uuid
language plpgsql
security invoker
stable
set search_path = ''
as $function$
declare
  v_user_id uuid := auth.uid();
  v_jwt jsonb := coalesce(auth.jwt(), '{}'::jsonb);
begin
  if v_user_id is null then
    raise exception using errcode = '42501', message = 'AUTH_REQUIRED';
  end if;
  if coalesce(v_jwt #>> '{app_metadata,provider}', '') <> 'google'
     and not (coalesce(v_jwt #> '{app_metadata,providers}', '[]'::jsonb) ? 'google') then
    raise exception using errcode = '42501', message = 'GOOGLE_AUTH_REQUIRED';
  end if;
  return v_user_id;
end;
$function$;

create function private.lock_user(p_user_id uuid)
returns void
language sql
security invoker
set search_path = ''
as $function$
  select pg_catalog.pg_advisory_xact_lock(
    pg_catalog.hashtextextended('ourtube:user:' || p_user_id::text, 9173)
  );
$function$;

create function private.lock_users(p_user_a uuid, p_user_b uuid)
returns void
language plpgsql
security invoker
set search_path = ''
as $function$
begin
  if p_user_a::text <= p_user_b::text then
    perform private.lock_user(p_user_a);
    if p_user_b <> p_user_a then perform private.lock_user(p_user_b); end if;
  else
    perform private.lock_user(p_user_b);
    perform private.lock_user(p_user_a);
  end if;
end;
$function$;

create function private.consume_join_attempt(p_user_id uuid)
returns integer
language plpgsql
security definer
set search_path = ''
as $function$
declare
  v_now timestamptz := clock_timestamp();
  v_attempt private.connection_join_attempts%rowtype;
  v_config private.connection_system_config%rowtype;
begin
  select * into strict v_config
  from private.connection_system_config cfg
  where cfg.singleton;

  insert into private.connection_join_attempts (user_id, window_started_at, attempts, last_attempt_at)
  values (p_user_id, v_now, 0, v_now)
  on conflict (user_id) do nothing;

  select * into strict v_attempt
  from private.connection_join_attempts a
  where a.user_id = p_user_id
  for update;

  v_now := clock_timestamp();

  if v_attempt.blocked_until is not null and v_attempt.blocked_until > v_now then
    update private.connection_join_attempts set last_attempt_at = v_now where user_id = p_user_id;
    return greatest(1, ceil(extract(epoch from (v_attempt.blocked_until - v_now)))::integer);
  end if;

  if v_attempt.blocked_until is not null then
    update private.connection_join_attempts
    set window_started_at = v_now, attempts = 1, blocked_until = null, last_attempt_at = v_now
    where user_id = p_user_id;
    return 0;
  end if;

  if v_attempt.window_started_at <= v_now - v_config.join_window then
    update private.connection_join_attempts
    set window_started_at = v_now, attempts = 1, blocked_until = null, last_attempt_at = v_now
    where user_id = p_user_id;
    return 0;
  end if;

  if v_attempt.attempts >= v_config.join_attempt_limit then
    update private.connection_join_attempts
    set attempts = attempts + 1,
        blocked_until = v_now + v_config.join_block,
        last_attempt_at = v_now
    where user_id = p_user_id;
    return greatest(1, ceil(extract(epoch from v_config.join_block))::integer);
  end if;

  update private.connection_join_attempts
  set attempts = attempts + 1, blocked_until = null, last_attempt_at = v_now
  where user_id = p_user_id;
  return 0;
end;
$function$;

create function private.consume_content_mutation(
  p_user_id uuid,
  p_connection_id uuid,
  p_operation text
)
returns table (retry_after_seconds integer, connection_row_limit integer)
language plpgsql
security definer
set search_path = ''
as $function$
declare
  v_now timestamptz := clock_timestamp();
  v_config private.content_quota_config%rowtype;
  v_user_window_started_at timestamptz;
  v_user_mutations integer;
  v_connection_window_started_at timestamptz;
  v_connection_mutations integer;
  v_user_retry integer := 0;
  v_connection_retry integer := 0;
begin
  select * into strict v_config
  from private.content_quota_config cfg
  where cfg.operation = p_operation;

  insert into private.content_mutation_counters
    (operation, scope_kind, scope_id, window_started_at, mutations, last_mutation_at)
  values
    (p_operation, 'connection', p_connection_id, v_now, 0, v_now),
    (p_operation, 'user', p_user_id, v_now, 0, v_now)
  on conflict (operation, scope_kind, scope_id) do nothing;

  -- Every caller locks the shared connection counter before its user counter. This
  -- serializes the connection-wide rate and storage checks without cross-user deadlocks.
  select counter.window_started_at, counter.mutations
  into strict v_connection_window_started_at, v_connection_mutations
  from private.content_mutation_counters counter
  where counter.operation = p_operation
    and counter.scope_kind = 'connection'
    and counter.scope_id = p_connection_id
  for update;

  select counter.window_started_at, counter.mutations
  into strict v_user_window_started_at, v_user_mutations
  from private.content_mutation_counters counter
  where counter.operation = p_operation
    and counter.scope_kind = 'user'
    and counter.scope_id = p_user_id
  for update;

  v_now := clock_timestamp();

  if v_connection_window_started_at <= v_now - v_config.rate_window then
    update private.content_mutation_counters
    set window_started_at = v_now, mutations = 0, last_mutation_at = v_now
    where operation = p_operation and scope_kind = 'connection' and scope_id = p_connection_id;
    v_connection_window_started_at := v_now;
    v_connection_mutations := 0;
  end if;

  if v_user_window_started_at <= v_now - v_config.rate_window then
    update private.content_mutation_counters
    set window_started_at = v_now, mutations = 0, last_mutation_at = v_now
    where operation = p_operation and scope_kind = 'user' and scope_id = p_user_id;
    v_user_window_started_at := v_now;
    v_user_mutations := 0;
  end if;

  if v_connection_mutations >= v_config.connection_rate_limit then
    v_connection_retry := greatest(
      1,
      ceil(extract(epoch from (
        v_connection_window_started_at + v_config.rate_window - v_now
      )))::integer
    );
  end if;
  if v_user_mutations >= v_config.user_rate_limit then
    v_user_retry := greatest(
      1,
      ceil(extract(epoch from (
        v_user_window_started_at + v_config.rate_window - v_now
      )))::integer
    );
  end if;

  if v_connection_retry > 0 or v_user_retry > 0 then
    update private.content_mutation_counters
    set last_mutation_at = v_now
    where operation = p_operation
      and (
        (scope_kind = 'connection' and scope_id = p_connection_id)
        or (scope_kind = 'user' and scope_id = p_user_id)
      );
    return query select greatest(v_connection_retry, v_user_retry), v_config.connection_row_limit;
    return;
  end if;

  update private.content_mutation_counters
  set mutations = mutations + 1, last_mutation_at = v_now
  where operation = p_operation
    and (
      (scope_kind = 'connection' and scope_id = p_connection_id)
      or (scope_kind = 'user' and scope_id = p_user_id)
    );

  return query select 0, v_config.connection_row_limit;
end;
$function$;

create function private.ensure_profile(p_user_id uuid)
returns void
language sql
security definer
set search_path = ''
as $function$
  insert into public.profiles (id, email, display_name, avatar_url)
  select
    u.id,
    u.email,
    left(coalesce(
      nullif(btrim(u.raw_user_meta_data ->> 'full_name'), ''),
      nullif(btrim(u.raw_user_meta_data ->> 'name'), ''),
      nullif(split_part(coalesce(u.email, ''), '@', 1), ''),
      'OurTube user'
    ), 120),
    case
      when coalesce(u.raw_user_meta_data ->> 'avatar_url', u.raw_user_meta_data ->> 'picture', '')
        ~* '^https://([a-z0-9-]+[.])*googleusercontent[.]com/'
      then left(coalesce(u.raw_user_meta_data ->> 'avatar_url', u.raw_user_meta_data ->> 'picture'), 2048)
      else null
    end
  from auth.users u
  where u.id = p_user_id
  on conflict (id) do nothing;
$function$;

create function private.generate_connection_code_value()
returns text
language plpgsql
security invoker
volatile
set search_path = ''
as $function$
declare
  v_alphabet constant text := 'ABCDEFGHJKMNPQRSTUVWXYZ23456789';
  v_alphabet_length constant integer := char_length(v_alphabet);
  v_cutoff constant integer := 256 - (256 % v_alphabet_length);
  v_random bytea;
  v_byte integer;
  v_result text := '';
  i integer;
begin
  while char_length(v_result) < 8 loop
    v_random := extensions.gen_random_bytes(16);
    for i in 0..15 loop
      v_byte := get_byte(v_random, i);
      if v_byte < v_cutoff then
        v_result := v_result || substr(v_alphabet, (v_byte % v_alphabet_length) + 1, 1);
        exit when char_length(v_result) = 8;
      end if;
    end loop;
  end loop;
  return substr(v_result, 1, 4) || '-' || substr(v_result, 5, 4);
end;
$function$;

create function private.is_active_connection_member(p_connection_id uuid)
returns boolean
language sql
security definer
stable
set search_path = ''
as $function$
  select exists (
    select 1
    from public.connection_members m
    join public.connections c on c.id = m.connection_id
    where m.connection_id = p_connection_id
      and m.user_id = auth.uid()
      and m.left_at is null
      and c.status in ('pending', 'connected')
  );
$function$;

create function private.is_connected_member(p_connection_id uuid)
returns boolean
language sql
security definer
stable
set search_path = ''
as $function$
  select exists (
    select 1
    from public.connection_members m
    join public.connections c on c.id = m.connection_id
    where m.connection_id = p_connection_id
      and m.user_id = auth.uid()
      and m.left_at is null
      and c.status = 'connected'
  );
$function$;

create function private.assert_connection_invariants()
returns trigger
language plpgsql
security definer
set search_path = ''
as $function$
declare
  v_connection_id uuid;
  v_connection public.connections%rowtype;
  v_active_members bigint;
  v_total_members bigint;
  v_creator_members bigint;
  v_active_codes bigint;
  v_used_codes bigint;
  v_code_count bigint;
  v_conversation_count bigint;
begin
  if tg_table_name = 'connections' then
    v_connection_id := case when tg_op = 'DELETE' then old.id else new.id end;
  else
    v_connection_id := case when tg_op = 'DELETE' then old.connection_id else new.connection_id end;
  end if;

  select * into v_connection
  from public.connections c
  where c.id = v_connection_id;

  if not found then return null; end if;

  select
    count(*),
    count(*) filter (where m.left_at is null),
    count(*) filter (where m.user_id = v_connection.created_by and m.left_at is null)
  into v_total_members, v_active_members, v_creator_members
  from public.connection_members m
  where m.connection_id = v_connection_id;

  select
    count(*),
    count(*) filter (where cc.is_active),
    count(*) filter (where cc.used_at is not null)
  into v_code_count, v_active_codes, v_used_codes
  from public.connection_codes cc
  where cc.connection_id = v_connection_id
    and cc.created_by = v_connection.created_by;

  select count(*) into v_conversation_count
  from public.conversations cv
  where cv.connection_id = v_connection_id;

  if exists (
    select 1 from public.connection_members m
    where m.connection_id = v_connection_id
      and ((m.member_slot = 1 and m.user_id <> v_connection.created_by)
        or (m.member_slot = 2 and m.user_id = v_connection.created_by))
  ) then
    raise exception using errcode = '23514', message = 'CONNECTION_MEMBER_SLOT_INVARIANT';
  end if;

  if v_code_count <> 1 then
    raise exception using errcode = '23514', message = 'CONNECTION_CODE_INVARIANT';
  end if;

  if v_connection.status = 'pending' then
    if v_total_members <> 1 or v_active_members <> 1 or v_creator_members <> 1
       or v_active_codes <> 1 or v_used_codes <> 0 or v_conversation_count <> 0 then
      raise exception using errcode = '23514', message = 'PENDING_CONNECTION_INVARIANT';
    end if;
  elsif v_connection.status = 'connected' then
    if v_total_members <> 2 or v_active_members <> 2 or v_creator_members <> 1
       or v_active_codes <> 0 or v_used_codes <> 1 or v_conversation_count <> 1 then
      raise exception using errcode = '23514', message = 'CONNECTED_CONNECTION_INVARIANT';
    end if;
  elsif v_connection.status in ('cancelled', 'expired') then
    if v_total_members <> 1 or v_active_members <> 0
       or v_active_codes <> 0 or v_used_codes <> 0 or v_conversation_count <> 0 then
      raise exception using errcode = '23514', message = 'TERMINAL_PENDING_CONNECTION_INVARIANT';
    end if;
  elsif v_connection.status = 'disconnected' then
    if v_total_members <> 2 or v_active_members <> 0
       or v_active_codes <> 0 or v_used_codes <> 1 or v_conversation_count <> 1 then
      raise exception using errcode = '23514', message = 'DISCONNECTED_CONNECTION_INVARIANT';
    end if;
  end if;

  return null;
end;
$function$;

create constraint trigger connections_assert_invariants
after insert or update or delete on public.connections
deferrable initially deferred for each row execute function private.assert_connection_invariants();
create constraint trigger connection_codes_assert_invariants
after insert or update or delete on public.connection_codes
deferrable initially deferred for each row execute function private.assert_connection_invariants();
create constraint trigger connection_members_assert_invariants
after insert or update or delete on public.connection_members
deferrable initially deferred for each row execute function private.assert_connection_invariants();
create constraint trigger conversations_assert_invariants
after insert or update or delete on public.conversations
deferrable initially deferred for each row execute function private.assert_connection_invariants();

create function private.expire_stale_connection_for_user(p_user_id uuid)
returns uuid
language plpgsql
security definer
set search_path = ''
as $function$
declare
  v_connection_id uuid;
  v_expires_at timestamptz;
  v_now timestamptz;
begin
  select c.id, cc.expires_at into v_connection_id, v_expires_at
  from public.connection_members m
  join public.connections c on c.id = m.connection_id
  join public.connection_codes cc on cc.connection_id = c.id
  where m.user_id = p_user_id
    and m.left_at is null
    and c.status = 'pending'
    and cc.used_at is null
  for update of c, cc, m;

  if v_connection_id is null then return null; end if;
  v_now := clock_timestamp();
  if v_expires_at > v_now then return null; end if;

  update public.connection_codes
  set is_active = false
  where connection_id = v_connection_id;

  update public.connections
  set status = 'expired'
  where id = v_connection_id;

  update public.connection_members
  set left_at = v_now
  where connection_id = v_connection_id and left_at is null;

  return v_connection_id;
end;
$function$;

create function private.connection_snapshot(p_user_id uuid, p_connection_id uuid default null)
returns jsonb
language plpgsql
security definer
volatile
set search_path = ''
as $function$
declare
  v_connection public.connections%rowtype;
  v_code public.connection_codes%rowtype;
  v_partner jsonb;
begin
  select c.* into v_connection
  from public.connections c
  join public.connection_members mine
    on mine.connection_id = c.id and mine.user_id = p_user_id
  where (p_connection_id is null or c.id = p_connection_id)
  order by
    (mine.left_at is null and c.status in ('pending', 'connected')) desc,
    coalesce(c.disconnected_at, c.updated_at, c.created_at) desc
  limit 1;

  if not found then
    return jsonb_build_object('state', 'NOT_CONNECTED', 'status', null);
  end if;

  if v_connection.created_by = p_user_id
     and v_connection.status in ('pending', 'expired', 'cancelled') then
    select cc.* into v_code
    from public.connection_codes cc
    where cc.connection_id = v_connection.id;
  end if;

  if v_connection.status in ('connected', 'disconnected') then
    select jsonb_build_object(
      'display_name', p.display_name,
      'name', p.display_name,
      'avatar_url', p.avatar_url
    ) into v_partner
    from public.connection_members other_member
    join public.profiles p on p.id = other_member.user_id
    where other_member.connection_id = v_connection.id
      and other_member.user_id <> p_user_id
    limit 1;
  end if;

  return jsonb_build_object(
    'state', upper(v_connection.status),
    'status', v_connection.status,
    'code', v_code.code,
    'expires_at', v_code.expires_at,
    'created_at', v_connection.created_at,
    'connected_at', v_connection.connected_at,
    'disconnected_at', v_connection.disconnected_at,
    'partner', v_partner
  );
end;
$function$;

create function private.generate_connection_code_impl()
returns jsonb
language plpgsql
security definer
set search_path = ''
as $function$
declare
  v_user_id uuid := private.current_user_id();
  v_connection_id uuid;
  v_existing_status text;
  v_code text;
  v_expires_at timestamptz;
  v_attempt integer;
  v_recent_generations integer;
  v_generation_limit integer;
  v_generation_window interval;
begin
  perform private.lock_user(v_user_id);
  perform private.ensure_profile(v_user_id);
  perform private.expire_stale_connection_for_user(v_user_id);

  select c.id, c.status into v_connection_id, v_existing_status
  from public.connection_members m
  join public.connections c on c.id = m.connection_id
  where m.user_id = v_user_id and m.left_at is null
  for update of c, m;

  if found then
    if v_existing_status = 'pending' then
      return private.connection_snapshot(v_user_id, v_connection_id);
    end if;
    raise exception using errcode = 'P0001', message = 'ALREADY_CONNECTED';
  end if;

  select cfg.code_generation_limit, cfg.code_generation_window
  into strict v_generation_limit, v_generation_window
  from private.connection_system_config cfg
  where cfg.singleton;
  select count(*)::integer into v_recent_generations
  from public.connections c
  where c.created_by = v_user_id
    and c.created_at > clock_timestamp() - v_generation_window;
  if v_recent_generations >= v_generation_limit then
    raise exception using errcode = 'P0001', message = 'RATE_LIMITED';
  end if;

  v_connection_id := extensions.gen_random_uuid();
  v_expires_at := clock_timestamp()
    + (select cfg.code_ttl from private.connection_system_config cfg where cfg.singleton);

  insert into public.connections (id, status, created_by)
  values (v_connection_id, 'pending', v_user_id);

  for v_attempt in 1..10 loop
    begin
      v_code := private.generate_connection_code_value();
      insert into public.connection_codes
        (connection_id, code, created_by, expires_at)
      values (v_connection_id, v_code, v_user_id, v_expires_at);
      exit;
    exception when unique_violation then
      if v_attempt = 10 then
        raise exception using errcode = 'P0001', message = 'CODE_GENERATION_FAILED';
      end if;
    end;
  end loop;

  insert into public.connection_members (connection_id, user_id, member_slot)
  values (v_connection_id, v_user_id, 1);

  return private.connection_snapshot(v_user_id, v_connection_id);
exception when unique_violation then
  raise exception using errcode = 'P0001', message = 'ALREADY_CONNECTED';
end;
$function$;

create function private.join_connection_by_code_impl(p_code text)
returns jsonb
language plpgsql
security definer
set search_path = ''
as $function$
declare
  v_user_id uuid := private.current_user_id();
  v_normalized_code text := upper(btrim(coalesce(p_code, '')));
  v_creator_id uuid;
  v_connection public.connections%rowtype;
  v_code public.connection_codes%rowtype;
  v_active_connection_id uuid;
  v_active_status text;
  v_member_count integer;
  v_retry_after integer;
  v_error_code text;
  v_now timestamptz;
begin
  v_retry_after := private.consume_join_attempt(v_user_id);
  if v_retry_after > 0 then
    return jsonb_build_object(
      'state', 'ERROR',
      'status', 'error',
      'error_code', 'RATE_LIMITED',
      'retry_after_seconds', v_retry_after
    );
  end if;

  begin
  if v_normalized_code !~ '^[ABCDEFGHJKMNPQRSTUVWXYZ23456789]{4}-[ABCDEFGHJKMNPQRSTUVWXYZ23456789]{4}$' then
    raise exception using errcode = 'P0001', message = 'CODE_NOT_FOUND';
  end if;

  select cc.created_by into v_creator_id
  from public.connection_codes cc
  where cc.code = v_normalized_code;
  if not found then
    raise exception using errcode = 'P0001', message = 'CODE_NOT_FOUND';
  end if;
  perform private.lock_users(v_user_id, v_creator_id);
  perform private.ensure_profile(v_user_id);

  select c.* into v_connection
  from public.connection_codes cc
  join public.connections c on c.id = cc.connection_id
  where cc.code = v_normalized_code
  for update of cc, c;

  if not found then
    raise exception using errcode = 'P0001', message = 'CODE_NOT_FOUND';
  end if;
  select cc.* into strict v_code
  from public.connection_codes cc
  where cc.code = v_normalized_code;
  v_now := clock_timestamp();
  if v_code.created_by = v_user_id then
    raise exception using errcode = 'P0001', message = 'SELF_CONNECTION';
  end if;
  if v_code.used_at is not null then
    raise exception using errcode = 'P0001', message = 'CODE_ALREADY_USED';
  end if;
  if v_connection.status = 'expired'
     or (v_connection.status = 'pending' and v_code.expires_at <= v_now) then
    update public.connection_codes set is_active = false where id = v_code.id;
    update public.connections set status = 'expired' where id = v_connection.id and status = 'pending';
    update public.connection_members set left_at = v_now
      where connection_id = v_connection.id and left_at is null;
    return jsonb_build_object(
      'state', 'EXPIRED', 'status', 'expired', 'code', v_normalized_code,
      'expires_at', v_code.expires_at, 'created_at', v_connection.created_at
    );
  end if;
  if not v_code.is_active then
    raise exception using errcode = 'P0001', message = 'CODE_INACTIVE';
  end if;
  if v_connection.status <> 'pending' then
    if v_connection.status in ('connected', 'disconnected') then
      raise exception using errcode = 'P0001', message = 'CONNECTION_FULL';
    end if;
    raise exception using errcode = 'P0001', message = 'CODE_INACTIVE';
  end if;

  perform private.expire_stale_connection_for_user(v_user_id);
  select c.id, c.status into v_active_connection_id, v_active_status
  from public.connection_members m
  join public.connections c on c.id = m.connection_id
  where m.user_id = v_user_id and m.left_at is null
  for update of c, m;

  if found then
    if v_active_status = 'pending' then
      raise exception using errcode = 'P0001', message = 'PENDING_CONNECTION_EXISTS';
    end if;
    raise exception using errcode = 'P0001', message = 'ALREADY_CONNECTED';
  end if;

  perform 1 from public.connection_members m
  where m.connection_id = v_connection.id
  for update;
  select count(*) into v_member_count
  from public.connection_members m
  where m.connection_id = v_connection.id and m.left_at is null;

  if v_member_count >= 2 then
    raise exception using errcode = 'P0001', message = 'CONNECTION_FULL';
  end if;
  if v_member_count <> 1 or not exists (
    select 1 from public.connection_members m
    where m.connection_id = v_connection.id
      and m.user_id = v_creator_id and m.member_slot = 1 and m.left_at is null
  ) then
    raise exception using errcode = 'P0001', message = 'CODE_INACTIVE';
  end if;

  begin
    insert into public.connection_members (connection_id, user_id, member_slot)
    values (v_connection.id, v_user_id, 2);
  exception when unique_violation then
    if exists (select 1 from public.connection_members m where m.user_id = v_user_id and m.left_at is null) then
      raise exception using errcode = 'P0001', message = 'ALREADY_CONNECTED';
    end if;
    raise exception using errcode = 'P0001', message = 'CONNECTION_FULL';
  end;

  update public.connection_codes
  set used_at = v_now, is_active = false
  where id = v_code.id;

  insert into public.conversations (connection_id)
  values (v_connection.id);

  update public.connections
  set status = 'connected', connected_at = v_now
  where id = v_connection.id;

  delete from private.connection_join_attempts where user_id = v_user_id;
  return private.connection_snapshot(v_user_id, v_connection.id);
  exception when others then
    get stacked diagnostics v_error_code = message_text;
    if v_error_code in (
      'CODE_NOT_FOUND', 'SELF_CONNECTION', 'CODE_ALREADY_USED', 'CODE_INACTIVE',
      'CONNECTION_FULL', 'PENDING_CONNECTION_EXISTS', 'ALREADY_CONNECTED'
    ) then
      return jsonb_build_object(
        'state', 'ERROR', 'status', 'error', 'error_code', v_error_code
      );
    end if;
    raise;
  end;
end;
$function$;

create function private.cancel_connection_impl()
returns jsonb
language plpgsql
security definer
set search_path = ''
as $function$
declare
  v_user_id uuid := private.current_user_id();
  v_connection_id uuid;
  v_expired_connection_id uuid;
  v_created_by uuid;
  v_now timestamptz;
begin
  perform private.lock_user(v_user_id);
  v_expired_connection_id := private.expire_stale_connection_for_user(v_user_id);
  if v_expired_connection_id is not null then
    return private.connection_snapshot(v_user_id, v_expired_connection_id);
  end if;

  select c.id, c.created_by into v_connection_id, v_created_by
  from public.connection_members m
  join public.connections c on c.id = m.connection_id
  where m.user_id = v_user_id and m.left_at is null and c.status = 'pending'
  for update of c, m;

  if not found then
    raise exception using errcode = 'P0001', message = 'NO_PENDING_CONNECTION';
  end if;
  if v_created_by <> v_user_id then
    raise exception using errcode = 'P0001', message = 'NOT_CONNECTION_CREATOR';
  end if;

  perform 1 from public.connection_codes cc where cc.connection_id = v_connection_id for update;
  v_now := clock_timestamp();
  update public.connection_codes set is_active = false where connection_id = v_connection_id;
  update public.connections set status = 'cancelled' where id = v_connection_id;
  update public.connection_members set left_at = v_now
    where connection_id = v_connection_id and left_at is null;

  return private.connection_snapshot(v_user_id, v_connection_id);
end;
$function$;

create function private.disconnect_connection_impl()
returns jsonb
language plpgsql
security definer
set search_path = ''
as $function$
declare
  v_user_id uuid := private.current_user_id();
  v_connection_id uuid;
  v_partner_id uuid;
  v_now timestamptz;
begin
  select c.id into v_connection_id
  from public.connection_members m
  join public.connections c on c.id = m.connection_id
  where m.user_id = v_user_id and m.left_at is null and c.status = 'connected';
  if not found then
    raise exception using errcode = 'P0001', message = 'NOT_CONNECTED';
  end if;

  select m.user_id into v_partner_id
  from public.connection_members m
  where m.connection_id = v_connection_id and m.user_id <> v_user_id and m.left_at is null;
  if v_partner_id is null then
    raise exception using errcode = 'P0001', message = 'NOT_CONNECTED';
  end if;

  perform private.lock_users(v_user_id, v_partner_id);
  perform 1 from public.connections c where c.id = v_connection_id and c.status = 'connected' for update;
  if not found then
    raise exception using errcode = 'P0001', message = 'NOT_CONNECTED';
  end if;
  perform 1 from public.connection_members m where m.connection_id = v_connection_id for update;
  v_now := clock_timestamp();

  update public.connection_codes set is_active = false where connection_id = v_connection_id;
  update public.connections
  set status = 'disconnected', disconnected_at = v_now
  where id = v_connection_id;
  update public.connection_members
  set left_at = v_now
  where connection_id = v_connection_id and left_at is null;

  return private.connection_snapshot(v_user_id, v_connection_id);
end;
$function$;

create function private.get_current_connection_impl()
returns jsonb
language plpgsql
security definer
set search_path = ''
as $function$
declare
  v_user_id uuid := private.current_user_id();
begin
  perform private.lock_user(v_user_id);
  perform private.ensure_profile(v_user_id);
  perform private.expire_stale_connection_for_user(v_user_id);
  return private.connection_snapshot(v_user_id, null);
end;
$function$;

create function private.require_connected_context(p_user_id uuid)
returns table (connection_id uuid, conversation_id uuid)
language plpgsql
security definer
stable
set search_path = ''
as $function$
begin
  return query
  select c.id, cv.id
  from public.connection_members m
  join public.connections c on c.id = m.connection_id
  join public.conversations cv on cv.connection_id = c.id
  where m.user_id = p_user_id
    and m.left_at is null
    and c.status = 'connected'
  limit 1;

  if not found then
    raise exception using errcode = 'P0001', message = 'NOT_CONNECTED';
  end if;
end;
$function$;

create function private.get_connected_content_impl()
returns jsonb
language plpgsql
security definer
stable
set search_path = ''
as $function$
declare
  v_user_id uuid := private.current_user_id();
  v_connection_id uuid;
  v_conversation_id uuid;
  v_messages jsonb;
  v_favorites jsonb;
begin
  select ctx.connection_id, ctx.conversation_id
  into v_connection_id, v_conversation_id
  from private.require_connected_context(v_user_id) ctx;

  select coalesce(jsonb_agg(rendered.payload order by rendered.created_at, rendered.id), '[]'::jsonb)
  into v_messages
  from (
    select
      recent.id,
      recent.created_at,
      jsonb_build_object(
        'id', recent.id,
        'type', recent.type,
        'content', recent.content,
        'youtube_video_id', recent.youtube_video_id,
        'youtube_url', recent.youtube_url,
        'metadata', recent.metadata,
        'created_at', recent.created_at,
        'updated_at', recent.updated_at,
        'is_mine', recent.sender_id = v_user_id,
        'sender', jsonb_build_object(
          'display_name', sender.display_name,
          'avatar_url', sender.avatar_url
        ),
        'reactions', coalesce((
          select jsonb_agg(
            jsonb_build_object(
              'reaction', grouped.reaction,
              'count', grouped.reaction_count,
              'reacted_by_viewer', grouped.reacted_by_viewer
            ) order by grouped.reaction
          )
          from (
            select
              mr.reaction,
              count(*)::integer as reaction_count,
              bool_or(mr.user_id = v_user_id) as reacted_by_viewer
            from public.message_reactions mr
            where mr.message_id = recent.id
            group by mr.reaction
          ) grouped
        ), '[]'::jsonb)
      ) as payload
    from (
      select m.*
      from public.messages m
      where m.connection_id = v_connection_id
        and m.conversation_id = v_conversation_id
      order by m.created_at desc, m.id desc
      limit 200
    ) recent
    join public.profiles sender on sender.id = recent.sender_id
  ) rendered;

  select coalesce(jsonb_agg(favorite_rows.payload order by favorite_rows.created_at desc, favorite_rows.id desc), '[]'::jsonb)
  into v_favorites
  from (
    select
      f.id,
      f.created_at,
      jsonb_build_object(
        'id', f.id,
        'type', f.type,
        'visibility', f.visibility,
        'youtube_video_id', f.youtube_video_id,
        'youtube_url', f.youtube_url,
        'created_at', f.created_at,
        'created_by_viewer', f.created_by = v_user_id
      ) as payload
    from public.favorites f
    where f.connection_id = v_connection_id
      and (f.visibility = 'shared' or f.created_by = v_user_id)
    order by f.created_at desc, f.id desc
    limit 200
  ) favorite_rows;

  return jsonb_build_object('messages', v_messages, 'favorites', v_favorites);
end;
$function$;

create function private.send_message_impl(
  p_type text, p_content text, p_youtube_video_id text, p_youtube_url text, p_metadata jsonb
)
returns jsonb
language plpgsql
security definer
set search_path = ''
as $function$
declare
  v_user_id uuid := private.current_user_id();
  v_connection_id uuid;
  v_conversation_id uuid;
  v_type text := lower(btrim(coalesce(p_type, '')));
  v_content text := nullif(btrim(p_content), '');
  v_video_id text := nullif(btrim(p_youtube_video_id), '');
  v_url text := nullif(btrim(p_youtube_url), '');
  v_metadata jsonb := coalesce(p_metadata, '{}'::jsonb);
  v_message public.messages%rowtype;
  v_profile public.profiles%rowtype;
  v_retry_after integer;
  v_row_limit integer;
  v_row_count integer;
begin
  if v_type not in ('text', 'video', 'short') then
    raise exception using errcode = 'P0001', message = 'INVALID_MESSAGE_TYPE';
  end if;
  if jsonb_typeof(v_metadata) <> 'object' or pg_column_size(v_metadata) > 16384 then
    raise exception using errcode = 'P0001', message = 'INVALID_METADATA';
  end if;
  if v_content is not null and char_length(v_content) > 4000 then
    raise exception using errcode = 'P0001', message = 'CONTENT_TOO_LONG';
  end if;
  if v_type = 'text' and (v_content is null or v_video_id is not null or v_url is not null) then
    raise exception using errcode = 'P0001', message = 'INVALID_MESSAGE_PAYLOAD';
  end if;
  if v_type in ('video', 'short') and (
    v_video_id is null or v_video_id !~ '^[A-Za-z0-9_-]{11}$'
    or v_url is null
    or (v_type = 'video' and v_url <> ('https://www.youtube.com/watch?v=' || v_video_id))
    or (v_type = 'short' and v_url <> ('https://www.youtube.com/shorts/' || v_video_id))
  ) then
    raise exception using errcode = 'P0001', message = 'INVALID_MEDIA';
  end if;

  perform private.lock_user(v_user_id);
  select ctx.connection_id, ctx.conversation_id
  into v_connection_id, v_conversation_id
  from private.require_connected_context(v_user_id) ctx;

  select quota.retry_after_seconds, quota.connection_row_limit
  into v_retry_after, v_row_limit
  from private.consume_content_mutation(v_user_id, v_connection_id, 'message') quota;
  if v_retry_after > 0 then
    return jsonb_build_object(
      'state', 'ERROR', 'status', 'error', 'error_code', 'RATE_LIMITED',
      'retry_after_seconds', v_retry_after
    );
  end if;

  select count(*)::integer into v_row_count
  from public.messages m
  where m.connection_id = v_connection_id;
  if v_row_count >= v_row_limit then
    return jsonb_build_object(
      'state', 'ERROR', 'status', 'error', 'error_code', 'QUOTA_EXCEEDED',
      'resource', 'messages', 'limit', v_row_limit
    );
  end if;

  insert into public.messages
    (connection_id, conversation_id, sender_id, type, content, youtube_video_id, youtube_url, metadata)
  values
    (v_connection_id, v_conversation_id, v_user_id, v_type, v_content, v_video_id, v_url, v_metadata)
  returning * into v_message;

  select * into v_profile from public.profiles p where p.id = v_user_id;
  return jsonb_build_object(
    'id', v_message.id, 'type', v_message.type, 'content', v_message.content,
    'youtube_video_id', v_message.youtube_video_id, 'youtube_url', v_message.youtube_url,
    'metadata', v_message.metadata, 'created_at', v_message.created_at,
    'updated_at', v_message.updated_at, 'is_mine', true,
    'sender', jsonb_build_object('display_name', v_profile.display_name, 'avatar_url', v_profile.avatar_url),
    'reactions', '[]'::jsonb
  );
end;
$function$;

create function private.toggle_message_reaction_impl(p_message_id uuid, p_reaction text)
returns jsonb
language plpgsql
security definer
set search_path = ''
as $function$
declare
  v_user_id uuid := private.current_user_id();
  v_connection_id uuid;
  v_conversation_id uuid;
  v_reaction text := btrim(coalesce(p_reaction, ''));
  v_existing public.message_reactions%rowtype;
  v_reaction_id uuid;
  v_retry_after integer;
  v_row_limit integer;
  v_row_count integer;
begin
  if upper(v_reaction) in ('LIKE', 'LOVE', 'LAUGH', 'WOW', 'SAD', 'FIRE') then
    v_reaction := upper(v_reaction);
  end if;
  if v_reaction not in ('LIKE', 'LOVE', 'LAUGH', 'WOW', 'SAD', 'FIRE', '👍', '❤️', '😂', '😮', '😢', '🔥') then
    raise exception using errcode = 'P0001', message = 'INVALID_REACTION';
  end if;

  perform private.lock_user(v_user_id);
  select ctx.connection_id, ctx.conversation_id
  into v_connection_id, v_conversation_id
  from private.require_connected_context(v_user_id) ctx;

  select quota.retry_after_seconds, quota.connection_row_limit
  into v_retry_after, v_row_limit
  from private.consume_content_mutation(v_user_id, v_connection_id, 'reaction') quota;
  if v_retry_after > 0 then
    return jsonb_build_object(
      'state', 'ERROR', 'status', 'error', 'error_code', 'RATE_LIMITED',
      'retry_after_seconds', v_retry_after
    );
  end if;
  if not exists (
    select 1 from public.messages m
    where m.id = p_message_id and m.connection_id = v_connection_id
  ) then
    return jsonb_build_object(
      'state', 'ERROR', 'status', 'error', 'error_code', 'MESSAGE_NOT_FOUND'
    );
  end if;

  select * into v_existing
  from public.message_reactions mr
  where mr.message_id = p_message_id and mr.user_id = v_user_id
  for update;
  if found and v_existing.reaction = v_reaction then
    delete from public.message_reactions where id = v_existing.id;
    return jsonb_build_object('action', 'removed', 'id', v_existing.id,
      'message_id', p_message_id, 'reaction', v_reaction);
  elsif found then
    update public.message_reactions set reaction = v_reaction
    where id = v_existing.id returning id into v_reaction_id;
    return jsonb_build_object('action', 'updated', 'id', v_reaction_id,
      'message_id', p_message_id, 'reaction', v_reaction);
  end if;

  select count(*)::integer into v_row_count
  from public.message_reactions mr
  where mr.connection_id = v_connection_id;
  if v_row_count >= v_row_limit then
    return jsonb_build_object(
      'state', 'ERROR', 'status', 'error', 'error_code', 'QUOTA_EXCEEDED',
      'resource', 'message_reactions', 'limit', v_row_limit
    );
  end if;

  insert into public.message_reactions (connection_id, message_id, user_id, reaction)
  values (v_connection_id, p_message_id, v_user_id, v_reaction)
  returning id into v_reaction_id;
  return jsonb_build_object('action', 'added', 'id', v_reaction_id,
    'message_id', p_message_id, 'reaction', v_reaction);
end;
$function$;

create function private.toggle_favorite_impl(
  p_youtube_video_id text, p_youtube_url text, p_type text, p_visibility text
)
returns jsonb
language plpgsql
security definer
set search_path = ''
as $function$
declare
  v_user_id uuid := private.current_user_id();
  v_connection_id uuid;
  v_conversation_id uuid;
  v_video_id text := nullif(btrim(p_youtube_video_id), '');
  v_url text := nullif(btrim(p_youtube_url), '');
  v_type text := lower(btrim(coalesce(p_type, '')));
  v_visibility text := lower(btrim(coalesce(p_visibility, '')));
  v_existing public.favorites%rowtype;
  v_favorite public.favorites%rowtype;
  v_retry_after integer;
  v_row_limit integer;
  v_row_count integer;
begin
  if v_type not in ('video', 'short') then
    raise exception using errcode = 'P0001', message = 'INVALID_FAVORITE_TYPE';
  end if;
  if v_visibility not in ('private', 'shared') then
    raise exception using errcode = 'P0001', message = 'INVALID_VISIBILITY';
  end if;
  if v_video_id is null or v_video_id !~ '^[A-Za-z0-9_-]{11}$'
    or v_url is null
    or (v_type = 'video' and v_url <> ('https://www.youtube.com/watch?v=' || v_video_id))
    or (v_type = 'short' and v_url <> ('https://www.youtube.com/shorts/' || v_video_id)) then
    raise exception using errcode = 'P0001', message = 'INVALID_MEDIA';
  end if;

  perform private.lock_user(v_user_id);
  select ctx.connection_id, ctx.conversation_id
  into v_connection_id, v_conversation_id
  from private.require_connected_context(v_user_id) ctx;

  select quota.retry_after_seconds, quota.connection_row_limit
  into v_retry_after, v_row_limit
  from private.consume_content_mutation(v_user_id, v_connection_id, 'favorite') quota;
  if v_retry_after > 0 then
    return jsonb_build_object(
      'state', 'ERROR', 'status', 'error', 'error_code', 'RATE_LIMITED',
      'retry_after_seconds', v_retry_after
    );
  end if;
  select * into v_existing
  from public.favorites f
  where f.connection_id = v_connection_id and f.created_by = v_user_id
    and f.type = v_type and f.youtube_video_id = v_video_id
  for update;

  if found then
    delete from public.favorites where id = v_existing.id;
    return jsonb_build_object(
      'action', 'removed', 'id', v_existing.id, 'type', v_existing.type,
      'visibility', v_existing.visibility, 'youtube_video_id', v_existing.youtube_video_id,
      'youtube_url', v_existing.youtube_url, 'created_at', v_existing.created_at,
      'created_by_viewer', true
    );
  end if;

  select count(*)::integer into v_row_count
  from public.favorites f
  where f.connection_id = v_connection_id;
  if v_row_count >= v_row_limit then
    return jsonb_build_object(
      'state', 'ERROR', 'status', 'error', 'error_code', 'QUOTA_EXCEEDED',
      'resource', 'favorites', 'limit', v_row_limit
    );
  end if;

  insert into public.favorites
    (connection_id, created_by, youtube_video_id, youtube_url, type, visibility)
  values (v_connection_id, v_user_id, v_video_id, v_url, v_type, v_visibility)
  returning * into v_favorite;
  return jsonb_build_object(
    'action', 'added', 'id', v_favorite.id, 'type', v_favorite.type,
    'visibility', v_favorite.visibility, 'youtube_video_id', v_favorite.youtube_video_id,
    'youtube_url', v_favorite.youtube_url, 'created_at', v_favorite.created_at,
    'created_by_viewer', true
  );
end;
$function$;

create function private.set_favorite_visibility_impl(p_favorite_id uuid, p_visibility text)
returns jsonb
language plpgsql
security definer
set search_path = ''
as $function$
declare
  v_user_id uuid := private.current_user_id();
  v_connection_id uuid;
  v_conversation_id uuid;
  v_visibility text := lower(btrim(coalesce(p_visibility, '')));
  v_favorite public.favorites%rowtype;
  v_retry_after integer;
begin
  if v_visibility not in ('private', 'shared') then
    raise exception using errcode = 'P0001', message = 'INVALID_VISIBILITY';
  end if;
  perform private.lock_user(v_user_id);
  select ctx.connection_id, ctx.conversation_id
  into v_connection_id, v_conversation_id
  from private.require_connected_context(v_user_id) ctx;
  select quota.retry_after_seconds into v_retry_after
  from private.consume_content_mutation(v_user_id, v_connection_id, 'favorite') quota;
  if v_retry_after > 0 then
    return jsonb_build_object(
      'state', 'ERROR', 'status', 'error', 'error_code', 'RATE_LIMITED',
      'retry_after_seconds', v_retry_after
    );
  end if;
  update public.favorites set visibility = v_visibility
  where id = p_favorite_id and connection_id = v_connection_id and created_by = v_user_id
  returning * into v_favorite;
  if not found then
    return jsonb_build_object(
      'state', 'ERROR', 'status', 'error', 'error_code', 'FAVORITE_NOT_FOUND'
    );
  end if;
  return jsonb_build_object(
    'action', 'updated', 'id', v_favorite.id, 'type', v_favorite.type,
    'visibility', v_favorite.visibility, 'youtube_video_id', v_favorite.youtube_video_id,
    'youtube_url', v_favorite.youtube_url, 'created_at', v_favorite.created_at,
    'created_by_viewer', true
  );
end;
$function$;

-- Public PostgREST surface: invoker wrappers over narrowly granted private implementations.
create function public.generate_connection_code()
returns jsonb language sql security invoker set search_path = ''
as $function$ select private.generate_connection_code_impl() $function$;

create function public.join_connection_by_code(p_code text)
returns jsonb language sql security invoker set search_path = ''
as $function$ select private.join_connection_by_code_impl(p_code) $function$;

create function public.cancel_connection()
returns jsonb language sql security invoker set search_path = ''
as $function$ select private.cancel_connection_impl() $function$;

create function public.disconnect_connection()
returns jsonb language sql security invoker set search_path = ''
as $function$ select private.disconnect_connection_impl() $function$;

create function public.get_current_connection()
returns jsonb language sql security invoker set search_path = ''
as $function$ select private.get_current_connection_impl() $function$;

create function public.get_connected_content()
returns jsonb language sql security invoker set search_path = ''
as $function$ select private.get_connected_content_impl() $function$;

create function public.send_message(
  p_type text,
  p_content text default null,
  p_youtube_video_id text default null,
  p_youtube_url text default null,
  p_metadata jsonb default '{}'::jsonb
)
returns jsonb language sql security invoker set search_path = ''
as $function$
  select private.send_message_impl(p_type, p_content, p_youtube_video_id, p_youtube_url, p_metadata)
$function$;

create function public.toggle_message_reaction(p_message_id uuid, p_reaction text)
returns jsonb language sql security invoker set search_path = ''
as $function$ select private.toggle_message_reaction_impl(p_message_id, p_reaction) $function$;

create function public.toggle_favorite(
  p_youtube_video_id text, p_youtube_url text, p_type text, p_visibility text
)
returns jsonb language sql security invoker set search_path = ''
as $function$
  select private.toggle_favorite_impl(p_youtube_video_id, p_youtube_url, p_type, p_visibility)
$function$;

create function public.set_favorite_visibility(p_favorite_id uuid, p_visibility text)
returns jsonb language sql security invoker set search_path = ''
as $function$ select private.set_favorite_visibility_impl(p_favorite_id, p_visibility) $function$;

alter table public.profiles enable row level security;
alter table public.connections enable row level security;
alter table public.connection_codes enable row level security;
alter table public.connection_members enable row level security;
alter table public.conversations enable row level security;
alter table public.messages enable row level security;
alter table public.message_reactions enable row level security;
alter table public.favorites enable row level security;

create policy profiles_select_self on public.profiles
for select to authenticated using (id = (select auth.uid()));
create policy profiles_update_self on public.profiles
for update to authenticated
using (id = (select auth.uid()))
with check (id = (select auth.uid()));

create policy connections_select_active_members on public.connections
for select to authenticated using (private.is_active_connection_member(id));
create policy connection_codes_select_creator on public.connection_codes
for select to authenticated
using (created_by = (select auth.uid()) and private.is_active_connection_member(connection_id));
create policy connection_members_select_pair on public.connection_members
for select to authenticated using (private.is_active_connection_member(connection_id));
create policy conversations_select_connected_pair on public.conversations
for select to authenticated using (private.is_connected_member(connection_id));

create policy messages_select_connected_pair on public.messages
for select to authenticated using (private.is_connected_member(connection_id));
create policy messages_insert_connected_self on public.messages
for insert to authenticated
with check (sender_id = (select auth.uid()) and private.is_connected_member(connection_id));
create policy messages_update_connected_self on public.messages
for update to authenticated
using (sender_id = (select auth.uid()) and private.is_connected_member(connection_id))
with check (sender_id = (select auth.uid()) and private.is_connected_member(connection_id));
create policy messages_delete_connected_self on public.messages
for delete to authenticated
using (sender_id = (select auth.uid()) and private.is_connected_member(connection_id));

create policy message_reactions_select_connected_pair on public.message_reactions
for select to authenticated using (private.is_connected_member(connection_id));
create policy message_reactions_insert_connected_self on public.message_reactions
for insert to authenticated
with check (user_id = (select auth.uid()) and private.is_connected_member(connection_id));
create policy message_reactions_update_connected_self on public.message_reactions
for update to authenticated
using (user_id = (select auth.uid()) and private.is_connected_member(connection_id))
with check (user_id = (select auth.uid()) and private.is_connected_member(connection_id));
create policy message_reactions_delete_connected_self on public.message_reactions
for delete to authenticated
using (user_id = (select auth.uid()) and private.is_connected_member(connection_id));

create policy favorites_select_visible_to_pair on public.favorites
for select to authenticated
using (
  private.is_connected_member(connection_id)
  and (visibility = 'shared' or created_by = (select auth.uid()))
);
create policy favorites_insert_connected_self on public.favorites
for insert to authenticated
with check (created_by = (select auth.uid()) and private.is_connected_member(connection_id));
create policy favorites_update_connected_self on public.favorites
for update to authenticated
using (created_by = (select auth.uid()) and private.is_connected_member(connection_id))
with check (created_by = (select auth.uid()) and private.is_connected_member(connection_id));
create policy favorites_delete_connected_self on public.favorites
for delete to authenticated
using (created_by = (select auth.uid()) and private.is_connected_member(connection_id));

revoke all on public.profiles, public.connections, public.connection_codes,
  public.connection_members, public.conversations, public.messages,
  public.message_reactions, public.favorites from public, anon, authenticated;
revoke all on private.connection_system_config, private.connection_join_attempts,
  private.content_quota_config, private.content_mutation_counters
  from public, anon, authenticated;
grant select on public.profiles to authenticated;
grant update (display_name, avatar_url) on public.profiles to authenticated;
-- Connection/content rows intentionally have no direct authenticated grants. Public RPCs
-- return minimized objects, and the RLS policies remain defense-in-depth for future grants.

grant usage on schema private to authenticated;

revoke execute on function private.current_user_id() from public, anon, authenticated;
revoke execute on function private.lock_user(uuid) from public, anon, authenticated;
revoke execute on function private.lock_users(uuid, uuid) from public, anon, authenticated;
revoke execute on function private.consume_join_attempt(uuid) from public, anon, authenticated;
revoke execute on function private.consume_content_mutation(uuid, uuid, text)
  from public, anon, authenticated;
revoke execute on function private.ensure_profile(uuid) from public, anon, authenticated;
revoke execute on function private.generate_connection_code_value() from public, anon, authenticated;
revoke execute on function private.assert_connection_invariants() from public, anon, authenticated;
revoke execute on function private.expire_stale_connection_for_user(uuid) from public, anon, authenticated;
revoke execute on function private.connection_snapshot(uuid, uuid) from public, anon, authenticated;
revoke execute on function private.require_connected_context(uuid) from public, anon, authenticated;
revoke execute on function private.set_updated_at() from public, anon, authenticated;
revoke execute on function private.handle_new_auth_user() from public, anon, authenticated;
revoke execute on function private.is_active_connection_member(uuid) from public, anon, authenticated;
revoke execute on function private.is_connected_member(uuid) from public, anon, authenticated;
grant execute on function private.is_active_connection_member(uuid) to authenticated;
grant execute on function private.is_connected_member(uuid) to authenticated;

revoke execute on function private.generate_connection_code_impl() from public, anon, authenticated;
revoke execute on function private.join_connection_by_code_impl(text) from public, anon, authenticated;
revoke execute on function private.cancel_connection_impl() from public, anon, authenticated;
revoke execute on function private.disconnect_connection_impl() from public, anon, authenticated;
revoke execute on function private.get_current_connection_impl() from public, anon, authenticated;
revoke execute on function private.get_connected_content_impl() from public, anon, authenticated;
revoke execute on function private.send_message_impl(text, text, text, text, jsonb) from public, anon, authenticated;
revoke execute on function private.toggle_message_reaction_impl(uuid, text) from public, anon, authenticated;
revoke execute on function private.toggle_favorite_impl(text, text, text, text) from public, anon, authenticated;
revoke execute on function private.set_favorite_visibility_impl(uuid, text) from public, anon, authenticated;
grant execute on function private.generate_connection_code_impl() to authenticated;
grant execute on function private.join_connection_by_code_impl(text) to authenticated;
grant execute on function private.cancel_connection_impl() to authenticated;
grant execute on function private.disconnect_connection_impl() to authenticated;
grant execute on function private.get_current_connection_impl() to authenticated;
grant execute on function private.get_connected_content_impl() to authenticated;
grant execute on function private.send_message_impl(text, text, text, text, jsonb) to authenticated;
grant execute on function private.toggle_message_reaction_impl(uuid, text) to authenticated;
grant execute on function private.toggle_favorite_impl(text, text, text, text) to authenticated;
grant execute on function private.set_favorite_visibility_impl(uuid, text) to authenticated;

revoke execute on function public.generate_connection_code() from public, anon;
revoke execute on function public.join_connection_by_code(text) from public, anon;
revoke execute on function public.cancel_connection() from public, anon;
revoke execute on function public.disconnect_connection() from public, anon;
revoke execute on function public.get_current_connection() from public, anon;
revoke execute on function public.get_connected_content() from public, anon;
revoke execute on function public.send_message(text, text, text, text, jsonb) from public, anon;
revoke execute on function public.toggle_message_reaction(uuid, text) from public, anon;
revoke execute on function public.toggle_favorite(text, text, text, text) from public, anon;
revoke execute on function public.set_favorite_visibility(uuid, text) from public, anon;
grant execute on function public.generate_connection_code() to authenticated;
grant execute on function public.join_connection_by_code(text) to authenticated;
grant execute on function public.cancel_connection() to authenticated;
grant execute on function public.disconnect_connection() to authenticated;
grant execute on function public.get_current_connection() to authenticated;
grant execute on function public.get_connected_content() to authenticated;
grant execute on function public.send_message(text, text, text, text, jsonb) to authenticated;
grant execute on function public.toggle_message_reaction(uuid, text) to authenticated;
grant execute on function public.toggle_favorite(text, text, text, text) to authenticated;
grant execute on function public.set_favorite_visibility(uuid, text) to authenticated;

-- Payload-free, per-user private Broadcast notifications let clients refetch through
-- the safe RPCs without putting connection IDs or private rows in event payloads.
create function private.broadcast_private_refresh()
returns trigger
language plpgsql
security definer
set search_path = ''
as $function$
declare
  v_connection_id uuid;
  v_kind text;
  v_member record;
  v_owner_id uuid;
  v_notify_pair boolean := true;
begin
  if tg_table_name = 'connections' then
    v_connection_id := case when tg_op = 'DELETE' then old.id else new.id end;
  else
    v_connection_id := case when tg_op = 'DELETE' then old.connection_id else new.connection_id end;
  end if;
  v_kind := case
    when tg_table_name in ('messages', 'message_reactions', 'favorites') then 'content'
    else 'connection'
  end;

  -- A private favorite must not reveal even its existence/timing to the partner.
  if tg_table_name = 'favorites' then
    if tg_op = 'INSERT' then
      v_owner_id := new.created_by;
      v_notify_pair := new.visibility = 'shared';
    elsif tg_op = 'DELETE' then
      v_owner_id := old.created_by;
      v_notify_pair := old.visibility = 'shared';
    else
      v_owner_id := new.created_by;
      v_notify_pair := old.visibility = 'shared' or new.visibility = 'shared';
    end if;
  end if;

  for v_member in
    select distinct m.user_id
    from public.connection_members m
    where m.connection_id = v_connection_id
      and (v_notify_pair or m.user_id = v_owner_id)
  loop
    perform realtime.send(
      jsonb_build_object('refresh', true, 'kind', v_kind),
      v_kind || '_changed',
      v_kind || ':' || v_member.user_id::text,
      true
    );
  end loop;
  return null;
end;
$function$;

revoke execute on function private.broadcast_private_refresh() from public, anon, authenticated;

create trigger connections_broadcast_refresh
after insert or update or delete on public.connections
for each row execute function private.broadcast_private_refresh();
create trigger messages_broadcast_refresh
after insert or update or delete on public.messages
for each row execute function private.broadcast_private_refresh();
create trigger message_reactions_broadcast_refresh
after insert or update or delete on public.message_reactions
for each row execute function private.broadcast_private_refresh();
create trigger favorites_broadcast_refresh
after insert or update or delete on public.favorites
for each row execute function private.broadcast_private_refresh();

create policy ourtube_users_receive_own_private_refreshes
on realtime.messages for select to authenticated
using (
  realtime.messages.extension = 'broadcast'
  and (
    realtime.topic() = 'connection:' || (select auth.uid())::text
    or realtime.topic() = 'content:' || (select auth.uid())::text
  )
);

-- Realtime Broadcast uses Supabase's managed publication for realtime.messages.
-- Application tables are deliberately not added to Postgres Changes: doing so would
-- duplicate events and expose raw internal identifiers in browser payloads.

comment on function public.generate_connection_code() is
  'Creates or returns the caller pending code. TTL comes from private.connection_system_config.';
comment on function public.join_connection_by_code(text) is
  'Atomically joins a valid code and creates the two-person conversation.';
comment on function public.get_connected_content() is
  'Returns at most 200 newest messages (ordered ascending after capping) and 200 visible favorites.';

commit;
