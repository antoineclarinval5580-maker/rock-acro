-- Rock Acro MJGO : schéma Supabase
-- À exécuter une fois dans SQL Editor.

-- ---------- Tables ----------
create table if not exists public.settings (
  id int primary key default 1 check (id = 1),
  signups_open boolean not null default false
);
insert into public.settings (id) values (1) on conflict do nothing;

create table if not exists public.profiles (
  id uuid primary key references auth.users on delete cascade,
  display_name text not null default '',
  is_admin boolean not null default false,
  created_at timestamptz not null default now()
);

create table if not exists public.moves (
  id text primary key default gen_random_uuid()::text,
  kind text not null check (kind in ('Porté','Passe','Combinaison','Danse')),
  name text not null,
  note text default '',
  diff int, risk int, spec int,
  source text,
  catalog boolean not null default false,
  video_path text,
  poster_path text,
  trim_start numeric,
  trim_end numeric,
  ord int not null default 0,
  created_at timestamptz not null default now()
);

create table if not exists public.user_videos (
  id uuid primary key default gen_random_uuid(),
  user_id uuid not null references public.profiles on delete cascade,
  move_id text not null references public.moves on delete cascade,
  video_path text not null,
  poster_path text,
  note text default '',
  size_bytes bigint default 0,
  created_at timestamptz not null default now()
);

create table if not exists public.progress (
  user_id uuid not null references public.profiles on delete cascade,
  move_id text not null references public.moves on delete cascade,
  status text not null check (status in ('a_apprendre','en_cours','maitrise')),
  updated_at timestamptz not null default now(),
  primary key (user_id, move_id)
);

create table if not exists public.progress_log (
  id uuid primary key default gen_random_uuid(),
  user_id uuid not null references public.profiles on delete cascade,
  move_id text not null references public.moves on delete cascade,
  status text,
  note text default '',
  created_at timestamptz not null default now()
);

-- ---------- Helpers ----------
create or replace function public.is_admin() returns boolean
language sql stable security definer set search_path = public as $$
  select coalesce((select is_admin from public.profiles where id = auth.uid()), false);
$$;

-- Création du profil à l'inscription. Le tout premier compte devient admin.
-- Quand les inscriptions sont fermées, les nouveaux comptes sont refusés.
create or replace function public.handle_new_user() returns trigger
language plpgsql security definer set search_path = public as $$
declare n int; open boolean;
begin
  select count(*) into n from public.profiles;
  select signups_open into open from public.settings where id = 1;
  if n > 0 and not coalesce(open, false) then
    raise exception 'Les inscriptions sont fermées pour le moment.';
  end if;
  insert into public.profiles (id, display_name, is_admin)
  values (new.id, coalesce(new.raw_user_meta_data->>'display_name', split_part(new.email, '@', 1)), n = 0);
  return new;
end $$;

drop trigger if exists on_auth_user_created on auth.users;
create trigger on_auth_user_created after insert on auth.users
  for each row execute function public.handle_new_user();

-- Un membre ne peut pas se donner le rôle admin lui-même
create or replace function public.protect_admin_flag() returns trigger
language plpgsql security definer set search_path = public as $$
begin
  if new.is_admin is distinct from old.is_admin and not public.is_admin() then
    new.is_admin := old.is_admin;
  end if;
  return new;
end $$;
drop trigger if exists protect_admin on public.profiles;
create trigger protect_admin before update on public.profiles
  for each row execute function public.protect_admin_flag();

-- ---------- Sécurité (RLS) ----------
alter table public.settings enable row level security;
alter table public.profiles enable row level security;
alter table public.moves enable row level security;
alter table public.user_videos enable row level security;
alter table public.progress enable row level security;
alter table public.progress_log enable row level security;

drop policy if exists "settings lecture" on public.settings;
create policy "settings lecture" on public.settings for select using (true);
drop policy if exists "settings admin" on public.settings;
create policy "settings admin" on public.settings for update using (public.is_admin());

drop policy if exists "profil lecture" on public.profiles;
create policy "profil lecture" on public.profiles for select using (id = auth.uid() or public.is_admin());
drop policy if exists "profil maj" on public.profiles;
create policy "profil maj" on public.profiles for update using (id = auth.uid() or public.is_admin());
drop policy if exists "profil suppr admin" on public.profiles;
create policy "profil suppr admin" on public.profiles for delete using (public.is_admin());

drop policy if exists "moves lecture" on public.moves;
create policy "moves lecture" on public.moves for select using (auth.uid() is not null);
drop policy if exists "moves admin" on public.moves;
create policy "moves admin" on public.moves for all using (public.is_admin()) with check (public.is_admin());

drop policy if exists "uv perso" on public.user_videos;
create policy "uv perso" on public.user_videos for all using (user_id = auth.uid()) with check (user_id = auth.uid());
drop policy if exists "uv admin lecture" on public.user_videos;
create policy "uv admin lecture" on public.user_videos for select using (public.is_admin());

drop policy if exists "progress perso" on public.progress;
create policy "progress perso" on public.progress for all using (user_id = auth.uid()) with check (user_id = auth.uid());
drop policy if exists "progress admin lecture" on public.progress;
create policy "progress admin lecture" on public.progress for select using (public.is_admin());

drop policy if exists "log perso" on public.progress_log;
create policy "log perso" on public.progress_log for all using (user_id = auth.uid()) with check (user_id = auth.uid());
drop policy if exists "log admin lecture" on public.progress_log;
create policy "log admin lecture" on public.progress_log for select using (public.is_admin());

-- ---------- Stockage ----------
insert into storage.buckets (id, name, public, file_size_limit)
values ('library', 'library', true, 52428800)
on conflict (id) do nothing;
insert into storage.buckets (id, name, public, file_size_limit)
values ('personal', 'personal', false, 52428800)
on conflict (id) do nothing;

drop policy if exists "library admin ecrit" on storage.objects;
create policy "library admin ecrit" on storage.objects for insert to authenticated
  with check (bucket_id = 'library' and public.is_admin());
drop policy if exists "library admin maj" on storage.objects;
create policy "library admin maj" on storage.objects for update to authenticated
  using (bucket_id = 'library' and public.is_admin());
drop policy if exists "library admin suppr" on storage.objects;
create policy "library admin suppr" on storage.objects for delete to authenticated
  using (bucket_id = 'library' and public.is_admin());

drop policy if exists "personal proprio" on storage.objects;
create policy "personal proprio" on storage.objects for all to authenticated
  using (bucket_id = 'personal' and (storage.foldername(name))[1] = auth.uid()::text)
  with check (bucket_id = 'personal' and (storage.foldername(name))[1] = auth.uid()::text);
drop policy if exists "personal admin lecture" on storage.objects;
create policy "personal admin lecture" on storage.objects for select to authenticated
  using (bucket_id = 'personal' and public.is_admin());
