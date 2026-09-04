import { useCallback, useEffect, useMemo, useState } from 'react'
import {
  Plus, Search, Wallet, Pencil, Trash2, CheckCircle2, TrendingUp,
  TrendingDown, Scale, RefreshCw,
} from 'lucide-react'
import { supabase } from '@/lib/supabase'
import { useAuth } from '@/contexts/AuthContext'
import { useToast } from '@/contexts/ToastContext'
import {
  Modal, Campo, Confirmar, Vazio, SkeletonTabela, BadgeLancamento, Stat,
} from '@/components/ui'
import { moeda, moedaCurta, data, competencia, hoje } from '@/lib/format'
import {
  LABEL_CATEGORIA, LABEL_STATUS_LANCAMENTO, LABEL_ARCADO_POR,
  type LancamentoCompleto, type Lancamento, type Cliente, type Proprietario,
  type Imovel, type LancamentoTipo, type LancamentoCategoria, type LancamentoStatus,
  type ArcadoPor,
} from '@/lib/types'

/**
 * Categorias em que "quem arcou" muda o resultado do imovel. Repasse e taxa
 * ficam de fora: sao movimento da propria administracao, nao custo de alguem.
 */
const CATEGORIAS_DE_CUSTO: LancamentoCategoria[] = [
  'manutencao', 'iptu', 'condominio', 'multa_juros', 'outros',
]

type Form = Partial<Lancamento>
type Aba = 'receber' | 'pagar' | 'todos'

function formVazio(tipo: LancamentoTipo): Form {
  return {
    tipo,
    categoria: tipo === 'receita' ? 'aluguel' : 'repasse_proprietario',
    status: 'pendente',
    descricao: '',
    vencimento: hoje(),
    competencia: hoje().slice(0, 8) + '01',
  }
}

export default function Financeiro() {
  const { pode, comTenant } = useAuth()
  const { ok, erro: toastErro } = useToast()

  const [lista, setLista] = useState<LancamentoCompleto[]>([])
  const [clientes, setClientes] = useState<Cliente[]>([])
  const [proprietarios, setProprietarios] = useState<Proprietario[]>([])
  const [imoveis, setImoveis] = useState<Imovel[]>([])
  const [carregando, setCarregando] = useState(true)
  const [atualizando, setAtualizando] = useState(false)

  const [aba, setAba] = useState<Aba>('receber')
  const [busca, setBusca] = useState('')
  const [fStatus, setFStatus] = useState<'' | LancamentoStatus>('')
  const [fMes, setFMes] = useState(() => hoje().slice(0, 7))

  const [modal, setModal] = useState(false)
  const [editando, setEditando] = useState<LancamentoCompleto | null>(null)
  const [form, setForm] = useState<Form>(formVazio('receita'))
  const [salvando, setSalvando] = useState(false)
  const [erros, setErros] = useState<Record<string, string>>({})
  const [excluir, setExcluir] = useState<LancamentoCompleto | null>(null)
  const [excluindo, setExcluindo] = useState(false)

  // baixa de pagamento
  const [baixando, setBaixando] = useState<LancamentoCompleto | null>(null)
  const [valorPago, setValorPago] = useState('')
  const [dataPago, setDataPago] = useState(hoje())
  const [formaPago, setFormaPago] = useState('PIX')
  const [processandoBaixa, setProcessandoBaixa] = useState(false)

  const podeEditar = pode('admin', 'gerente', 'financeiro')

  const carregar = useCallback(async () => {
    setCarregando(true)
    const [r1, r2, r3, r4] = await Promise.all([
      supabase
        .from('vw_lancamentos_completo')
        .select('*')
        .order('vencimento', { ascending: false })
        .limit(600),
      supabase.from('clientes').select('*').eq('ativo', true).order('nome'),
      supabase.from('proprietarios').select('*').eq('ativo', true).order('nome'),
      supabase.from('imoveis').select('*').order('codigo'),
    ])
    if (r1.error) toastErro('Erro ao carregar lancamentos', r1.error.message)
    else setLista((r1.data ?? []) as LancamentoCompleto[])
    if (!r2.error) setClientes((r2.data ?? []) as Cliente[])
    if (!r3.error) setProprietarios((r3.data ?? []) as Proprietario[])
    if (!r4.error) setImoveis((r4.data ?? []) as Imovel[])
    setCarregando(false)
  }, [toastErro])

  useEffect(() => { void carregar() }, [carregar])

  async function atualizarAtrasos() {
    setAtualizando(true)
    const { data: qtd, error } = await supabase.rpc('marcar_atrasados')
    setAtualizando(false)
    if (error) return toastErro('Erro ao atualizar', error.message)
    ok(
      Number(qtd ?? 0) > 0
        ? `${qtd} lancamento(s) marcado(s) como atrasado`
        : 'Nenhum atraso novo encontrado',
    )
    void carregar()
  }

  const filtrados = useMemo(() => {
    const q = busca.trim().toLowerCase()
    return lista.filter((l) => {
      if (aba === 'receber' && l.tipo !== 'receita') return false
      if (aba === 'pagar' && l.tipo !== 'despesa') return false
      if (fStatus && l.status !== fStatus) return false
      if (fMes && !l.vencimento.startsWith(fMes)) return false
      if (!q) return true
      return [l.descricao, l.cliente_nome, l.proprietario_nome, l.imovel_codigo, l.contrato_numero]
        .filter(Boolean)
        .some((x) => String(x).toLowerCase().includes(q))
    })
  }, [lista, aba, busca, fStatus, fMes])

  /** Totais da selecao atual */
  const totais = useMemo(() => {
    let receitas = 0
    let despesas = 0
    let recebido = 0
    let pago = 0
    let atrasado = 0

    for (const l of lista) {
      if (fMes && !l.vencimento.startsWith(fMes)) continue
      if (l.status === 'cancelado') continue
      const v = Number(l.valor)
      const vp = Number(l.valor_pago ?? l.valor)
      if (l.tipo === 'receita') {
        receitas += v
        if (l.status === 'pago') recebido += vp
        if (l.status === 'atrasado') atrasado += v
      } else {
        despesas += v
        if (l.status === 'pago') pago += vp
      }
    }
    return { receitas, despesas, recebido, pago, atrasado, saldo: recebido - pago }
  }, [lista, fMes])

  function abrirNovo() {
    setEditando(null)
    setForm(formVazio(aba === 'pagar' ? 'despesa' : 'receita'))
    setErros({})
    setModal(true)
  }

  function abrirEdicao(l: LancamentoCompleto) {
    setEditando(l)
    setForm({ ...l })
    setErros({})
    setModal(true)
  }

  function abrirBaixa(l: LancamentoCompleto) {
    setBaixando(l)
    setValorPago(String(l.valor))
    setDataPago(hoje())
    setFormaPago('PIX')
  }

  async function confirmarBaixa() {
    if (!baixando) return
    setProcessandoBaixa(true)
    const { error } = await supabase.rpc('baixar_lancamento', {
      p_id: baixando.id,
      p_valor: Number(valorPago),
      p_data: dataPago,
      p_forma: formaPago,
    })
    setProcessandoBaixa(false)
    if (error) return toastErro('Erro ao dar baixa', error.message)
    ok('Pagamento registrado', `${moeda(Number(valorPago))} em ${data(dataPago)}`)
    setBaixando(null)
    void carregar()
  }

  function validar(): boolean {
    const e: Record<string, string> = {}
    if (!form.descricao?.trim()) e.descricao = 'Informe a descricao.'
    if (!form.valor || Number(form.valor) <= 0) e.valor = 'Informe um valor maior que zero.'
    if (!form.vencimento) e.vencimento = 'Informe o vencimento.'
    setErros(e)
    return Object.keys(e).length === 0
  }

  async function salvar() {
    if (!validar()) return
    setSalvando(true)

    const payload: Record<string, unknown> = { ...form }
    for (const c of [
      'imovel_codigo', 'imovel_titulo', 'cliente_nome', 'proprietario_nome',
      'contrato_numero', 'dias_atraso', 'created_at', 'updated_at',
    ]) {
      delete payload[c]
    }
    if (!editando) delete payload.id

    // payload e montado como mapa solto para remover as colunas da view
    const dados = payload as Partial<Lancamento>

    const resposta = editando
      ? await supabase.from('lancamentos').update(dados).eq('id', editando.id)
      : await supabase.from('lancamentos').insert(comTenant(dados))

    setSalvando(false)
    if (resposta.error) return toastErro('Nao foi possivel salvar', resposta.error.message)

    ok(editando ? 'Lancamento atualizado' : 'Lancamento criado')
    setModal(false)
    void carregar()
  }

  async function confirmarExclusao() {
    if (!excluir) return
    setExcluindo(true)
    const { error } = await supabase.from('lancamentos').delete().eq('id', excluir.id)
    setExcluindo(false)
    if (error) return toastErro('Nao foi possivel excluir', error.message)
    ok('Lancamento excluido')
    setExcluir(null)
    void carregar()
  }

  const set = <K extends keyof Form>(c: K, v: Form[K]) => setForm((f) => ({ ...f, [c]: v }))

  return (
    <div>
      {/* --------------------------------------------------- indicadores -- */}
      <div className="grade grade--4 mb-3">
        <Stat
          rotulo="A receber"
          valor={moedaCurta(totais.receitas)}
          nota={`Recebido: ${moedaCurta(totais.recebido)}`}
          icone={<TrendingUp size={17} />}
          cor="ok"
        />
        <Stat
          rotulo="A pagar"
          valor={moedaCurta(totais.despesas)}
          nota={`Pago: ${moedaCurta(totais.pago)}`}
          icone={<TrendingDown size={17} />}
          cor="erro"
        />
        <Stat
          rotulo="Em atraso"
          valor={moedaCurta(totais.atrasado)}
          nota={totais.atrasado > 0 ? 'Requer cobranca' : 'Tudo em dia'}
          icone={<Wallet size={17} />}
          cor={totais.atrasado > 0 ? 'alerta' : 'ok'}
        />
        <Stat
          rotulo="Saldo realizado"
          valor={moedaCurta(totais.saldo)}
          nota="Recebido menos pago"
          icone={<Scale size={17} />}
          cor={totais.saldo >= 0 ? 'primaria' : 'erro'}
        />
      </div>

      {/* ---------------------------------------------------------- abas -- */}
      <div className="abas">
        <button className={`aba ${aba === 'receber' ? 'aba--ativa' : ''}`} onClick={() => setAba('receber')}>
          Contas a receber
        </button>
        <button className={`aba ${aba === 'pagar' ? 'aba--ativa' : ''}`} onClick={() => setAba('pagar')}>
          Contas a pagar
        </button>
        <button className={`aba ${aba === 'todos' ? 'aba--ativa' : ''}`} onClick={() => setAba('todos')}>
          Todos
        </button>
      </div>

      <div className="barra">
        <div className="busca">
          <Search size={15} />
          <input
            className="input"
            placeholder="Buscar por descricao, cliente, imovel..."
            value={busca}
            onChange={(e) => setBusca(e.target.value)}
          />
        </div>

        <input
          className="input"
          type="month"
          value={fMes}
          onChange={(e) => setFMes(e.target.value)}
          title="Mes de vencimento"
        />

        <select
          className="select"
          value={fStatus}
          onChange={(e) => setFStatus(e.target.value as LancamentoStatus | '')}
        >
          <option value="">Todos os status</option>
          {Object.entries(LABEL_STATUS_LANCAMENTO).map(([v, l]) => (
            <option key={v} value={v}>{l}</option>
          ))}
        </select>

        <button className="btn btn--fantasma btn--sm" onClick={() => setFMes('')}>
          Ver todos os meses
        </button>

        <div className="barra__dir">
          <span className="contador">{filtrados.length} lancamento(s)</span>
          {podeEditar && (
            <>
              <button
                className="btn btn--secundario"
                onClick={() => void atualizarAtrasos()}
                disabled={atualizando}
                title="Marca como atrasado tudo que venceu e segue pendente"
              >
                {atualizando ? <span className="spin spin--sm" /> : <RefreshCw size={15} />}
                Atualizar atrasos
              </button>
              <button className="btn btn--primario" onClick={abrirNovo}>
                <Plus size={16} /> Novo lancamento
              </button>
            </>
          )}
        </div>
      </div>

      {carregando ? (
        <SkeletonTabela linhas={7} colunas={6} />
      ) : filtrados.length === 0 ? (
        <div className="card">
          <Vazio
            icone={<Wallet size={24} />}
            titulo="Nenhum lancamento encontrado"
            texto={
              lista.length === 0
                ? 'Crie um contrato e use "Gerar parcelas" para lancar os alugueis automaticamente, ou adicione um lancamento avulso.'
                : 'Ajuste o mes, o status ou a busca.'
            }
            acao={
              podeEditar ? (
                <button className="btn btn--primario" onClick={abrirNovo}>
                  <Plus size={16} /> Novo lancamento
                </button>
              ) : undefined
            }
          />
        </div>
      ) : (
        <div className="tabela-wrap">
          <table className="tabela">
            <thead>
              <tr>
                <th>Descricao</th>
                <th>Categoria</th>
                <th>Vinculo</th>
                <th>Vencimento</th>
                <th>Status</th>
                <th className="num">Valor</th>
                {podeEditar && <th className="acoes">Acoes</th>}
              </tr>
            </thead>
            <tbody>
              {filtrados.map((l) => (
                <tr key={l.id}>
                  <td>
                    <div className="celula-forte">{l.descricao}</div>
                    <div className="celula-fraca">
                      {l.tipo === 'receita' ? 'Receita' : 'Despesa'}
                      {l.competencia && ` - comp. ${competencia(l.competencia)}`}
                    </div>
                  </td>
                  <td className="t-sm">{LABEL_CATEGORIA[l.categoria]}</td>
                  <td>
                    <div className="t-sm">{l.cliente_nome ?? l.proprietario_nome ?? '-'}</div>
                    {l.imovel_codigo && <span className="codigo">{l.imovel_codigo}</span>}
                  </td>
                  <td>
                    <div className="t-sm">{data(l.vencimento)}</div>
                    {l.status === 'atrasado' && (
                      <span className="badge badge--erro">{l.dias_atraso}d atraso</span>
                    )}
                    {l.status === 'pago' && l.data_pagamento && (
                      <div className="celula-fraca">pago {data(l.data_pagamento)}</div>
                    )}
                  </td>
                  <td><BadgeLancamento status={l.status} /></td>
                  <td className="num">
                    <span
                      className="celula-forte"
                      style={{ color: l.tipo === 'receita' ? 'var(--ok)' : 'var(--erro)' }}
                    >
                      {l.tipo === 'receita' ? '+' : '-'} {moeda(l.valor)}
                    </span>
                    {l.status === 'pago' && Number(l.valor_pago) !== Number(l.valor) && (
                      <div className="celula-fraca">recebido {moeda(l.valor_pago)}</div>
                    )}
                  </td>
                  {podeEditar && (
                    <td className="acoes">
                      {l.status !== 'pago' && l.status !== 'cancelado' && (
                        <button
                          className="btn btn--fantasma btn--sm"
                          onClick={() => abrirBaixa(l)}
                          title="Registrar pagamento"
                        >
                          <CheckCircle2 size={14} color="var(--ok)" />
                        </button>
                      )}
                      <button className="btn btn--fantasma btn--sm" onClick={() => abrirEdicao(l)} title="Editar">
                        <Pencil size={13} />
                      </button>
                      <button className="btn btn--fantasma btn--sm" onClick={() => setExcluir(l)} title="Excluir">
                        <Trash2 size={13} color="var(--erro)" />
                      </button>
                    </td>
                  )}
                </tr>
              ))}
            </tbody>
          </table>
        </div>
      )}

      {/* ------------------------------------------------ modal cadastro -- */}
      <Modal
        aberto={modal}
        aoFechar={() => setModal(false)}
        titulo={editando ? 'Editar lancamento' : 'Novo lancamento'}
        tamanho="md"
        rodape={
          <>
            <button className="btn btn--secundario" onClick={() => setModal(false)} disabled={salvando}>
              Cancelar
            </button>
            <button className="btn btn--primario" onClick={() => void salvar()} disabled={salvando}>
              {salvando && <span className="spin spin--sm spin--claro" />}
              {editando ? 'Salvar' : 'Criar'}
            </button>
          </>
        }
      >
        <div className="form-grade">
          <Campo rotulo="Tipo" className="col-6">
            <select
              className="select"
              value={form.tipo}
              onChange={(e) => set('tipo', e.target.value as LancamentoTipo)}
            >
              <option value="receita">Receita (a receber)</option>
              <option value="despesa">Despesa (a pagar)</option>
            </select>
          </Campo>

          <Campo rotulo="Categoria" className="col-6">
            <select
              className="select"
              value={form.categoria}
              onChange={(e) => set('categoria', e.target.value as LancamentoCategoria)}
            >
              {Object.entries(LABEL_CATEGORIA).map(([v, l]) => (
                <option key={v} value={v}>{l}</option>
              ))}
            </select>
          </Campo>

          {/* So aparece onde muda alguma coisa: numa despesa de custo. Numa
              receita ou num repasse, o campo seria ruido. */}
          {form.tipo === 'despesa' && CATEGORIAS_DE_CUSTO.includes(form.categoria ?? 'outros') && (
            <Campo
              rotulo="Quem arcou"
              className="col-6"
              dica="Define de quem e o custo no resultado do imovel."
            >
              <select
                className="select"
                value={form.arcado_por ?? 'proprietario'}
                onChange={(e) => set('arcado_por', e.target.value as ArcadoPor)}
              >
                {Object.entries(LABEL_ARCADO_POR).map(([v, l]) => (
                  <option key={v} value={v}>{l}</option>
                ))}
              </select>
            </Campo>
          )}

          <Campo rotulo="Descricao" obrigatorio erro={erros.descricao} className="col-12">
            <input
              className={`input ${erros.descricao ? 'input--erro' : ''}`}
              value={form.descricao ?? ''}
              onChange={(e) => set('descricao', e.target.value)}
              placeholder="Infiltracao no banheiro - reparo hidraulico"
            />
          </Campo>

          <Campo rotulo="Valor (R$)" obrigatorio erro={erros.valor} className="col-4">
            <input
              className={`input ${erros.valor ? 'input--erro' : ''}`}
              type="number"
              step="0.01"
              value={form.valor ?? ''}
              onChange={(e) => set('valor', Number(e.target.value))}
            />
          </Campo>

          <Campo rotulo="Vencimento" obrigatorio erro={erros.vencimento} className="col-4">
            <input
              className={`input ${erros.vencimento ? 'input--erro' : ''}`}
              type="date"
              value={form.vencimento ?? ''}
              onChange={(e) => set('vencimento', e.target.value)}
            />
          </Campo>

          <Campo rotulo="Competencia" className="col-4" dica="Mes de referencia">
            <input
              className="input"
              type="date"
              value={form.competencia ?? ''}
              onChange={(e) => set('competencia', e.target.value || null)}
            />
          </Campo>

          <Campo rotulo="Status" className="col-6">
            <select
              className="select"
              value={form.status}
              onChange={(e) => set('status', e.target.value as LancamentoStatus)}
            >
              {Object.entries(LABEL_STATUS_LANCAMENTO).map(([v, l]) => (
                <option key={v} value={v}>{l}</option>
              ))}
            </select>
          </Campo>

          <Campo rotulo="Imovel" className="col-6">
            <select
              className="select"
              value={form.imovel_id ?? ''}
              onChange={(e) => set('imovel_id', e.target.value || null)}
            >
              <option value="">Nenhum</option>
              {imoveis.map((i) => (
                <option key={i.id} value={i.id}>{i.codigo} - {i.titulo}</option>
              ))}
            </select>
          </Campo>

          <Campo rotulo="Cliente" className="col-6">
            <select
              className="select"
              value={form.cliente_id ?? ''}
              onChange={(e) => set('cliente_id', e.target.value || null)}
            >
              <option value="">Nenhum</option>
              {clientes.map((c) => (
                <option key={c.id} value={c.id}>{c.nome}</option>
              ))}
            </select>
          </Campo>

          <Campo rotulo="Proprietario" className="col-6">
            <select
              className="select"
              value={form.proprietario_id ?? ''}
              onChange={(e) => set('proprietario_id', e.target.value || null)}
            >
              <option value="">Nenhum</option>
              {proprietarios.map((p) => (
                <option key={p.id} value={p.id}>{p.nome}</option>
              ))}
            </select>
          </Campo>

          <Campo rotulo="Observacoes" className="col-12">
            <textarea
              className="textarea"
              value={form.observacoes ?? ''}
              onChange={(e) => set('observacoes', e.target.value)}
            />
          </Campo>
        </div>
      </Modal>

      {/* ---------------------------------------------------- modal baixa -- */}
      <Modal
        aberto={Boolean(baixando)}
        aoFechar={() => setBaixando(null)}
        titulo="Registrar pagamento"
        subtitulo={baixando?.descricao}
        tamanho="sm"
        rodape={
          <>
            <button className="btn btn--secundario" onClick={() => setBaixando(null)} disabled={processandoBaixa}>
              Cancelar
            </button>
            <button className="btn btn--sucesso" onClick={() => void confirmarBaixa()} disabled={processandoBaixa}>
              {processandoBaixa && <span className="spin spin--sm spin--claro" />}
              Confirmar pagamento
            </button>
          </>
        }
      >
        <div className="form-grade">
          <div className="col-12">
            <div className="aviso aviso--info">
              <Wallet size={16} />
              <div>
                Valor previsto: <strong>{moeda(baixando?.valor)}</strong>
                <div className="t-sm">Vencimento em {data(baixando?.vencimento)}</div>
              </div>
            </div>
          </div>

          <Campo rotulo="Valor recebido (R$)" className="col-12" dica="Ajuste se houve desconto, multa ou juros.">
            <input
              className="input"
              type="number"
              step="0.01"
              value={valorPago}
              onChange={(e) => setValorPago(e.target.value)}
            />
          </Campo>

          <Campo rotulo="Data do pagamento" className="col-6">
            <input
              className="input"
              type="date"
              value={dataPago}
              onChange={(e) => setDataPago(e.target.value)}
            />
          </Campo>

          <Campo rotulo="Forma" className="col-6">
            <select className="select" value={formaPago} onChange={(e) => setFormaPago(e.target.value)}>
              <option value="PIX">PIX</option>
              <option value="Boleto">Boleto</option>
              <option value="Transferencia">Transferencia</option>
              <option value="Dinheiro">Dinheiro</option>
              <option value="Cartao">Cartao</option>
              <option value="Cheque">Cheque</option>
            </select>
          </Campo>
        </div>
      </Modal>

      <Confirmar
        aberto={Boolean(excluir)}
        titulo="Excluir lancamento"
        mensagem={`Excluir "${excluir?.descricao}"? Esta acao nao pode ser desfeita.`}
        textoConfirmar="Excluir"
        perigo
        processando={excluindo}
        aoConfirmar={() => void confirmarExclusao()}
        aoCancelar={() => setExcluir(null)}
      />
    </div>
  )
}
