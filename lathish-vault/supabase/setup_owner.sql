-- Manual alternative to `npm run create-owner`.
-- 1) Supabase Dashboard > Authentication > Users > Add user (auto-confirm), copy the user's UUID.
-- 2) Run this in the SQL editor, replacing the UUID:
insert into public.vault_profile (owner_id) values ('00000000-0000-0000-0000-000000000000');
-- 3) Set OWNER_USER_ID to that UUID in Vercel. Then disable sign-ups (Authentication > Providers > Email).
