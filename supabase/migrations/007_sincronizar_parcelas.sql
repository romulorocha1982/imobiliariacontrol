-- =============================================================================
-- IMOBILIARIA CONTROL - Parcelas passam a acompanhar o contrato
-- Execute DEPOIS de 006_documentos.sql
--
-- O PROBLEMA
--
-- A versao anterior de `gerar_parcelas_contrato` so INSERIA: cada um dos tres
-- lancamentos do mes vinha embrulhado num `if not exists`. Os lancamentos eram
-- uma fotografia do contrato no instante em que foram gerados.
--
-- Consequencia real, encontrada em producao: um contrato criado com 10% de taxa
-- de administracao gerou repasse de R$ 216,00 sobre um aluguel de R$ 240,00. O
-- usuario corrigiu a taxa para zero no contrato e clicou em "gerar parcelas"
-- de novo -- e nada mudou, porque a competencia ja existia e a funcao a pulou.
-- O financeiro seguiu descontando uma taxa que o contrato nao previa mais, sem
-- nenhum aviso de que estava desatualizado.
--
-- O QUE MUDA
--
-- Gerar parcelas passa a ser tambem SINCRONIZAR com o contrato:
--
--   cria     o que falta
--   atualiza o que existe e esta em aberto, para os valores atuais
--   remove   a taxa de administracao em aberto quando a taxa virou zero, e o
--            que ficou fora da vigencia depois de encurtar o contrato
--
-- O QUE NAO MUDA, NUNCA
--
-- Lancamento `pago` e historico: foi dinheiro que entrou ou saiu de verdade, com
-- data e forma registradas. Reescrever isso seria falsificar o passado, entao a
-- funcao so toca no que esta `pendente` ou `atrasado`. `cancelado` tambem fica
-- de fora: alguem cancelou por um motivo, e ressuscitar o valor seria surpresa.
--
-- Se a correcao do contrato tiver que alcancar um mes ja pago, isso e estorno --
-- decisao de quem opera, feita a mao no lancamento, nao algo para um botao
-- decidir sozinho.
--
-- Idempotente: rodar de novo sem mudar o contrato nao altera nada e devolve
-- zero em tudo.
-- =============================================================================

-- O tipo de retorno muda de integer para json, e o Postgres nao permite trocar
-- retorno com `create or replace`.
drop function if exists public.gerar_parcelas_contrato(uuid);

create function public.gerar_parcelas_contrato(p_contrato_id uuid)
returns json
language plpgsql
security definer
set search_path = public
as $$
declare
  c              record;
  v_tenant       uuid;
  v_competencia  date;
  v_vencimento   date;
  v_primeira     date;
  v_ultima       date;
  v_total        numeric(14,2);
  v_taxa         numeric(14,2);
  v_repasse      numeric(14,2);
  v_proprietario uuid;
  v_criados      integer := 0;
  v_atualizados  integer := 0;
  v_removidos    integer := 0;
  n              integer;
begin
  v_tenant := public.minha_imobiliaria();
  if v_tenant is null
     or not public.tem_cargo(array['admin','gerente','financeiro']::user_role[]) then
    raise exception 'Sem permissao para gerar parcelas';
  end if;

  select * into c from public.contratos
   where id = p_contrato_id and imobiliaria_id = v_tenant;
  if not found then
    raise exception 'Contrato nao encontrado';
  end if;

  select proprietario_id into v_proprietario from public.imoveis
   where id = c.imovel_id and imobiliaria_id = v_tenant;

  v_total   := coalesce(c.valor_aluguel,0) + coalesce(c.valor_condominio,0) + coalesce(c.valor_iptu,0);
  v_taxa    := round(coalesce(c.valor_aluguel,0) * coalesce(c.taxa_administracao,0) / 100.0, 2);
  v_repasse := coalesce(c.valor_aluguel,0) - v_taxa;

  v_primeira := date_trunc('month', c.data_inicio)::date;
  v_ultima   := date_trunc('month', c.data_fim)::date;

  v_competencia := v_primeira;

  while v_competencia <= c.data_fim loop
    v_vencimento := v_competencia + (least(
      c.dia_vencimento,
      extract(day from (date_trunc('month', v_competencia) + interval '1 month - 1 day'))::int
    ) - 1);

    -- ---------------------------------------------------------------------
    -- 1) ALUGUEL A RECEBER DO INQUILINO
    -- ---------------------------------------------------------------------
    perform 1 from public.lancamentos
     where imobiliaria_id = v_tenant and contrato_id = c.id
       and categoria = 'aluguel' and competencia = v_competencia;

    if not found then
      insert into public.lancamentos
        (imobiliaria_id, tipo, categoria, status, descricao, valor, competencia, vencimento,
         contrato_id, imovel_id, cliente_id, proprietario_id)
      values
        (v_tenant, 'receita','aluguel','pendente',
         'Aluguel ' || to_char(v_competencia,'MM/YYYY') || ' - contrato ' || coalesce(c.numero,''),
         v_total, v_competencia, v_vencimento,
         c.id, c.imovel_id, c.inquilino_id, v_proprietario);
      v_criados := v_criados + 1;
    else
      -- O `is distinct from` mantem a contagem honesta: sem ele, um clique sem
      -- nenhuma mudanca relataria "atualizados" e ainda carimbaria updated_at.
      update public.lancamentos set
        valor           = v_total,
        vencimento      = v_vencimento,
        descricao       = 'Aluguel ' || to_char(v_competencia,'MM/YYYY') || ' - contrato ' || coalesce(c.numero,''),
        cliente_id      = c.inquilino_id,
        imovel_id       = c.imovel_id,
        proprietario_id = v_proprietario
      where imobiliaria_id = v_tenant and contrato_id = c.id
        and categoria = 'aluguel' and competencia = v_competencia
        and status in ('pendente','atrasado')
        and (valor           is distinct from v_total
          or vencimento      is distinct from v_vencimento
          or cliente_id      is distinct from c.inquilino_id
          or imovel_id       is distinct from c.imovel_id
          or proprietario_id is distinct from v_proprietario);
      get diagnostics n = row_count;
      v_atualizados := v_atualizados + n;
    end if;

    -- ---------------------------------------------------------------------
    -- 2) REPASSE AO PROPRIETARIO
    -- ---------------------------------------------------------------------
    perform 1 from public.lancamentos
     where imobiliaria_id = v_tenant and contrato_id = c.id
       and categoria = 'repasse_proprietario' and competencia = v_competencia;

    if not found then
      insert into public.lancamentos
        (imobiliaria_id, tipo, categoria, status, descricao, valor, competencia, vencimento,
         contrato_id, imovel_id, proprietario_id)
      values
        (v_tenant, 'despesa','repasse_proprietario','pendente',
         'Repasse ' || to_char(v_competencia,'MM/YYYY') || ' - contrato ' || coalesce(c.numero,''),
         v_repasse, v_competencia, v_vencimento + 5,
         c.id, c.imovel_id, v_proprietario);
      v_criados := v_criados + 1;
    else
      update public.lancamentos set
        valor           = v_repasse,
        vencimento      = v_vencimento + 5,
        descricao       = 'Repasse ' || to_char(v_competencia,'MM/YYYY') || ' - contrato ' || coalesce(c.numero,''),
        imovel_id       = c.imovel_id,
        proprietario_id = v_proprietario
      where imobiliaria_id = v_tenant and contrato_id = c.id
        and categoria = 'repasse_proprietario' and competencia = v_competencia
        and status in ('pendente','atrasado')
        and (valor           is distinct from v_repasse
          or vencimento      is distinct from v_vencimento + 5
          or imovel_id       is distinct from c.imovel_id
          or proprietario_id is distinct from v_proprietario);
      get diagnostics n = row_count;
      v_atualizados := v_atualizados + n;
    end if;

    -- ---------------------------------------------------------------------
    -- 3) TAXA DE ADMINISTRACAO
    --
    -- Unica das tres que pode deixar de existir: taxa zero nao gera receita.
    -- Por isso este ramo tem um `delete` que os outros dois nao tem.
    -- ---------------------------------------------------------------------
    if v_taxa > 0 then
      perform 1 from public.lancamentos
       where imobiliaria_id = v_tenant and contrato_id = c.id
         and categoria = 'taxa_administracao' and competencia = v_competencia;

      if not found then
        insert into public.lancamentos
          (imobiliaria_id, tipo, categoria, status, descricao, valor, competencia, vencimento,
           contrato_id, imovel_id, proprietario_id)
        values
          (v_tenant, 'receita','taxa_administracao','pendente',
           'Taxa adm ' || to_char(v_competencia,'MM/YYYY') || ' - contrato ' || coalesce(c.numero,''),
           v_taxa, v_competencia, v_vencimento,
           c.id, c.imovel_id, v_proprietario);
        v_criados := v_criados + 1;
      else
        update public.lancamentos set
          valor           = v_taxa,
          vencimento      = v_vencimento,
          descricao       = 'Taxa adm ' || to_char(v_competencia,'MM/YYYY') || ' - contrato ' || coalesce(c.numero,''),
          imovel_id       = c.imovel_id,
          proprietario_id = v_proprietario
        where imobiliaria_id = v_tenant and contrato_id = c.id
          and categoria = 'taxa_administracao' and competencia = v_competencia
          and status in ('pendente','atrasado')
          and (valor      is distinct from v_taxa
            or vencimento is distinct from v_vencimento);
        get diagnostics n = row_count;
        v_atualizados := v_atualizados + n;
      end if;
    else
      delete from public.lancamentos
       where imobiliaria_id = v_tenant and contrato_id = c.id
         and categoria = 'taxa_administracao' and competencia = v_competencia
         and status in ('pendente','atrasado');
      get diagnostics n = row_count;
      v_removidos := v_removidos + n;
    end if;

    v_competencia := (v_competencia + interval '1 month')::date;
  end loop;

  -- -----------------------------------------------------------------------
  -- FORA DA VIGENCIA
  --
  -- Encurtar um contrato deixava para tras as parcelas dos meses que sairam.
  -- So sao removidas as que estao em aberto e nas tres categorias que esta
  -- funcao gera -- lancamento avulso que alguem criou a mao, em outra
  -- categoria, nunca e tocado. Competencia nula tambem escapa: nao foi esta
  -- funcao que criou.
  -- -----------------------------------------------------------------------
  delete from public.lancamentos
   where imobiliaria_id = v_tenant
     and contrato_id = c.id
     and status in ('pendente','atrasado')
     and categoria in ('aluguel','repasse_proprietario','taxa_administracao')
     and competencia is not null
     and (competencia < v_primeira or competencia > v_ultima);
  get diagnostics n = row_count;
  v_removidos := v_removidos + n;

  return json_build_object(
    'criados',     v_criados,
    'atualizados', v_atualizados,
    'removidos',   v_removidos
  );
end;
$$;

comment on function public.gerar_parcelas_contrato(uuid) is
  'Sincroniza os lancamentos do contrato: cria o que falta, atualiza o que esta em aberto e remove o que nao vale mais. Nunca toca em pago ou cancelado';


-- =============================================================================
-- VERIFICACAO - rode depois, num editor separado
--
-- 1) O retorno agora e json com as tres contagens:
--
--   select public.gerar_parcelas_contrato(
--     (select id from public.contratos where numero = 'CT-2026-0001'));
--   -- ex.: {"criados":0,"atualizados":1,"removidos":0}
--
-- 2) O repasse deve bater com aluguel menos a taxa do contrato:
--
--   select l.competencia, l.categoria, l.status, l.valor
--     from public.lancamentos l
--     join public.contratos c on c.id = l.contrato_id
--    where c.numero = 'CT-2026-0001'
--    order by l.competencia, l.categoria;
-- =============================================================================
