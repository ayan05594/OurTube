-- Run after migrations against a disposable local Supabase database:
--   psql "$DATABASE_URL" -v ON_ERROR_STOP=1 -f supabase/tests/private_connections.sql
-- The entire fixture is rolled back. It deliberately grants SELECT temporarily so
-- RLS can be tested even though production access is RPC-only.

begin;

insert into auth.users (
  id, instance_id, aud, role, email, encrypted_password, email_confirmed_at,
  raw_app_meta_data, raw_user_meta_data, created_at, updated_at
)
values
  (
    '10000000-0000-4000-8000-000000000001',
    '00000000-0000-0000-0000-000000000000',
    'authenticated', 'authenticated', 'alice@example.test', '', clock_timestamp(),
    '{"provider":"email","providers":["email"]}'::jsonb, '{"name":"Alice"}'::jsonb,
    clock_timestamp(), clock_timestamp()
  ),
  (
    '10000000-0000-4000-8000-000000000002',
    '00000000-0000-0000-0000-000000000000',
    'authenticated', 'authenticated', 'bob@example.test', '', clock_timestamp(),
    '{"provider":"email","providers":["email"]}'::jsonb, '{"name":"Bob"}'::jsonb,
    clock_timestamp(), clock_timestamp()
  ),
  (
    '10000000-0000-4000-8000-000000000003',
    '00000000-0000-0000-0000-000000000000',
    'authenticated', 'authenticated', 'mallory@example.test', '', clock_timestamp(),
    '{"provider":"email","providers":["email"]}'::jsonb, '{"name":"Mallory"}'::jsonb,
    clock_timestamp(), clock_timestamp()
  );

grant select on public.connections, public.connection_codes, public.connection_members,
  public.conversations, public.messages, public.message_reactions, public.favorites
  to authenticated;

create function pg_temp.authenticate_as(p_user_id uuid)
returns void
language plpgsql
security invoker
set search_path = ''
as $function$
begin
  perform pg_catalog.set_config('request.jwt.claim.sub', p_user_id::text, true);
  perform pg_catalog.set_config('request.jwt.claim.role', 'authenticated', true);
  perform pg_catalog.set_config(
    'request.jwt.claims',
    pg_catalog.jsonb_build_object(
      'sub', p_user_id,
      'role', 'authenticated',
      'app_metadata', pg_catalog.jsonb_build_object(
        'provider', 'google', 'providers', pg_catalog.jsonb_build_array('google')
      )
    )::text,
    true
  );
end;
$function$;

set local role authenticated;
select pg_temp.authenticate_as('10000000-0000-4000-8000-000000000001');

do $test$
declare
  v_result jsonb;
begin
  v_result := public.generate_connection_code();
  if v_result ->> 'state' <> 'PENDING' then
    raise exception 'expected PENDING, got %', v_result;
  end if;
  if (v_result ->> 'code') !~ '^[ABCDEFGHJKMNPQRSTUVWXYZ23456789]{4}-[ABCDEFGHJKMNPQRSTUVWXYZ23456789]{4}$' then
    raise exception 'generated code has invalid format: %', v_result;
  end if;
  perform set_config('test.connection_code', v_result ->> 'code', true);

  v_result := public.join_connection_by_code(v_result ->> 'code');
  if v_result ->> 'error_code' <> 'SELF_CONNECTION' then
    raise exception 'self join was not rejected: %', v_result;
  end if;
end;
$test$;

set constraints all immediate;
set constraints all deferred;

select pg_temp.authenticate_as('10000000-0000-4000-8000-000000000002');
do $test$
declare
  v_result jsonb;
begin
  v_result := public.join_connection_by_code(current_setting('test.connection_code'));
  if v_result ->> 'state' <> 'CONNECTED' then
    raise exception 'expected CONNECTED, got %', v_result;
  end if;
  if v_result #>> '{partner,display_name}' <> 'Alice' then
    raise exception 'safe partner projection is missing: %', v_result;
  end if;
  if (v_result -> 'partner') ? 'email' then
    raise exception 'partner email leaked: %', v_result;
  end if;

  v_result := public.send_message(
    'video', 'A classic',
    'dQw4w9WgXcQ', 'https://www.youtube.com/watch?v=dQw4w9WgXcQ',
    '{"source":"test"}'::jsonb
  );
  perform set_config('test.message_id', v_result ->> 'id', true);

  v_result := public.toggle_message_reaction(
    current_setting('test.message_id')::uuid, 'LOVE'
  );
  if v_result ->> 'action' <> 'added' then
    raise exception 'reaction was not added: %', v_result;
  end if;

  v_result := public.toggle_favorite(
    'dQw4w9WgXcQ', 'https://www.youtube.com/watch?v=dQw4w9WgXcQ',
    'video', 'private'
  );
  perform set_config('test.favorite_id', v_result ->> 'id', true);
end;
$test$;

set constraints all immediate;
set constraints all deferred;

-- Each mutation family has a per-user limiter. A rejected mutation must return a
-- stable JSON error and leave retained content unchanged.
reset role;
update private.content_quota_config
set user_rate_limit = 1
where operation in ('message', 'reaction', 'favorite');

set local role authenticated;
select pg_temp.authenticate_as('10000000-0000-4000-8000-000000000002');
do $test$
declare
  v_result jsonb;
begin
  v_result := public.send_message('text', 'must be rate limited');
  if v_result ->> 'error_code' <> 'RATE_LIMITED'
     or coalesce((v_result ->> 'retry_after_seconds')::integer, 0) <= 0 then
    raise exception 'message user limiter did not engage: %', v_result;
  end if;

  v_result := public.toggle_message_reaction(
    current_setting('test.message_id')::uuid, 'LOVE'
  );
  if v_result ->> 'error_code' <> 'RATE_LIMITED'
     or coalesce((v_result ->> 'retry_after_seconds')::integer, 0) <= 0 then
    raise exception 'reaction user limiter did not engage: %', v_result;
  end if;

  v_result := public.set_favorite_visibility(
    current_setting('test.favorite_id')::uuid, 'shared'
  );
  if v_result ->> 'error_code' <> 'RATE_LIMITED'
     or coalesce((v_result ->> 'retry_after_seconds')::integer, 0) <= 0 then
    raise exception 'favorite user limiter did not engage: %', v_result;
  end if;
end;
$test$;

reset role;
do $test$
begin
  if (select count(*) from public.messages) <> 1
     or (select count(*) from public.message_reactions) <> 1
     or (select count(*) from public.favorites) <> 1
     or (select visibility from public.favorites where id = current_setting('test.favorite_id')::uuid) <> 'private' then
    raise exception 'rate-limited mutation changed retained content';
  end if;
end;
$test$;

-- The shared connection counter is serialized across both users. Give it one
-- message slot, consume that slot as Alice, and verify Bob cannot consume a second.
delete from private.content_mutation_counters;
update private.content_quota_config
set user_rate_limit = 1, connection_rate_limit = 1
where operation = 'message';

set local role authenticated;
select pg_temp.authenticate_as('10000000-0000-4000-8000-000000000001');
do $test$
declare
  v_result jsonb;
begin
  v_result := public.send_message('text', 'connection limiter fixture');
  if v_result ->> 'id' is null then
    raise exception 'connection limiter fixture was not inserted: %', v_result;
  end if;
  perform set_config('test.rate_fixture_message_id', v_result ->> 'id', true);
end;
$test$;

select pg_temp.authenticate_as('10000000-0000-4000-8000-000000000002');
do $test$
declare
  v_result jsonb;
begin
  v_result := public.send_message('text', 'must hit connection limiter');
  if v_result ->> 'error_code' <> 'RATE_LIMITED'
     or coalesce((v_result ->> 'retry_after_seconds')::integer, 0) <= 0 then
    raise exception 'message connection limiter did not engage across users: %', v_result;
  end if;
end;
$test$;

reset role;
delete from public.messages
where id = current_setting('test.rate_fixture_message_id')::uuid;
delete from private.content_mutation_counters;
update private.content_quota_config
set user_rate_limit = case operation
      when 'message' then 30 when 'reaction' then 60 else 20 end,
    connection_rate_limit = case operation
      when 'message' then 60 when 'reaction' then 120 else 40 end,
    connection_row_limit = 1;

-- All retained-content caps are hard connection-wide bounds. Existing removals
-- remain possible at the cap, while a new row returns QUOTA_EXCEEDED atomically.
set local role authenticated;
select pg_temp.authenticate_as('10000000-0000-4000-8000-000000000001');
do $test$
declare
  v_result jsonb;
begin
  v_result := public.send_message('text', 'must exceed message cap');
  if v_result ->> 'error_code' <> 'QUOTA_EXCEEDED'
     or v_result ->> 'resource' <> 'messages'
     or (v_result ->> 'limit')::integer <> 1 then
    raise exception 'message retained-row cap did not engage: %', v_result;
  end if;

  v_result := public.toggle_message_reaction(
    current_setting('test.message_id')::uuid, 'LIKE'
  );
  if v_result ->> 'error_code' <> 'QUOTA_EXCEEDED'
     or v_result ->> 'resource' <> 'message_reactions'
     or (v_result ->> 'limit')::integer <> 1 then
    raise exception 'reaction retained-row cap did not engage: %', v_result;
  end if;

  v_result := public.toggle_favorite(
    '9bZkp7q19f0', 'https://www.youtube.com/watch?v=9bZkp7q19f0',
    'video', 'private'
  );
  if v_result ->> 'error_code' <> 'QUOTA_EXCEEDED'
     or v_result ->> 'resource' <> 'favorites'
     or (v_result ->> 'limit')::integer <> 1 then
    raise exception 'favorite retained-row cap did not engage: %', v_result;
  end if;
end;
$test$;

reset role;
do $test$
begin
  if (select count(*) from public.messages) <> 1
     or (select count(*) from public.message_reactions) <> 1
     or (select count(*) from public.favorites) <> 1 then
    raise exception 'quota-exceeded mutation changed retained content';
  end if;
end;
$test$;
update private.content_quota_config
set connection_row_limit = case operation
      when 'message' then 10000 when 'reaction' then 20000 else 1000 end;
delete from private.content_mutation_counters;

set local role authenticated;
-- The creator can see the message, but not the partner's private favorite.
select pg_temp.authenticate_as('10000000-0000-4000-8000-000000000001');
do $test$
declare
  v_content jsonb := public.get_connected_content();
begin
  if jsonb_array_length(v_content -> 'messages') <> 1 then
    raise exception 'connected message missing: %', v_content;
  end if;
  if jsonb_array_length(v_content -> 'favorites') <> 0 then
    raise exception 'partner private favorite leaked: %', v_content;
  end if;
  if (select count(*) from public.favorites) <> 0 then
    raise exception 'private favorite leaked through RLS';
  end if;
  if (select count(*) from public.messages) <> 1 then
    raise exception 'member cannot read connection message through RLS';
  end if;
end;
$test$;

-- A nonmember sees no connection data and cannot read another profile.
select pg_temp.authenticate_as('10000000-0000-4000-8000-000000000003');
do $test$
begin
  if (select count(*) from public.connections) <> 0
     or (select count(*) from public.messages) <> 0
     or (select count(*) from public.favorites) <> 0 then
    raise exception 'nonmember data leaked through RLS';
  end if;
  if exists (
    select 1 from public.profiles
    where id = '10000000-0000-4000-8000-000000000001'
  ) then
    raise exception 'another user profile leaked through RLS';
  end if;
end;
$test$;

-- A used code is rejected, then repeated failed guesses hit the durable limit.
do $test$
declare
  v_result jsonb;
  i integer;
begin
  v_result := public.join_connection_by_code(current_setting('test.connection_code'));
  if v_result ->> 'error_code' <> 'CODE_ALREADY_USED' then
    raise exception 'used code was not rejected: %', v_result;
  end if;

  -- The call above is attempt 1 for this user. Attempts 2..10 remain semantic
  -- failures; attempt 11 must be rate-limited.
  for i in 2..10 loop
    v_result := public.join_connection_by_code('AAAA-AAAA');
    if v_result ->> 'error_code' <> 'CODE_NOT_FOUND' then
      raise exception 'unexpected pre-limit result on attempt %: %', i, v_result;
    end if;
  end loop;
  v_result := public.join_connection_by_code('AAAA-AAAA');
  if v_result ->> 'error_code' <> 'RATE_LIMITED'
     or coalesce((v_result ->> 'retry_after_seconds')::integer, 0) <= 0 then
    raise exception 'join limiter did not engage: %', v_result;
  end if;
end;
$test$;

-- Only the owner may reveal a private favorite; once shared, both can see it.
select pg_temp.authenticate_as('10000000-0000-4000-8000-000000000002');
do $test$
declare
  v_result jsonb;
begin
  if (select count(*) from public.favorites) <> 1 then
    raise exception 'favorite owner cannot read private favorite';
  end if;
  v_result := public.set_favorite_visibility(
    current_setting('test.favorite_id')::uuid, 'shared'
  );
  if v_result ->> 'visibility' <> 'shared' then
    raise exception 'favorite visibility was not updated: %', v_result;
  end if;
end;
$test$;

select pg_temp.authenticate_as('10000000-0000-4000-8000-000000000001');
do $test$
declare
  v_result jsonb;
begin
  if (select count(*) from public.favorites) <> 1 then
    raise exception 'shared favorite is not visible to partner';
  end if;

  begin
    perform public.generate_connection_code();
    raise exception 'expected ALREADY_CONNECTED';
  exception when others then
    if sqlerrm <> 'ALREADY_CONNECTED' then raise; end if;
  end;
end;
$test$;

-- Even a privileged direct write cannot create a third member: both slots are occupied.
reset role;
do $test$
declare
  v_connection_id uuid;
begin
  select c.id into strict v_connection_id
  from public.connections c
  where c.status = 'connected';
  begin
    insert into public.connection_members (connection_id, user_id, member_slot)
    values (v_connection_id, '10000000-0000-4000-8000-000000000003', 2);
    raise exception 'expected two-member constraint violation';
  exception when unique_violation then
    null;
  end;
end;
$test$;

set local role authenticated;
select pg_temp.authenticate_as('10000000-0000-4000-8000-000000000001');
do $test$
declare
  v_result jsonb := public.disconnect_connection();
begin
  if v_result ->> 'state' <> 'DISCONNECTED'
     or v_result ->> 'disconnected_at' is null then
    raise exception 'disconnect did not preserve terminal state: %', v_result;
  end if;
end;
$test$;

set constraints all immediate;
set constraints all deferred;

select pg_temp.authenticate_as('10000000-0000-4000-8000-000000000002');
do $test$
declare
  v_result jsonb := public.get_current_connection();
begin
  if v_result ->> 'state' <> 'DISCONNECTED' then
    raise exception 'partner cannot recover disconnected state: %', v_result;
  end if;
end;
$test$;

-- Terminal memberships are released, so a user can create and cancel a new pair.
select pg_temp.authenticate_as('10000000-0000-4000-8000-000000000001');
do $test$
declare
  v_result jsonb;
begin
  v_result := public.generate_connection_code();
  if v_result ->> 'state' <> 'PENDING' then
    raise exception 'new connection after disconnect failed: %', v_result;
  end if;
  v_result := public.cancel_connection();
  if v_result ->> 'state' <> 'CANCELLED' then
    raise exception 'cancel failed: %', v_result;
  end if;
  if public.get_current_connection() ->> 'state' <> 'CANCELLED' then
    raise exception 'cancelled terminal state was not recoverable';
  end if;
end;
$test$;

set constraints all immediate;
set constraints all deferred;

-- Force a generated code just past expiry and verify lazy cleanup survives refresh.
do $test$
declare
  v_result jsonb := public.generate_connection_code();
begin
  if v_result ->> 'state' <> 'PENDING' then
    raise exception 'expiry fixture generation failed: %', v_result;
  end if;
end;
$test$;

reset role;
update public.connection_codes
set expires_at = created_at + interval '1 microsecond'
where connection_id = (
  select c.id from public.connections c
  where c.status = 'pending'
  order by c.created_at desc
  limit 1
);

set local role authenticated;
select pg_temp.authenticate_as('10000000-0000-4000-8000-000000000001');
do $test$
declare
  v_result jsonb := public.get_current_connection();
begin
  if v_result ->> 'state' <> 'EXPIRED' then
    raise exception 'expired terminal state was not recovered: %', v_result;
  end if;
end;
$test$;

set constraints all immediate;
rollback;
