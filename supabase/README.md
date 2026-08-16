# Supabase - Ariramba Jiu-Jitsu School

Este projeto já está preparado para receber um banco online no Supabase.

## Quando a conta do cliente estiver criada

1. Acesse o painel do Supabase.
2. Crie um novo projeto.
3. Abra `SQL Editor`.
4. Cole e execute o conteúdo de `supabase/schema.sql`.
5. Vá em `Project Settings > API`.
6. Copie:
   - Project URL
   - anon public key
7. Crie um arquivo `.env.local` na raiz do projeto:

```env
VITE_SUPABASE_URL=https://seu-projeto.supabase.co
VITE_SUPABASE_ANON_KEY=sua-chave-anon-publica
```

8. Rode o projeto novamente:

```bash
npm run dev
```

## Criar o primeiro diretor

1. No Supabase, abra `Authentication > Users`.
2. Crie um usuário com e-mail e senha para o diretor.
3. Abra `supabase/bootstrap-diretor.sql`.
4. Troque `EMAIL_DO_DIRETOR_AQUI` pelo e-mail criado.
5. Rode o SQL no `SQL Editor`.

Sem esse passo, o banco fica protegido e o sistema não consegue gravar dados online.

## Observação

Enquanto essas chaves não existem, o sistema continua em modo local com backup JSON.
Depois que as chaves forem configuradas, a próxima etapa é ligar as telas ao Supabase.

