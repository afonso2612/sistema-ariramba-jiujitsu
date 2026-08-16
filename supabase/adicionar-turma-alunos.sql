alter table public.alunos
add column if not exists turma text not null default 'Adultos';

update public.alunos
set turma = 'Adultos'
where turma is null or trim(turma) = '';

alter table public.alunos
drop constraint if exists alunos_turma_check;

alter table public.alunos
add constraint alunos_turma_check
check (turma in ('Kids', 'Adultos'));
