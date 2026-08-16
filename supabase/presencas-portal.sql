grant select, insert, update, delete on public.presencas to anon, authenticated;

drop policy if exists "Site publicado consulta presencas" on public.presencas;
create policy "Site publicado consulta presencas"
on public.presencas
for select
to anon
using (true);

drop policy if exists "Site publicado registra presencas" on public.presencas;
create policy "Site publicado registra presencas"
on public.presencas
for insert
to anon
with check (true);

drop policy if exists "Site publicado atualiza presencas" on public.presencas;
create policy "Site publicado atualiza presencas"
on public.presencas
for update
to anon
using (true)
with check (true);

drop policy if exists "Site publicado remove presencas" on public.presencas;
create policy "Site publicado remove presencas"
on public.presencas
for delete
to anon
using (true);
