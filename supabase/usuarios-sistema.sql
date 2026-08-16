create table if not exists public.usuarios_sistema (
  id uuid primary key default gen_random_uuid(),
  usuario text not null unique,
  senha text not null,
  cargo text not null check (cargo in ('diretor', 'professor', 'aluno')),
  nome text not null,
  aluno_id uuid references public.alunos(id) on delete cascade,
  criado_em timestamptz not null default now(),
  atualizado_em timestamptz not null default now()
);

create index if not exists idx_usuarios_sistema_usuario
on public.usuarios_sistema (lower(usuario));

drop trigger if exists atualizar_usuarios_sistema_em on public.usuarios_sistema;
create trigger atualizar_usuarios_sistema_em
before update on public.usuarios_sistema
for each row execute function public.atualizar_coluna_atualizado_em();

alter table public.usuarios_sistema enable row level security;

grant usage on schema public to anon, authenticated;
grant select, insert, update, delete on public.usuarios_sistema to anon, authenticated;
grant select, insert, update on public.alunos to anon, authenticated;

drop policy if exists "Site publicado acessa alunos" on public.alunos;
create policy "Site publicado acessa alunos"
on public.alunos
for select
to anon
using (true);

drop policy if exists "Site publicado cadastra alunos" on public.alunos;
create policy "Site publicado cadastra alunos"
on public.alunos
for insert
to anon
with check (true);

drop policy if exists "Site publicado atualiza alunos" on public.alunos;
create policy "Site publicado atualiza alunos"
on public.alunos
for update
to anon
using (true)
with check (true);

drop policy if exists "Site publicado gerencia usuarios anon" on public.usuarios_sistema;
create policy "Site publicado gerencia usuarios anon"
on public.usuarios_sistema
for all
to anon
using (true)
with check (true);

drop policy if exists "Site publicado gerencia usuarios autenticado" on public.usuarios_sistema;
create policy "Site publicado gerencia usuarios autenticado"
on public.usuarios_sistema
for all
to authenticated
using (true)
with check (true);
