# Supabase runtime setup

1. Copy `.env.example` to `.env.local` and set the project URL, anon (or
   publishable) key, and canonical `NEXT_PUBLIC_SITE_URL`. The site URL must be
   an exact HTTPS origin with no path or trailing slash; it is required outside
   localhost. These `NEXT_PUBLIC_*` values must be present when the client
   bundle is built. Never add a service-role or secret key to this app.
2. Enable Google in Supabase Auth. In Google Cloud, use the Supabase provider
   callback (`https://<project-ref>.supabase.co/auth/v1/callback`) as the OAuth
   redirect URI. In Supabase Auth URL Configuration, set the Site URL to the
   same canonical origin and allow the exact
   `https://<app-origin>/auth/callback` URL (plus the local equivalent during
   development). Avoid wildcard production redirect entries.
3. Apply the checked-in Supabase migration before running authenticated flows.

Connection-code expiry is authoritative database configuration, not a
client/server-action environment value. It defaults to 24 hours. An authorized
database administrator can change it (maximum 30 days) with:

```sql
update private.connection_system_config
set code_ttl = interval '24 hours'
where singleton;
```

The migration installs private, payload-free Realtime Broadcast triggers and
topic policies. The subscription helpers listen on a private per-user topic,
then refetch the sanitized RPC snapshot; they do not subscribe to table changes
or receive row payloads.

Auth cookies are host-only, `SameSite=Lax`, and `Secure` in production. They
remain browser-readable because the Supabase browser client must refresh the
session and authorize the private Realtime channel; the application never puts
a service-role credential in the browser.
