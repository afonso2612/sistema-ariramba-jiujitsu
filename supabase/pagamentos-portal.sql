grant select, insert, update on public.pagamentos to anon, authenticated;

drop policy if exists "Site publicado consulta pagamentos" on public.pagamentos;
create policy "Site publicado consulta pagamentos"
on public.pagamentos
for select
to anon
using (true);

drop policy if exists "Site publicado envia pagamentos" on public.pagamentos;
create policy "Site publicado envia pagamentos"
on public.pagamentos
for insert
to anon
with check (true);

drop policy if exists "Site publicado atualiza pagamentos" on public.pagamentos;
create policy "Site publicado atualiza pagamentos"
on public.pagamentos
for update
to anon
using (true)
with check (true);
