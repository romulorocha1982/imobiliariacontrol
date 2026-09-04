# Imobiliária Control

Sistema de gestão para imobiliárias: carteira de imóveis, contratos de locação,
financeiro (aluguéis, repasses, comissões, inadimplência) e CRM de vendas —
com login, permissões por cargo e log de auditoria.

**Stack:** React + TypeScript + Vite · Supabase (Postgres, Auth, Storage) · Netlify

---

## Sumário

- [O que o sistema faz](#o-que-o-sistema-faz)
- [Passo 1 — Criar o banco no Supabase](#passo-1--criar-o-banco-no-supabase)
- [Passo 2 — Rodar na sua máquina](#passo-2--rodar-na-sua-máquina)
- [Passo 3 — Publicar no Netlify](#passo-3--publicar-no-netlify)
- [Cargos e permissões](#cargos-e-permissões)
- [Como entregar o sistema a uma imobiliária](#como-entregar-o-sistema-a-uma-imobiliária)
- [Como adicionar pessoas à equipe](#como-adicionar-pessoas-à-equipe)
- [Rotina de uso](#rotina-de-uso)
- [Estrutura do projeto](#estrutura-do-projeto)
- [Segurança](#segurança)

---

## O que o sistema faz

| Módulo | Cobertura |
|---|---|
| **Imóveis** | Cadastro com endereço, características, valores, taxa de administração e comissão. Visão em cards ou tabela, busca e filtros por status/tipo/finalidade. Código automático por imobiliária (`IM-0001`). |
| **Proprietários** | Dados pessoais, endereço e dados bancários/PIX para repasse. Contagem de imóveis por proprietário. |
| **Clientes** | Inquilinos, compradores, interessados e fiadores num cadastro só. Renda e perfil para análise de locação. Validação real de CPF/CNPJ. |
| **Contratos** | Vigência, dia de vencimento, índice e mês de reajuste, garantia (fiador, caução, seguro-fiança). Numeração automática por imobiliária (`CT-2026-0001`), alerta de vencimento em 90/30 dias. |
| **Financeiro** | Contas a receber e a pagar, baixa de pagamento com valor/data/forma, marcação automática de atraso, totais do mês e saldo realizado. |
| **CRM** | Funil kanban com arrastar-e-soltar entre etapas, valor de proposta, origem do contato e motivo de perda. |
| **Usuários** | Criação de acesso com login e senha, gestão de cargos, redefinição de senha e ativação/desativação. Trava, no banco, que impede deixar a imobiliária sem administrador. |
| **Auditoria** | Registro automático de toda criação, alteração e exclusão, com comparação campo a campo do antes/depois. |
| **Imobiliárias** | Área do dono da plataforma: cadastra cada cliente, gera o código de acesso, acompanha o uso e suspende ou reativa contas — sem enxergar os dados de ninguém. |

O painel inicial reúne indicadores, gráfico de receitas × despesas dos últimos 6 meses,
distribuição da carteira, contratos vencendo e cobranças em atraso.

---

## Passo 1 — Criar o banco no Supabase

1. Crie uma conta em [supabase.com](https://supabase.com) e clique em **New project**.
   - Escolha uma senha forte para o banco e **guarde-a** — ela não é recuperável.
   - Região: prefira `South America (São Paulo)` para menor latência no Brasil.
2. Abra **SQL Editor → New query** e execute os arquivos **nesta ordem**,
   um de cada vez, clicando em **Run**:

   | Ordem | Arquivo | O que faz |
   |---|---|---|
   | 1º | `supabase/migrations/001_schema.sql` | Cria tabelas, tipos e índices |
   | 2º | `supabase/migrations/002_functions.sql` | Triggers, auditoria, geração de parcelas |
   | 3º | `supabase/migrations/003_rls.sql` | Permissões por cargo e bucket de fotos |
   | 4º | `supabase/migrations/004a_enum.sql` | **Rode sozinho.** Adiciona o cargo `super_admin` |
   | 5º | `supabase/migrations/004_multitenancy.sql` | Isolamento por imobiliária, RLS e views |
   | 6º | `supabase/migrations/005_integridade_tenant.sql` | Trava contra vínculo entre imobiliárias |
   | 7º | `supabase/migrations/006_documentos.sql` | Tabela de anexos: vistoria, contrato assinado, RG |
   | 8º | `supabase/migrations/007_sincronizar_parcelas.sql` | Gerar parcelas passa a sincronizar com o contrato |
   | 9º | `supabase/migrations/008_resultado_imovel.sql` | Quem arcou com a despesa e resultado por imóvel |
   | 10º | `supabase/migrations/009_modelos_contrato.sql` | Modelos de contrato com cláusulas editáveis |

   Cada um deve terminar com **Success. No rows returned**.

   > O `004a` precisa ser executado **sozinho**, sem mais nada na aba: o SQL Editor
   > roda o script inteiro numa transação, e o Postgres não deixa usar um valor de
   > enum criado na mesma transação.

3. **Desligue o autocadastro**: **Authentication → Providers → Email → desmarque
   "Enable Sign Ups"**. A chave anon é pública e vai no bundle do site; sem esse
   passo, qualquer pessoa que descubra a URL cria uma conta.

4. **Publique a Edge Function**: **Edge Functions → Deploy a new function → Via
   Editor**, com o nome `gestao-contas`, colando
   `supabase/functions/gestao-contas/index.ts`. Nenhum secret a cadastrar — as
   chaves são injetadas pelo runtime. Deixe *Verify JWT* ligado.

5. **Crie o administrador da plataforma**: **Authentication → Users → Add user**,
   marque *Auto Confirm User* e preencha o User Metadata:

   ```json
   { "nome": "Seu Nome", "super_admin": "true" }
   ```

   É essa conta que cadastra as imobiliárias. Ela **não** enxerga imóvel, contrato,
   cliente nem financeiro de ninguém — nem da sua própria.

6. Vá em **Project Settings → API** e copie:
   - **Project URL** → vira `VITE_SUPABASE_URL`
   - **anon / public key** → vira `VITE_SUPABASE_ANON_KEY`

> A chave `anon` é pública por natureza — ela vai para o navegador. Quem protege os
> dados é o RLS. **Nunca** use a chave `service_role` no frontend: ela só existe
> dentro da Edge Function, onde o runtime a injeta sozinho.

---

## Passo 2 — Rodar na sua máquina

Requisitos: [Node.js](https://nodejs.org) 20 ou superior.

```bash
npm install
cp .env.example .env     # no Windows/PowerShell: copy .env.example .env
```

Abra o `.env` e preencha com os valores copiados do Supabase:

```
VITE_SUPABASE_URL=https://seuprojeto.supabase.co
VITE_SUPABASE_ANON_KEY=eyJhbGciOi...
```

Depois:

```bash
npm run dev
```

Acesse <http://localhost:5173> e entre com a conta de administrador da plataforma
criada no Passo 1. Não há campo de cadastro: **todo acesso é criado por um
administrador**.

> O login pede três coisas: **e-mail, senha e o código de 6 dígitos da
> imobiliária**. O administrador da plataforma entra sem código, porque não
> pertence a nenhuma.

Outros comandos:

```bash
npm run build      # build de produção
npm run preview    # testa o build localmente
npm run typecheck  # verifica os tipos sem gerar arquivos
```

---

## Passo 3 — Publicar no Netlify

1. Envie o projeto para o GitHub (veja abaixo).
2. No Netlify: **Add new site → Import an existing project → GitHub** e escolha o
   repositório. O `netlify.toml` já define build e publicação — não precisa mexer.
3. Antes do primeiro deploy, vá em **Site configuration → Environment variables**
   e cadastre as **duas** variáveis:

   | Key | Value |
   |---|---|
   | `VITE_SUPABASE_URL` | a URL do seu projeto Supabase |
   | `VITE_SUPABASE_ANON_KEY` | a chave anon |

   Sem isso o site sobe, mas abre na tela "Conecte o Supabase para começar".
   Se cadastrar depois, rode **Deploys → Trigger deploy → Clear cache and deploy site**.

4. Copie a URL final (ex.: `seusite.netlify.app`) e cadastre em
   **Supabase → Authentication → URL Configuration**:
   - *Site URL*: a URL do Netlify
   - *Redirect URLs*: adicione também `http://localhost:5173` para continuar
     desenvolvendo local

Cada `git push` na branch `main` dispara um novo deploy automaticamente.

---

## Cargos e permissões

As regras valem **no banco** (Row Level Security), não só na tela — não adianta
alguém tentar burlar pelo navegador.

Antes de qualquer cargo vem o **isolamento por imobiliária**: ninguém enxerga uma
linha que não seja da sua. Os cargos abaixo valem dentro dela.

| Cargo | Imóveis / Clientes / CRM | Contratos / Financeiro | Usuários | Auditoria |
|---|---|---|---|---|
| **Administrador** | criar e editar | criar e editar | gerenciar | ver |
| **Gerente** | criar e editar | criar e editar | — | ver |
| **Financeiro** | só leitura | criar e editar | — | — |
| **Corretor** | criar e editar | só leitura | — | — |

Corretor só edita as negociações onde ele é o responsável — e não pode passá-las
para outro corretor. Admin e gerente editam e reatribuem todas.

Fora dessa tabela existe o **Administrador da plataforma** (`super_admin`), que é
quem entrega o sistema. Ele cadastra, suspende e reativa imobiliárias, e **não**
enxerga imóvel, contrato, cliente nem financeiro de nenhuma delas.

Usuário desativado não consegue ler nem gravar nada — o RLS bloqueia na origem.
Imobiliária suspensa idem, na hora, mesmo para quem já está logado.

---

## Como entregar o sistema a uma imobiliária

Você, como administrador da plataforma, vê apenas a tela **Imobiliárias**:

1. Clique em **Nova imobiliária** e preencha o cadastro (nome, CNPJ, contato).
2. No mesmo formulário, defina o **administrador** dela: nome, e-mail e senha inicial.
3. O sistema gera um **código de acesso de 6 dígitos** e mostra um bloco pronto para
   copiar, com site, e-mail, senha e código. É isso que você entrega ao cliente.

Daí em diante a imobiliária se vira sozinha: o administrador dela cadastra a
própria equipe.

**Suspender** uma imobiliária corta o acesso na hora, inclusive de quem já está
logado, sem apagar nada. Reativar devolve tudo como estava.

---

## Como adicionar pessoas à equipe

Dentro de uma imobiliária, o administrador abre **Usuários → Novo usuário**,
escolhe o cargo e define a senha inicial (há um botão para gerar uma). No fim,
aparece um bloco copiável com **e-mail, senha e código da imobiliária** — os três
que a pessoa vai digitar no login.

Se alguém perder a senha, o administrador usa **Redefinir senha** na linha da
pessoa. Oriente todo mundo a trocar a senha no primeiro acesso.

---

## Rotina de uso

A ordem que faz o sistema funcionar bem:

```
Proprietário  →  Imóvel  →  Cliente  →  Contrato  →  Gerar parcelas
```

Ao criar um contrato, as parcelas do período inteiro são geradas automaticamente.
Para cada mês entram três lançamentos:

- **Aluguel a receber** do inquilino (aluguel + condomínio + IPTU)
- **Repasse ao proprietário** (aluguel − taxa de administração)
- **Taxa de administração** como receita da imobiliária

Se precisar regerar (por exemplo, após esticar a vigência), use o botão de recibo
na linha do contrato — competências já lançadas não são duplicadas.

No Financeiro, **Atualizar atrasos** marca como atrasado tudo que venceu e continua
pendente. O painel já faz isso sozinho a cada abertura.

---

## Estrutura do projeto

```
├── netlify.toml                 # build, redirect SPA e headers de segurança
├── supabase/
│   ├── migrations/              # ordem 001 → … → 007 → 008 → 009
│   │   ├── 001_schema.sql       # tabelas, tipos, índices
│   │   ├── 002_functions.sql    # triggers, auditoria, parcelas, views
│   │   ├── 003_rls.sql          # permissões por cargo + storage
│   │   ├── 004a_enum.sql        # cargo super_admin (rodar sozinho)
│   │   ├── 004_multitenancy.sql # imobiliaria_id, RLS por tenant, views seguras
│   │   ├── 005_integridade_tenant.sql  # FKs compostas contra vínculo cruzado
│   │   ├── 006_documentos.sql   # anexos (vistoria, contrato assinado, RG)
│   │   ├── 007_sincronizar_parcelas.sql  # parcelas seguem o contrato editado
│   │   ├── 008_resultado_imovel.sql  # arcado_por + rentabilidade por imovel
│   │   └── 009_modelos_contrato.sql  # modelos e clausulas para gerar contrato
│   ├── diagnostico.sql          # consulta de leitura: até onde as migrações foram
│   └── functions/
│       └── gestao-contas/       # Edge Function: cria usuários (service_role)
└── src/
    ├── lib/
    │   ├── supabase.ts          # cliente único
    │   ├── types.ts             # tipos do domínio + tipagem do banco
    │   ├── gestaoContas.ts      # cliente da Edge Function, gerador de senha
    │   └── format.ts            # moeda, datas, máscaras, validação de CPF/CNPJ
    ├── contexts/
    │   ├── AuthContext.tsx      # sessão, perfil, cargo, helper `pode()`
    │   └── ToastContext.tsx     # notificações
    ├── components/
    │   ├── Layout.tsx           # navegação lateral, tema claro/escuro
    │   └── ui.tsx               # modal, campo, badges, estados
    └── pages/                   # uma tela por módulo
```

---

## Segurança

O que já está no projeto:

- **Isolamento por imobiliária no banco.** Cada linha carrega `imobiliaria_id` e o
  Postgres recusa as demais na própria RLS. Vale para qualquer caminho — o site, o
  Postman ou a chave anon que está no bundle. Reforçado por chaves estrangeiras
  compostas, que impedem até gravar um contrato de uma imobiliária apontando para
  imóvel de outra.
- **O dono da plataforma não lê dado de cliente.** O cargo `super_admin` não tem
  imobiliária, então nenhuma linha operacional casa com as policies. A tela dele
  mostra só quantidades.
- **RLS ativo em todas as tabelas** — a permissão é verificada no banco
- **Views com `security_invoker`** — sem isso elas rodariam como o dono e
  devolveriam tudo, furando o isolamento por baixo das telas
- Funções `SECURITY DEFINER` para checar cargo sem recursão infinita nas policies,
  e apenas onde são indispensáveis — o resto respeita a RLS de quem chama
- Cadastro fechado: só um administrador cria acessos, e a senha nunca passa pelo
  navegador de terceiros (a `service_role` fica na Edge Function)
- Auditoria imutável: ninguém edita ou apaga o histórico, nem o administrador
- Headers de segurança no `netlify.toml` (`X-Frame-Options`, `nosniff`, `Referrer-Policy`)
- `.env` no `.gitignore` — chaves não vão para o repositório

Cuidados no dia a dia:

- **Nunca** coloque a chave `service_role` no frontend nem no repositório
- Ative **2FA** na sua conta do GitHub e do Supabase
- Não compartilhe senha por mensagem — cada pessoa cria a própria conta
- Faça backup: **Supabase → Database → Backups** (o plano gratuito guarda 7 dias)

---

## Licença

Uso privado.
