# OurTube

OurTube is a private, two-person space for sharing YouTube videos, Shorts,
messages, reactions, and favorites. Either signed-in person can create a secure,
one-time connection code; the other person joins with that code to open their
shared space.

## What is enforced

- Google sign-in uses Supabase Auth with PKCE and cookie-backed server sessions.
- Codes use unbiased cryptographic randomness and the unambiguous alphabet
  `ABCDEFGHJKMNPQRSTUVWXYZ23456789` in `XXXX-XXXX` format.
- Generation, joining, cancellation, expiry, and soft disconnects run in
  database functions with transaction locks and deferred invariants.
- A partial unique index permits only one active connection per user, while
  member slots and deferred checks cap every connection at exactly two people.
- Every shared resource carries `connection_id`. Row-level security is enabled
  on every exposed table, while the application writes through narrow RPCs.
- Supabase Realtime sends payload-free, private per-user invalidations; clients
  then reload sanitized snapshots. Private-favorite details never enter events.
- Disconnecting closes both members' access without deleting their history.

## Stack

- Native Next.js deployment for Vercel
- Optional vinext build for Cloudflare Workers and Sites
- Supabase Auth, Postgres, Row Level Security, RPC, and Realtime Broadcast
- TypeScript and plain responsive CSS

## Set up Supabase

1. Create a Supabase project and enable only the Google provider under
   **Authentication > Providers**. Disable other sign-in providers for this
   Google-only application.
2. In Google Cloud, add Supabase's provider callback as an authorized redirect:
   `https://<project-ref>.supabase.co/auth/v1/callback`.
3. In Supabase Auth URL Configuration, allow your application callback, for
   example `http://localhost:3000/auth/callback` and the corresponding deployed
   HTTPS URL.
4. Apply
   [`supabase/migrations/202609070001_private_connections.sql`](supabase/migrations/202609070001_private_connections.sql)
   through the Supabase CLI or SQL migration workflow.
5. Copy `.env.example` to `.env.local` and provide the project URL and anon (or
   publishable) key. Never put a service-role key in this application.

```dotenv
NEXT_PUBLIC_SUPABASE_URL=https://your-project-ref.supabase.co
NEXT_PUBLIC_SUPABASE_ANON_KEY=your-anon-or-publishable-key
NEXT_PUBLIC_SITE_URL=http://localhost:3000
```

The code lifetime is database-owned and defaults to 24 hours. An administrator
can change it from one minute up to 30 days:

```sql
update private.connection_system_config
set code_ttl = interval '24 hours'
where singleton;
```

Content mutations are also database-limited so direct RPC clients cannot bypass
the UI and amplify writes through Realtime. Defaults are 30 messages, 60
reactions, and 20 favorite operations per person per minute, with pair-wide
limits of 60, 120, and 40. Retained rows are capped at 10,000 messages, 20,000
reactions, and 1,000 favorites per connection. Administrators can tune these
values in `private.content_quota_config`; reaching a hard cap blocks new rows
until content is archived or removed administratively.

## Run and verify

Node.js 22.13 or newer is required.

```bash
npm install
npm run dev
```

Useful checks:

```bash
npm run typecheck
npm run lint
npm run db:check
npm test
```

`npm test` validates both the native Next.js and Worker builds, then runs
source, security-contract, and rendered-response tests. Applying the SQL to a
Supabase staging project is still required before exercising the authenticated
end-to-end flow.

For Vercel, keep the Framework Preset set to **Next.js**, use the repository's
default `npm run build`, and leave Output Directory unset so Vercel reads the
standard `.next` output. The Cloudflare/Sites build remains available as
`npm run build:sites`.

## Production checklist

- Configure all three public environment variables at build/runtime. Set
  `NEXT_PUBLIC_SITE_URL` to the exact canonical HTTPS origin (without a path or
  trailing slash).
- Register the exact production `/auth/callback` URL in Supabase.
- Apply migrations before deploying the matching application version.
- Disable **Allow public access** in Supabase Realtime settings; OurTube uses
  authenticated private Broadcast topics exclusively.
- Keep the site itself public enough for both partners to reach the Google login;
  privacy is enforced by Supabase authentication, RPC authorization, and RLS.
- Monitor authentication, RPC, and Realtime failures without logging connection
  codes, message bodies, or private favorite details.
- Plan an administrative archival policy before raising the retained-content
  caps.

See [`lib/supabase/README.md`](lib/supabase/README.md) for runtime-specific notes.
