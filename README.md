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
- [Como adicionar pessoas à equipe](#como-adicionar-pessoas-à-equipe)
- [Rotina de uso](#rotina-de-uso)
- [Estrutura do projeto](#estrutura-do-projeto)
- [Segurança](#segurança)

---

## O que o sistema faz

| Módulo | Cobertura |
|---|---|
| **Imóveis** | Cadastro com endereço, características, valores, taxa de administração e comissão. Visão em cards ou tabela, busca e filtros por status/tipo/finalidade. Código automático (`IM-0001`). |
| **Proprietários** | Dados pessoais, endereço e dados bancários/PIX para repasse. Contagem de imóveis por proprietário. |
| **Clientes** | Inquilinos, compradores, interessados e fiadores num cadastro só. Renda e perfil para análise de locação. Validação real de CPF/CNPJ. |
| **Contratos** | Vigência, dia de vencimento, índice e mês de reajuste, garantia (fiador, caução, seguro-fiança). Numeração automática (`CT-2026-0001`), alerta de vencimento em 90/30 dias. |
| **Financeiro** | Contas a receber e a pagar, baixa de pagamento com valor/data/forma, marcação automática de atraso, totais do mês e saldo realizado. |
| **CRM** | Funil kanban com arrastar-e-soltar entre etapas, valor de proposta, origem do contato e motivo de perda. |
| **Usuários** | Gestão de cargos, ativação/desativação de acesso. Trava que impede remover o último administrador. |
| **Auditoria** | Registro automático de toda criação, alteração e exclusão, com comparação campo a campo do antes/depois. |

O painel inicial reúne indicadores, gráfico de receitas × despesas dos últimos 6 meses,
distribuição da carteira, contratos vencendo e cobranças em atraso.

---

## Passo 1 — Criar o banco no Supabase

1. Crie uma conta em [supabase.com](https://supabase.com) e clique em **New project**.
   - Escolha uma senha forte para o banco e **guarde-a** — ela não é recuperável.
   - Região: prefira `South America (São Paulo)` para menor latência no Brasil.
2. Abra **SQL Editor → New query** e execute os três arquivos **nesta ordem**,
   um de cada vez, clicando em **Run**:

   | Ordem | Arquivo | O que faz |
   |---|---|---|
   | 1º | `supabase/migrations/001_schema.sql` | Cria tabelas, tipos e índices |
   | 2º | `supabase/migrations/002_functions.sql` | Triggers, auditoria, geração de parcelas |
   | 3º | `supabase/migrations/003_rls.sql` | Permissões por cargo e bucket de fotos |

   Cada um deve terminar com **Success. No rows returned**.

3. Vá em **Project Settings → API** e copie:
   - **Project URL** → vira `VITE_SUPABASE_URL`
   - **anon / public key** → vira `VITE_SUPABASE_ANON_KEY`

> A chave `anon` é pública por natureza — ela vai para o navegador. Quem protege os
> dados é o RLS do passo 3. **Nunca** use a chave `service_role` no frontend.

### Confirmação de e-mail (opcional)

Por padrão o Supabase exige confirmar o e-mail antes do primeiro login. Para uso
interno, você pode desligar em **Authentication → Providers → Email** →
desmarque *Confirm email*.

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

Acesse <http://localhost:5173>, clique em **Criar agora** e cadastre-se.

> **O primeiro usuário cadastrado vira administrador automaticamente.** Faça esse
> primeiro cadastro você mesmo, antes de liberar o sistema para a equipe.

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

| Cargo | Imóveis / Clientes / CRM | Contratos / Financeiro | Usuários | Auditoria |
|---|---|---|---|---|
| **Administrador** | criar e editar | criar e editar | gerenciar | ver |
| **Gerente** | criar e editar | criar e editar | — | ver |
| **Financeiro** | só leitura | criar e editar | — | — |
| **Corretor** | criar e editar | só leitura | — | — |

Corretor só edita as negociações onde ele é o responsável. Admin e gerente editam todas.

Usuário desativado não consegue ler nem gravar nada — o RLS bloqueia na origem.

---

## Como adicionar pessoas à equipe

1. A pessoa acessa o sistema e clica em **Criar agora** para fazer o próprio cadastro.
2. Ela entra como **Corretor** (padrão).
3. Um administrador abre **Usuários**, clica no lápis e ajusta o cargo.

Esse fluxo mantém a senha conhecida **apenas pelo dono da conta**. Nem o
administrador precisa saber a senha de ninguém.

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
├── supabase/migrations/         # execute na ordem 001 → 002 → 003
│   ├── 001_schema.sql           # tabelas, tipos, índices
│   ├── 002_functions.sql        # triggers, auditoria, parcelas, views
│   └── 003_rls.sql              # permissões por cargo + storage
└── src/
    ├── lib/
    │   ├── supabase.ts          # cliente único
    │   ├── types.ts             # tipos do domínio + tipagem do banco
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

- **RLS ativo em todas as tabelas** — a permissão é verificada no banco
- Funções `SECURITY DEFINER` para checar cargo sem recursão infinita nas policies
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
