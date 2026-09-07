import assert from "node:assert/strict";
import { readFile } from "node:fs/promises";
import test from "node:test";

const migrationUrl = new URL(
  "../supabase/migrations/202609070001_private_connections.sql",
  import.meta.url,
);
const databaseTestUrl = new URL(
  "../supabase/tests/private_connections.sql",
  import.meta.url,
);

const migration = await readFile(migrationUrl, "utf8");
const databaseTest = await readFile(databaseTestUrl, "utf8");

test("private connection schema and atomic RPC boundary are present", () => {
  for (const table of [
    "profiles",
    "connections",
    "connection_codes",
    "connection_members",
    "conversations",
    "messages",
    "message_reactions",
    "favorites",
  ]) {
    assert.match(migration, new RegExp(`create table public\\.${table} \\(`, "i"));
  }

  for (const rpc of [
    "generate_connection_code",
    "join_connection_by_code",
    "cancel_connection",
    "disconnect_connection",
    "get_current_connection",
    "get_connected_content",
    "send_message",
    "toggle_message_reaction",
    "toggle_favorite",
    "set_favorite_visibility",
  ]) {
    assert.match(
      migration,
      new RegExp(`create function public\\.${rpc}\\(`, "i"),
      `missing public RPC ${rpc}`,
    );
  }

  assert.match(migration, /security invoker set search_path = ''/i);
  assert.match(
    migration,
    /connection_members_one_active_connection_per_user[\s\S]*where left_at is null/i,
  );
  assert.match(migration, /member_slot smallint not null check \(member_slot in \(1, 2\)\)/i);
  assert.match(migration, /create constraint trigger connections_assert_invariants/i);
  assert.match(migration, /pg_advisory_xact_lock/i);
  assert.match(migration, /for update of cc, c/i);
});

test("codes, expiry, auth, throttling, and media inputs are database-enforced", () => {
  assert.match(migration, /extensions\.gen_random_bytes\(16\)/i);
  assert.match(
    migration,
    /ABCDEFGHJKMNPQRSTUVWXYZ23456789\]\{4\}-\[ABCDEFGHJKMNPQRSTUVWXYZ23456789\]\{4\}/,
  );
  assert.match(migration, /code_ttl interval not null default interval '24 hours'/i);
  assert.match(migration, /create table private\.connection_join_attempts/i);
  assert.match(migration, /'error_code', 'RATE_LIMITED'/i);
  assert.match(migration, /message = 'GOOGLE_AUTH_REQUIRED'/i);
  assert.match(migration, /youtube_video_id ~ '\^\[A-Za-z0-9_-\]\{11\}\$'/);
  assert.match(migration, /https:\/\/www\.youtube\.com\/watch\?v=/);
  assert.match(migration, /https:\/\/www\.youtube\.com\/shorts\//);
});

test("content mutations have server-owned rate limits and hard retained-row caps", () => {
  assert.match(migration, /create table private\.content_quota_config \(/i);
  assert.match(migration, /create table private\.content_mutation_counters \(/i);
  assert.match(
    migration,
    /\('message', 30, 60, interval '1 minute', 10000\)/i,
  );
  assert.match(
    migration,
    /\('reaction', 60, 120, interval '1 minute', 20000\)/i,
  );
  assert.match(
    migration,
    /\('favorite', 20, 40, interval '1 minute', 1000\)/i,
  );
  assert.match(
    migration,
    /create function private\.consume_content_mutation\([\s\S]*?security definer[\s\S]*?set search_path = ''/i,
  );
  assert.match(
    migration,
    /scope_kind = 'connection'[\s\S]*?for update;[\s\S]*?scope_kind = 'user'[\s\S]*?for update;/i,
  );

  const limiterCalls =
    migration.match(/private\.consume_content_mutation\(/gi) ?? [];
  assert.ok(limiterCalls.length >= 5, "all four mutation RPCs must use the limiter");
  assert.match(migration, /'error_code', 'RATE_LIMITED'/i);
  assert.match(migration, /'error_code', 'QUOTA_EXCEEDED'/i);
  for (const resource of ["messages", "message_reactions", "favorites"]) {
    assert.match(migration, new RegExp(`'resource', '${resource}'`, "i"));
  }
  assert.match(
    migration,
    /revoke all on private\.connection_system_config, private\.connection_join_attempts,[\s\S]*?private\.content_quota_config, private\.content_mutation_counters[\s\S]*?from public, anon, authenticated;/i,
  );
  assert.match(
    migration,
    /revoke execute on function private\.consume_content_mutation\(uuid, uuid, text\)[\s\S]*?from public, anon, authenticated;/i,
  );
});

test("RLS, private favorites, and minimized private Broadcast are configured", () => {
  const rlsTables = [
    "profiles",
    "connections",
    "connection_codes",
    "connection_members",
    "conversations",
    "messages",
    "message_reactions",
    "favorites",
  ];
  for (const table of rlsTables) {
    assert.match(
      migration,
      new RegExp(`alter table public\\.${table} enable row level security`, "i"),
      `RLS is not enabled for ${table}`,
    );
  }

  assert.match(
    migration,
    /visibility = 'shared' or created_by = \(select auth\.uid\(\)\)/i,
  );
  assert.match(migration, /create function private\.broadcast_private_refresh\(\)/i);
  assert.match(migration, /jsonb_build_object\('refresh', true, 'kind', v_kind\)/i);
  assert.match(migration, /realtime\.messages\.extension = 'broadcast'/i);
  assert.match(migration, /v_notify_pair := old\.visibility = 'shared' or new\.visibility = 'shared'/i);
  assert.doesNotMatch(migration, /alter publication supabase_realtime add table/i);
  assert.doesNotMatch(
    migration,
    /grant select, insert, update, delete on public\.messages/i,
  );
});

test("every private SECURITY DEFINER function fixes its search path", () => {
  const functions = migration.match(/create function private\.[\s\S]*?\$function\$;/gi) ?? [];
  assert.ok(functions.length >= 20);
  for (const fn of functions) {
    if (/security definer/i.test(fn)) {
      assert.match(fn, /set search_path = ''/i);
    }
  }
});

test("rollback-only database behavior suite covers lifecycle and isolation", () => {
  assert.match(databaseTest, /^begin;/m);
  assert.match(databaseTest, /^rollback;/m);
  for (const state of ["PENDING", "CONNECTED", "DISCONNECTED", "CANCELLED", "EXPIRED"]) {
    assert.match(databaseTest, new RegExp(`'${state}'`));
  }
  for (const rejection of [
    "SELF_CONNECTION",
    "CODE_ALREADY_USED",
    "RATE_LIMITED",
    "ALREADY_CONNECTED",
  ]) {
    assert.match(databaseTest, new RegExp(`'${rejection}'`));
  }
  assert.match(databaseTest, /nonmember data leaked through RLS/i);
  assert.match(databaseTest, /partner private favorite leaked/i);
  assert.match(databaseTest, /expected two-member constraint violation/i);
  assert.match(databaseTest, /message connection limiter did not engage across users/i);
  assert.match(databaseTest, /reaction user limiter did not engage/i);
  assert.match(databaseTest, /favorite user limiter did not engage/i);
  assert.match(databaseTest, /message retained-row cap did not engage/i);
  assert.match(databaseTest, /reaction retained-row cap did not engage/i);
  assert.match(databaseTest, /favorite retained-row cap did not engage/i);
  assert.match(databaseTest, /rate-limited mutation changed retained content/i);
  assert.match(databaseTest, /quota-exceeded mutation changed retained content/i);
});
