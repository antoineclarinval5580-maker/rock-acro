-- Accès validé par l'admin : liste d'e-mails autorisés + comptes en attente
alter table public.profiles add column if not exists email text;
alter table public.profiles add column if not exists approved boolean not null default false;
update public.profiles p set email = u.email from auth.users u where u.id = p.id and p.email is null;
update public.profiles set approved = true where is_admin;

create table if not exists public.allowed_emails (
  email text primary key,
  added_at timestamptz not null default now()
);
alter table public.allowed_emails enable row level security;
drop policy if exists "emails admin" on public.allowed_emails;
create policy "emails admin" on public.allowed_emails for all using (public.is_admin()) with check (public.is_admin());

create or replace function public.is_member() returns boolean
language sql stable security definer set search_path = public as $$
  select coalesce((select approved from public.profiles where id = auth.uid()), false);
$$;

-- Inscription : inscriptions fermées => seuls les e-mails de la liste peuvent créer un compte.
-- Inscriptions ouvertes => tout le monde peut créer un compte, mais il reste « en attente »
-- tant que l'admin ne l'a pas accepté (sauf si son e-mail est déjà dans la liste).
create or replace function public.handle_new_user() returns trigger
language plpgsql security definer set search_path = public as $$
declare n int; open boolean; invited boolean;
begin
  select count(*) into n from public.profiles;
  select signups_open into open from public.settings where id = 1;
  select exists(select 1 from public.allowed_emails where email = lower(new.email)) into invited;
  if n > 0 and not coalesce(open, false) and not invited then
    raise exception 'Les inscriptions sont fermées pour le moment.';
  end if;
  insert into public.profiles (id, display_name, email, is_admin, approved)
  values (new.id, coalesce(new.raw_user_meta_data->>'display_name', split_part(new.email, '@', 1)),
          lower(new.email), n = 0, n = 0 or invited);
  return new;
end $$;

-- Ajouter un e-mail à la liste valide aussi le compte s'il existe déjà
create or replace function public.approve_on_allow() returns trigger
language plpgsql security definer set search_path = public as $$
begin
  new.email := lower(trim(new.email));
  update public.profiles set approved = true where email = new.email;
  return new;
end $$;
drop trigger if exists allow_approves on public.allowed_emails;
create trigger allow_approves before insert on public.allowed_emails
  for each row execute function public.approve_on_allow();

-- Un membre ne peut changer ni son rôle admin ni sa validation
create or replace function public.protect_admin_flag() returns trigger
language plpgsql security definer set search_path = public as $$
begin
  if not public.is_admin() then
    new.is_admin := old.is_admin;
    new.approved := old.approved;
    new.email := old.email;
  end if;
  return new;
end $$;

-- Les fiches et l'espace perso ne sont accessibles qu'aux membres validés
drop policy if exists "moves lecture" on public.moves;
create policy "moves lecture" on public.moves for select using (public.is_member());

drop policy if exists "uv perso" on public.user_videos;
create policy "uv perso" on public.user_videos for all using (user_id = auth.uid() and public.is_member()) with check (user_id = auth.uid() and public.is_member());
drop policy if exists "progress perso" on public.progress;
create policy "progress perso" on public.progress for all using (user_id = auth.uid() and public.is_member()) with check (user_id = auth.uid() and public.is_member());
drop policy if exists "log perso" on public.progress_log;
create policy "log perso" on public.progress_log for all using (user_id = auth.uid() and public.is_member()) with check (user_id = auth.uid() and public.is_member());

drop policy if exists "personal proprio" on storage.objects;
create policy "personal proprio" on storage.objects for all to authenticated
  using (bucket_id = 'personal' and (storage.foldername(name))[1] = auth.uid()::text and public.is_member())
  with check (bucket_id = 'personal' and (storage.foldername(name))[1] = auth.uid()::text and public.is_member());
