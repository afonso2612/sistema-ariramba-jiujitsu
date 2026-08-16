create extension if not exists "pgcrypto";

create table if not exists public.academias (
  id uuid primary key default gen_random_uuid(),
  nome text not null unique,
  criado_em timestamptz not null default now()
);

insert into public.academias (nome)
values ('Ariramba Jiu-Jitsu School')
on conflict (nome) do nothing;

alter table public.profiles
  add column if not exists academia_id uuid;

alter table public.alunos
  add column if not exists academia_id uuid,
  add column if not exists auth_user_id uuid,
  add column if not exists turma text not null default 'Adultos';

alter table public.usuarios_sistema
  add column if not exists academia_id uuid;

update public.profiles
set academia_id = (select id from public.academias where nome = 'Ariramba Jiu-Jitsu School')
where academia_id is null;

update public.alunos
set academia_id = (select id from public.academias where nome = 'Ariramba Jiu-Jitsu School')
where academia_id is null;

update public.usuarios_sistema
set academia_id = (select id from public.academias where nome = 'Ariramba Jiu-Jitsu School')
where academia_id is null;

alter table public.alunos
drop constraint if exists alunos_turma_check;

alter table public.alunos
add constraint alunos_turma_check
check (turma in ('Kids', 'Adultos'));

do $$
begin
  if not exists (select 1 from pg_constraint where conname = 'profiles_academia_id_fkey') then
    alter table public.profiles
      add constraint profiles_academia_id_fkey
      foreign key (academia_id) references public.academias(id) on delete restrict;
  end if;

  if not exists (select 1 from pg_constraint where conname = 'alunos_academia_id_fkey') then
    alter table public.alunos
      add constraint alunos_academia_id_fkey
      foreign key (academia_id) references public.academias(id) on delete restrict;
  end if;

  if not exists (select 1 from pg_constraint where conname = 'alunos_auth_user_id_fkey') then
    alter table public.alunos
      add constraint alunos_auth_user_id_fkey
      foreign key (auth_user_id) references auth.users(id) on delete set null;
  end if;

  if not exists (select 1 from pg_constraint where conname = 'usuarios_sistema_academia_id_fkey') then
    alter table public.usuarios_sistema
      add constraint usuarios_sistema_academia_id_fkey
      foreign key (academia_id) references public.academias(id) on delete restrict;
  end if;
end $$;

alter table public.profiles alter column academia_id set not null;
alter table public.alunos alter column academia_id set not null;
alter table public.usuarios_sistema alter column academia_id set not null;

create unique index if not exists idx_alunos_auth_user_id
on public.alunos (auth_user_id)
where auth_user_id is not null;

create index if not exists idx_profiles_academia_id on public.profiles (academia_id);
create index if not exists idx_alunos_academia_id on public.alunos (academia_id);
create index if not exists idx_usuarios_sistema_academia_id on public.usuarios_sistema (academia_id);

create or replace function public.usuario_academia_id()
returns uuid
language sql
security definer
set search_path = public
as $$
  select academia_id
  from public.profiles
  where id = auth.uid()
$$;

create or replace function public.usuario_cargo()
returns text
language sql
security definer
set search_path = public
as $$
  select cargo
  from public.profiles
  where id = auth.uid()
$$;

create or replace function public.usuario_equipe()
returns boolean
language sql
security definer
set search_path = public
as $$
  select public.usuario_cargo() in ('diretor', 'professor')
$$;

create or replace function public.usuario_diretor()
returns boolean
language sql
security definer
set search_path = public
as $$
  select public.usuario_cargo() = 'diretor'
$$;

alter table public.academias enable row level security;

drop policy if exists "Equipe gerencia alunos" on public.alunos;
drop policy if exists "Aluno ve proprio cadastro" on public.alunos;
drop policy if exists "Site publicado acessa alunos" on public.alunos;
drop policy if exists "Site publicado cadastra alunos" on public.alunos;
drop policy if exists "Site publicado atualiza alunos" on public.alunos;

create policy "Diretor gerencia alunos da academia"
on public.alunos
for all
to authenticated
using (public.usuario_diretor() and academia_id = public.usuario_academia_id())
with check (public.usuario_diretor() and academia_id = public.usuario_academia_id());

create policy "Professor ve alunos da academia"
on public.alunos
for select
to authenticated
using (public.usuario_cargo() = 'professor' and academia_id = public.usuario_academia_id());

create policy "Aluno ve proprio cadastro"
on public.alunos
for select
to authenticated
using (
  auth_user_id = auth.uid()
  or exists (
    select 1
    from public.profiles
    where profiles.id = auth.uid()
      and profiles.aluno_id = alunos.id
      and profiles.academia_id = alunos.academia_id
  )
);

create policy "Aluno atualiza proprio cadastro"
on public.alunos
for update
to authenticated
using (
  auth_user_id = auth.uid()
  or exists (
    select 1
    from public.profiles
    where profiles.id = auth.uid()
      and profiles.aluno_id = alunos.id
      and profiles.academia_id = alunos.academia_id
  )
)
with check (
  auth_user_id = auth.uid()
  or exists (
    select 1
    from public.profiles
    where profiles.id = auth.uid()
      and profiles.aluno_id = alunos.id
      and profiles.academia_id = alunos.academia_id
  )
);

drop policy if exists "Equipe gerencia presencas" on public.presencas;
drop policy if exists "Aluno ve proprias presencas" on public.presencas;
drop policy if exists "Site publicado consulta presencas" on public.presencas;
drop policy if exists "Site publicado registra presencas" on public.presencas;
drop policy if exists "Site publicado atualiza presencas" on public.presencas;
drop policy if exists "Site publicado remove presencas" on public.presencas;

create policy "Equipe gerencia presencas da academia"
on public.presencas
for all
to authenticated
using (
  public.usuario_equipe()
  and exists (
    select 1 from public.alunos
    where alunos.id = presencas.aluno_id
      and alunos.academia_id = public.usuario_academia_id()
  )
)
with check (
  public.usuario_equipe()
  and exists (
    select 1 from public.alunos
    where alunos.id = presencas.aluno_id
      and alunos.academia_id = public.usuario_academia_id()
  )
);

create policy "Aluno ve proprias presencas"
on public.presencas
for select
to authenticated
using (
  exists (
    select 1 from public.alunos
    where alunos.id = presencas.aluno_id
      and (
        alunos.auth_user_id = auth.uid()
        or exists (
          select 1 from public.profiles
          where profiles.id = auth.uid()
            and profiles.aluno_id = alunos.id
        )
      )
  )
);

drop policy if exists "Diretor gerencia pagamentos" on public.pagamentos;
drop policy if exists "Aluno ve proprios pagamentos" on public.pagamentos;
drop policy if exists "Aluno envia comprovante proprio" on public.pagamentos;
drop policy if exists "Site publicado consulta pagamentos" on public.pagamentos;
drop policy if exists "Site publicado envia pagamentos" on public.pagamentos;
drop policy if exists "Site publicado atualiza pagamentos" on public.pagamentos;

create policy "Diretor gerencia pagamentos da academia"
on public.pagamentos
for all
to authenticated
using (
  public.usuario_diretor()
  and exists (
    select 1 from public.alunos
    where alunos.id = pagamentos.aluno_id
      and alunos.academia_id = public.usuario_academia_id()
  )
)
with check (
  public.usuario_diretor()
  and exists (
    select 1 from public.alunos
    where alunos.id = pagamentos.aluno_id
      and alunos.academia_id = public.usuario_academia_id()
  )
);

create policy "Aluno ve proprios pagamentos"
on public.pagamentos
for select
to authenticated
using (
  exists (
    select 1 from public.alunos
    where alunos.id = pagamentos.aluno_id
      and (
        alunos.auth_user_id = auth.uid()
        or exists (
          select 1 from public.profiles
          where profiles.id = auth.uid()
            and profiles.aluno_id = alunos.id
        )
      )
  )
);

create policy "Aluno envia comprovante proprio"
on public.pagamentos
for insert
to authenticated
with check (
  exists (
    select 1 from public.alunos
    where alunos.id = pagamentos.aluno_id
      and (
        alunos.auth_user_id = auth.uid()
        or exists (
          select 1 from public.profiles
          where profiles.id = auth.uid()
            and profiles.aluno_id = alunos.id
        )
      )
  )
);

drop policy if exists "Usuario ve proprio profile" on public.profiles;
drop policy if exists "Diretor gerencia profiles" on public.profiles;

create policy "Usuario ve profile da academia"
on public.profiles
for select
to authenticated
using (
  id = auth.uid()
  or (public.usuario_equipe() and academia_id = public.usuario_academia_id())
);

create policy "Diretor gerencia profiles da academia"
on public.profiles
for all
to authenticated
using (public.usuario_diretor() and academia_id = public.usuario_academia_id())
with check (public.usuario_diretor() and academia_id = public.usuario_academia_id());

drop policy if exists "Site publicado consulta usuarios" on public.usuarios_sistema;
drop policy if exists "Site publicado cadastra usuarios" on public.usuarios_sistema;
drop policy if exists "Site publicado atualiza usuarios" on public.usuarios_sistema;
drop policy if exists "Site publicado remove usuarios" on public.usuarios_sistema;
drop policy if exists "Site publicado gerencia usuarios anon" on public.usuarios_sistema;
drop policy if exists "Site publicado gerencia usuarios autenticado" on public.usuarios_sistema;

create policy "Diretor gerencia usuarios sistema da academia"
on public.usuarios_sistema
for all
to authenticated
using (public.usuario_diretor() and academia_id = public.usuario_academia_id())
with check (public.usuario_diretor() and academia_id = public.usuario_academia_id());

create policy "Usuario ve propria academia"
on public.academias
for select
to authenticated
using (id = public.usuario_academia_id());
