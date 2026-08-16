-- Rode este arquivo depois de criar o primeiro usuário em Authentication > Users.
-- Troque o e-mail abaixo pelo e-mail usado no cadastro do diretor.

insert into public.profiles (id, nome, cargo)
select id, 'Mestre', 'diretor'
from auth.users
where email = 'EMAIL_DO_DIRETOR_AQUI'
on conflict (id) do update
set nome = excluded.nome,
    cargo = excluded.cargo;
