-- 110: only an owner changes a role.
--
-- Every owner only rule in this app trusts public.current_user_role(), which
-- reads profiles.role. But profiles_update_self_or_owner (001) lets a signed
-- in user update their OWN profiles row with no column limit and no WITH
-- CHECK, so any editor or viewer could open the browser console, run
--   supabase.from('profiles').update({ role: 'owner' }).eq('id', myId)
-- and be an owner. From there they could cancel any credit note (109), which
-- puts the credit back on the invoice so its pay link charges the full amount
-- again, and a viewer could raise or refund credit notes too. posupject closed
-- the same hole in its 114_onboarding_secure.sql; this is that guard, as is.
--
-- Apply it BEFORE or together with 109_credit_notes.sql: the credit notes
-- owner only Cancel is not really owner only without it.
--
-- Checked for the API roles only (authenticated and anon, the roles PostgREST
-- runs a signed in or anonymous request as). The service role, the SQL editor
-- and the security definer handle_new_user() from 001, which makes the very
-- first user the owner, run as other roles and are not stopped. Not security
-- definer itself, so current_user is the caller. In a BEFORE trigger
-- current_user_role() still reads the row as it was, so nobody can pass the
-- check by being mid way through promoting themselves. An owner changing
-- someone's role from Users (UsersPanel) still works, and so does anyone
-- editing their own name or other profile fields.
--
-- Idempotent: safe to run twice.
--
-- CHECK AFTER APPLYING, signed in as an editor (not with the service key):
--   update public.profiles set role = 'owner' where id = auth.uid();
-- must fail with "Only an owner can change a role."
--
-- ROLLBACK (it protects every owner only rule, not just credit notes):
--   drop trigger if exists profiles_guard_role on public.profiles;
--   drop function if exists public.profiles_guard_role();

create or replace function public.profiles_guard_role() returns trigger
language plpgsql
set search_path = public
as $$
begin
  if new.role is distinct from old.role
     and current_user in ('authenticated', 'anon')
     and public.current_user_role() is distinct from 'owner' then
    raise exception 'Only an owner can change a role.' using errcode = '42501';
  end if;
  return new;
end;
$$;

drop trigger if exists profiles_guard_role on public.profiles;
create trigger profiles_guard_role
  before update on public.profiles
  for each row execute function public.profiles_guard_role();
