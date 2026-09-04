-- =============================================================================
-- IMOBILIARIA CONTROL - Resultado por imovel
-- Execute DEPOIS de 007_sincronizar_parcelas.sql
--
-- Tres coisas, nesta ordem de importancia:
--
--   1. `arcado_por` nos lancamentos: manutencao pode ser paga pelo proprietario,
--      pela imobiliaria ou pelo inquilino, e sem isso nao da para dizer de quem
--      e o prejuizo.
--   2. Conserto da soma dupla da taxa de administracao no painel.
--   3. `resultado_imovel()`: quanto um imovel deu no ano, nas duas leituras.
--
-- Idempotente.
-- =============================================================================


-- -----------------------------------------------------------------------------
-- (1) QUEM ARCOU COM A DESPESA
--
-- Vale para as categorias de custo (manutencao, IPTU, condominio, outros). Nao
-- se aplica a repasse nem a taxa, que sao movimentos da propria administracao.
--
-- Default 'proprietario' porque e o caso comum em locacao: o dono arca com a
-- conservacao do que e dele. As linhas antigas herdam esse valor, que e a
-- suposicao certa para elas.
-- -----------------------------------------------------------------------------
alter table public.lancamentos
  add column if not exists arcado_por text not null default 'proprietario';

do $$
begin
  alter table public.lancamentos add constraint lancamentos_arcado_por_valido check (
    arcado_por in ('proprietario','imobiliaria','inquilino')
  );
exception when duplicate_object then null;
end;
$$;

comment on column public.lancamentos.arcado_por is
  'Quem suportou o custo. So faz sentido em despesa de custo (manutencao, iptu, condominio, outros)';

create index if not exists idx_lanc_imovel_ano
  on public.lancamentos (imobiliaria_id, imovel_id, vencimento);


-- -----------------------------------------------------------------------------
-- (2) A SOMA DUPLA DA TAXA
--
-- O fluxo de um mes com 10% sobre aluguel de 240 gera tres linhas:
--
--   aluguel                receita   +240
--   repasse_proprietario   despesa   -216
--   taxa_administracao     receita    +24
--
-- Somando da +48, mas a imobiliaria ganhou 24: a taxa E a diferenca entre o
-- aluguel e o repasse (`repasse = aluguel - taxa`). A linha de taxa e o registro
-- do que ficou, nao um dinheiro que se move por fora.
--
-- O painel somava as tres. Passa a excluir a taxa dos totais de caixa -- ela
-- continua na lista de lancamentos, onde serve de memoria do que foi cobrado.
-- -----------------------------------------------------------------------------
create or replace function public.dashboard_resumo()
returns json
language sql
stable
set search_path = public
as $$
  select json_build_object(
    'imoveis_total',       (select count(*) from public.imoveis where status <> 'inativo'),
    'imoveis_disponiveis', (select count(*) from public.imoveis where status = 'disponivel'),
    'imoveis_alugados',    (select count(*) from public.imoveis where status = 'alugado'),
    'imoveis_vendidos',    (select count(*) from public.imoveis where status = 'vendido'),
    'contratos_ativos',    (select count(*) from public.contratos where status = 'ativo'),
    'contratos_vencendo',  (select count(*) from public.contratos
                             where status = 'ativo'
                               and data_fim between current_date and current_date + 90),
    'clientes_total',      (select count(*) from public.clientes where ativo),
    'proprietarios_total', (select count(*) from public.proprietarios where ativo),
    'a_receber_mes',       (select coalesce(sum(valor),0) from public.lancamentos
                             where tipo = 'receita' and categoria <> 'taxa_administracao'
                               and status in ('pendente','atrasado')
                               and date_trunc('month', vencimento) = date_trunc('month', current_date)),
    'a_pagar_mes',         (select coalesce(sum(valor),0) from public.lancamentos
                             where tipo = 'despesa' and status in ('pendente','atrasado')
                               and date_trunc('month', vencimento) = date_trunc('month', current_date)),
    'recebido_mes',        (select coalesce(sum(coalesce(valor_pago, valor)),0) from public.lancamentos
                             where tipo = 'receita' and categoria <> 'taxa_administracao'
                               and status = 'pago'
                               and date_trunc('month', data_pagamento) = date_trunc('month', current_date)),
    'inadimplencia',       (select coalesce(sum(valor),0) from public.lancamentos
                             where tipo = 'receita' and categoria <> 'taxa_administracao'
                               and status = 'atrasado'),
    'inadimplentes_qtd',   (select count(*) from public.lancamentos
                             where tipo = 'receita' and categoria <> 'taxa_administracao'
                               and status = 'atrasado'),
    'negociacoes_abertas', (select count(*) from public.negociacoes
                             where etapa not in ('fechado','perdido')),
    'visitas_semana',      (select count(*) from public.visitas
                             where data_hora between current_date and current_date + 7)
  );
$$;


-- -----------------------------------------------------------------------------
-- (3) RESULTADO DO IMOVEL NO ANO
--
-- Sem `security definer`, de proposito: assim a RLS filtra sozinha e a funcao
-- nunca alcanca imovel de outra imobiliaria. Mesma escolha do dashboard_resumo.
--
-- DUAS LEITURAS, porque sao perguntas diferentes:
--
--   proprietario  "esse imovel vale a pena?"
--                 repasses recebidos - custos que o dono arcou
--
--   imobiliaria   "administrar esse imovel da lucro?"
--                 recebido dos inquilinos - repassado + comissao - custos
--
-- Nenhuma das duas usa o lancamento de `taxa_administracao`, de proposito. A
-- taxa nao e baixada em separado: ela e retida no instante do repasse, entao
-- aquela linha quase nunca fica com status `pago`. Descontar por ela deixaria o
-- resultado do dono inflado exatamente no valor da taxa. O repasse, sim, e
-- dinheiro que se move e que alguem baixa.
--
-- E a conta fecha: 240 recebidos, 216 repassados, taxa de 24. O dono fica com
-- 216, a imobiliaria com 24, e a soma das duas leituras da os 240 que o
-- inquilino pagou -- sem contar nada duas vezes.
--
-- O ano e o do PAGAMENTO para o que foi pago, e o do VENCIMENTO para o que
-- ainda esta em aberto -- e assim que se fecha um ano de verdade.
--
-- LIMITE CONHECIDO: o lancamento de aluguel guarda aluguel + condominio + IPTU
-- num valor so, entao quando o contrato tiver esses valores eles entram como
-- receita do proprietario sem a saida correspondente. Enquanto os contratos
-- tiverem condominio e IPTU zerados, o numero fecha.
-- -----------------------------------------------------------------------------
create or replace function public.resultado_imovel(p_imovel_id uuid, p_ano integer)
returns json
language sql
stable
set search_path = public
as $$
  with l as (
    select
      categoria,
      tipo,
      status,
      arcado_por,
      coalesce(valor_pago, valor) as pago,
      valor                        as previsto
    from public.lancamentos
    where imovel_id = p_imovel_id
      and extract(year from coalesce(data_pagamento, vencimento)) = p_ano
  ),
  base as (
    select
      -- o que os inquilinos pagaram
      coalesce(sum(pago) filter (
        where status = 'pago' and tipo = 'receita' and categoria = 'aluguel'), 0) as aluguel,

      -- o que chegou ao dono, ja liquido da taxa
      coalesce(sum(pago) filter (
        where status = 'pago' and categoria = 'repasse_proprietario'), 0) as repasse,

      -- so informativo: a taxa nao entra em nenhuma das duas contas
      coalesce(sum(pago) filter (
        where status = 'pago' and categoria = 'taxa_administracao'), 0) as taxa,

      coalesce(sum(pago) filter (
        where status = 'pago' and categoria = 'comissao_venda'), 0) as comissao,

      -- custos, separados por quem bancou
      coalesce(sum(pago) filter (
        where status = 'pago' and tipo = 'despesa'
          and categoria in ('manutencao','iptu','condominio','multa_juros','outros')
          and arcado_por = 'proprietario'), 0) as custo_dono,

      coalesce(sum(pago) filter (
        where status = 'pago' and tipo = 'despesa'
          and categoria in ('manutencao','iptu','condominio','multa_juros','outros')
          and arcado_por = 'imobiliaria'), 0) as custo_imob,

      coalesce(sum(pago) filter (
        where status = 'pago' and tipo = 'despesa'
          and categoria = 'manutencao'), 0) as manutencao,

      -- o que ainda nao aconteceu
      coalesce(sum(previsto) filter (
        where status in ('pendente','atrasado') and tipo = 'receita'
          and categoria <> 'taxa_administracao'), 0) as a_receber,

      coalesce(sum(previsto) filter (
        where status in ('pendente','atrasado') and tipo = 'despesa'), 0) as a_pagar
    from l
  )
  select json_build_object(
    'ano', p_ano,
    'proprietario', json_build_object(
      'repasse',   base.repasse,
      'custos',    base.custo_dono,
      'resultado', base.repasse - base.custo_dono
    ),
    'imobiliaria', json_build_object(
      'aluguel',   base.aluguel,
      'repasse',   base.repasse,
      'comissao',  base.comissao,
      'custos',    base.custo_imob,
      'resultado', base.aluguel - base.repasse + base.comissao - base.custo_imob
    ),
    'taxa_registrada', base.taxa,
    'manutencao', base.manutencao,
    'aberto', json_build_object(
      'a_receber', base.a_receber,
      'a_pagar',   base.a_pagar
    ),
    'categorias', coalesce((
      -- coalesce no order by: `sum ... filter` devolve null quando nada casa, e
      -- `desc` joga null para o topo, colocando a categoria vazia em primeiro.
      select json_agg(x order by coalesce(x.total, 0) desc)
        from (
          select categoria::text        as categoria,
                 tipo::text             as tipo,
                 sum(pago) filter (where status = 'pago')                     as total,
                 sum(previsto) filter (where status in ('pendente','atrasado')) as em_aberto
            from l
           group by categoria, tipo
          having sum(pago) filter (where status = 'pago') is not null
              or sum(previsto) filter (where status in ('pendente','atrasado')) is not null
        ) x
    ), '[]'::json)
  )
  from base;
$$;

comment on function public.resultado_imovel(uuid, integer) is
  'Resultado do imovel no ano, nas duas leituras: do dono e da administracao';


-- =============================================================================
-- VERIFICACAO - rode depois, num editor separado
--
--   select public.resultado_imovel(
--     (select id from public.imoveis where codigo = 'IM-0007'), 2026);
--
--   -- E confira que o painel parou de somar a taxa duas vezes:
--   select public.dashboard_resumo() -> 'a_receber_mes';
-- =============================================================================
