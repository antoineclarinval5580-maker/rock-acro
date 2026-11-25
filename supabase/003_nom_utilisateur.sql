-- Connexion par nom d'utilisateur : permet à l'admin de donner un nouveau mot de passe à un membre
-- (les comptes « nom d'utilisateur » n'ont pas de vraie adresse e-mail pour le réinitialiser).
-- À exécuter une fois dans Supabase : SQL Editor > New query > coller > Run.
create extension if not exists pgcrypto with schema extensions;

create or replace function public.admin_set_password(uid uuid, pw text) returns void
language plpgsql security definer set search_path = public, extensions, auth as $$
begin
  if not public.is_admin() then raise exception 'Réservé à l''admin'; end if;
  if length(pw) < 6 then raise exception '6 caractères minimum'; end if;
  update auth.users set encrypted_password = extensions.crypt(pw, extensions.gen_salt('bf')), updated_at = now() where id = uid;
end $$;
revoke all on function public.admin_set_password(uuid, text) from public, anon;
grant execute on function public.admin_set_password(uuid, text) to authenticated;
