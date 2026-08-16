create extension if not exists "pgcrypto";

create table if not exists public.profiles (
  id uuid primary key references auth.users(id) on delete cascade,
  nome text not null,
  cargo text not null check (cargo in ('diretor', 'professor', 'aluno')),
  aluno_id uuid,
  telefone text,
  criado_em timestamptz not null default now(),
  atualizado_em timestamptz not null default now()
);

create table if not exists public.alunos (
  id uuid primary key default gen_random_uuid(),
  nome text not null,
  telefone text,
  faixa text,
  grau text,
  responsavel text,
  data_nascimento date,
  data_inicio date,
  peso numeric(6, 2),
  mensalidade numeric(10, 2) not null default 0,
  vencimento smallint check (vencimento between 1 and 31),
  status_pagamento text not null default 'Pendente'
    check (status_pagamento in ('Pendente', 'Aguardando', 'Pago')),
  ultimo_pagamento date,
  tipo_sanguineo text,
  saude text,
  medicamentos text,
  observacoes text,
  observacao_financeira text,
  foto_url text,
  criado_em timestamptz not null default now(),
  atualizado_em timestamptz not null default now()
);

alter table public.profiles
  add constraint profiles_aluno_id_fkey
  foreign key (aluno_id) references public.alunos(id) on delete set null;

create table if not exists public.presencas (
  id uuid primary key default gen_random_uuid(),
  aluno_id uuid not null references public.alunos(id) on delete cascade,
  data date not null default current_date,
  hora time not null default localtime,
  registrado_por uuid references auth.users(id) on delete set null,
  criado_em timestamptz not null default now(),
  unique (aluno_id, data)
);

create table if not exists public.pagamentos (
  id uuid primary key default gen_random_uuid(),
  aluno_id uuid not null references public.alunos(id) on delete cascade,
  valor numeric(10, 2) not null default 0,
  status text not null default 'Pendente'
    check (status in ('Pendente', 'Aguardando', 'Pago', 'Rejeitado')),
  data_pagamento date,
  comprovante_url text,
  observacao text,
  confirmado_por uuid references auth.users(id) on delete set null,
  criado_em timestamptz not null default now(),
  atualizado_em timestamptz not null default now()
);

create table if not exists public.avisos (
  id uuid primary key default gen_random_uuid(),
  mensagem text not null,
  criado_por uuid references auth.users(id) on delete set null,
  criado_em timestamptz not null default now()
);

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

create index if not exists idx_alunos_nome on public.alunos using btree (nome);
create index if not exists idx_usuarios_sistema_usuario on public.usuarios_sistema (lower(usuario));
create index if not exists idx_presencas_aluno_data on public.presencas (aluno_id, data);
create index if not exists idx_pagamentos_aluno_status on public.pagamentos (aluno_id, status);

create or replace function public.atualizar_coluna_atualizado_em()
returns trigger
language plpgsql
as $$
begin
  new.atualizado_em = now();
  return new;
end;
$$;

drop trigger if exists atualizar_profiles_em on public.profiles;
create trigger atualizar_profiles_em
before update on public.profiles
for each row execute function public.atualizar_coluna_atualizado_em();

drop trigger if exists atualizar_alunos_em on public.alunos;
create trigger atualizar_alunos_em
before update on public.alunos
for each row execute function public.atualizar_coluna_atualizado_em();

drop trigger if exists atualizar_pagamentos_em on public.pagamentos;
create trigger atualizar_pagamentos_em
before update on public.pagamentos
for each row execute function public.atualizar_coluna_atualizado_em();

drop trigger if exists atualizar_usuarios_sistema_em on public.usuarios_sistema;
create trigger atualizar_usuarios_sistema_em
before update on public.usuarios_sistema
for each row execute function public.atualizar_coluna_atualizado_em();

alter table public.profiles enable row level security;
alter table public.alunos enable row level security;
alter table public.presencas enable row level security;
alter table public.pagamentos enable row level security;
alter table public.avisos enable row level security;
alter table public.usuarios_sistema enable row level security;

create or replace function public.usuario_equipe()
returns boolean
language sql
security definer
set search_path = public
as $$
  select exists (
    select 1
    from public.profiles
    where id = auth.uid()
      and cargo in ('diretor', 'professor')
  );
$$;

create or replace function public.usuario_diretor()
returns boolean
language sql
security definer
set search_path = public
as $$
  select exists (
    select 1
    from public.profiles
    where id = auth.uid()
      and cargo = 'diretor'
  );
$$;

create policy "Equipe gerencia alunos"
on public.alunos
for all
to authenticated
using (public.usuario_equipe())
with check (public.usuario_equipe());

create policy "Aluno ve proprio cadastro"
on public.alunos
for select
to authenticated
using (
  exists (
    select 1
    from public.profiles
    where profiles.id = auth.uid()
      and profiles.aluno_id = alunos.id
  )
);

create policy "Site publicado acessa alunos"
on public.alunos
for select
to anon
using (true);

create policy "Site publicado cadastra alunos"
on public.alunos
for insert
to anon
with check (true);

create policy "Site publicado atualiza alunos"
on public.alunos
for update
to anon
using (true)
with check (true);

create policy "Equipe gerencia presencas"
on public.presencas
for all
to authenticated
using (public.usuario_equipe())
with check (public.usuario_equipe());

create policy "Aluno ve proprias presencas"
on public.presencas
for select
to authenticated
using (
  exists (
    select 1
    from public.profiles
    where profiles.id = auth.uid()
      and profiles.aluno_id = presencas.aluno_id
  )
);

create policy "Site publicado consulta presencas"
on public.presencas
for select
to anon
using (true);

create policy "Site publicado registra presencas"
on public.presencas
for insert
to anon
with check (true);

create policy "Site publicado atualiza presencas"
on public.presencas
for update
to anon
using (true)
with check (true);

create policy "Site publicado remove presencas"
on public.presencas
for delete
to anon
using (true);

create policy "Diretor gerencia pagamentos"
on public.pagamentos
for all
to authenticated
using (public.usuario_diretor())
with check (public.usuario_diretor());

create policy "Aluno ve proprios pagamentos"
on public.pagamentos
for select
to authenticated
using (
  exists (
    select 1
    from public.profiles
    where profiles.id = auth.uid()
      and profiles.aluno_id = pagamentos.aluno_id
  )
);

create policy "Aluno envia comprovante proprio"
on public.pagamentos
for insert
to authenticated
with check (
  exists (
    select 1
    from public.profiles
    where profiles.id = auth.uid()
      and profiles.aluno_id = pagamentos.aluno_id
  )
);

create policy "Site publicado consulta pagamentos"
on public.pagamentos
for select
to anon
using (true);

create policy "Site publicado envia pagamentos"
on public.pagamentos
for insert
to anon
with check (true);

create policy "Site publicado atualiza pagamentos"
on public.pagamentos
for update
to anon
using (true)
with check (true);

create policy "Usuario ve proprio profile"
on public.profiles
for select
to authenticated
using (id = auth.uid() or public.usuario_equipe());

create policy "Diretor gerencia profiles"
on public.profiles
for all
to authenticated
using (public.usuario_diretor())
with check (public.usuario_diretor());

create policy "Equipe ve avisos"
on public.avisos
for select
to authenticated
using (public.usuario_equipe());

create policy "Equipe cria avisos"
on public.avisos
for insert
to authenticated
with check (public.usuario_equipe());

create policy "Site publicado consulta usuarios"
on public.usuarios_sistema
for select
to anon
using (true);

create policy "Site publicado cadastra usuarios"
on public.usuarios_sistema
for insert
to anon
with check (true);

create policy "Site publicado atualiza usuarios"
on public.usuarios_sistema
for update
to anon
using (true)
with check (true);

create policy "Site publicado remove usuarios"
on public.usuarios_sistema
for delete
to anon
using (true);

insert into storage.buckets (id, name, public)
values
  ('fotos-alunos', 'fotos-alunos', true),
  ('comprovantes', 'comprovantes', false)
on conflict (id) do nothing;
