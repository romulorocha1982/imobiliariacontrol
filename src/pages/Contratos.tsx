import { useCallback, useEffect, useMemo, useState } from 'react'
import {
  Plus, Search, FileText, Pencil, Trash2, Receipt, AlertTriangle, CheckCircle2,
  FileSignature,
} from 'lucide-react'
import { supabase } from '@/lib/supabase'
import { useAuth } from '@/contexts/AuthContext'
import { useToast } from '@/contexts/ToastContext'
import { Modal, Campo, Confirmar, Vazio, SkeletonTabela, BadgeContrato } from '@/components/ui'
import { Anexos } from '@/components/Anexos'
import { GerarContrato } from '@/components/GerarContrato'
import { moeda, data } from '@/lib/format'
import {
  LABEL_STATUS_CONTRATO, LABEL_GARANTIA,
  type ContratoCompleto, type Contrato, type Cliente, type Imovel,
  type ContratoStatus, type GarantiaTipo,
} from '@/lib/types'

type Form = Partial<Contrato>

const MESES = [
  'Janeiro', 'Fevereiro', 'Marco', 'Abril', 'Maio', 'Junho',
  'Julho', 'Agosto', 'Setembro', 'Outubro', 'Novembro', 'Dezembro',
]

function formVazio(): Form {
  const inicio = new Date()
  const fim = new Date()
  fim.setMonth(fim.getMonth() + 30)
  return {
    data_inicio: inicio.toISOString().slice(0, 10),
    data_fim: fim.toISOString().slice(0, 10),
    dia_vencimento: 5,
    taxa_administracao: 10,
    indice_reajuste: 'IGPM',
    mes_reajuste: ((inicio.getMonth() + 11) % 12) + 1,
    garantia: 'fiador',
    status: 'ativo',
    valor_condominio: 0,
    valor_iptu: 0,
  }
}

export default function Contratos() {
  const { pode, comTenant } = useAuth()
  const { ok, erro: toastErro, toast } = useToast()

  const [lista, setLista] = useState<ContratoCompleto[]>([])
  const [imoveis, setImoveis] = useState<Imovel[]>([])
  const [clientes, setClientes] = useState<Cliente[]>([])
  const [carregando, setCarregando] = useState(true)

  const [busca, setBusca] = useState('')
  const [fStatus, setFStatus] = useState<'' | ContratoStatus>('ativo')

  const [modal, setModal] = useState(false)
  const [editando, setEditando] = useState<ContratoCompleto | null>(null)
  const [form, setForm] = useState<Form>(formVazio())
  const [salvando, setSalvando] = useState(false)
  const [erros, setErros] = useState<Record<string, string>>({})
  const [excluir, setExcluir] = useState<ContratoCompleto | null>(null)
  const [excluindo, setExcluindo] = useState(false)
  const [gerando, setGerando] = useState<string | null>(null)

  /** Aba do modal. Anexos precisam do id, entao so existem na edicao. */
  const [aba, setAba] = useState<'dados' | 'anexos'>('dados')

  /** Contrato cuja minuta esta sendo gerada, ou null. */
  const [gerandoDoc, setGerandoDoc] = useState<ContratoCompleto | null>(null)

  const podeEditar = pode('admin', 'gerente', 'financeiro')

  const carregar = useCallback(async () => {
    setCarregando(true)
    const [r1, r2, r3] = await Promise.all([
      supabase.from('vw_contratos_completo').select('*').order('created_at', { ascending: false }),
      supabase.from('imoveis').select('*').neq('status', 'inativo').order('codigo'),
      supabase.from('clientes').select('*').eq('ativo', true).order('nome'),
    ])
    if (r1.error) toastErro('Erro ao carregar contratos', r1.error.message)
    else setLista((r1.data ?? []) as ContratoCompleto[])
    if (!r2.error) setImoveis((r2.data ?? []) as Imovel[])
    if (!r3.error) setClientes((r3.data ?? []) as Cliente[])
    setCarregando(false)
  }, [toastErro])

  useEffect(() => { void carregar() }, [carregar])

  const filtrados = useMemo(() => {
    const q = busca.trim().toLowerCase()
    return lista.filter((c) => {
      if (fStatus && c.status !== fStatus) return false
      if (!q) return true
      return [c.numero, c.inquilino_nome, c.imovel_titulo, c.imovel_codigo, c.proprietario_nome]
        .filter(Boolean)
        .some((x) => String(x).toLowerCase().includes(q))
    })
  }, [lista, busca, fStatus])

  function abrirNovo() {
    setEditando(null)
    setForm(formVazio())
    setErros({})
    setAba('dados')
    setModal(true)
  }

  function abrirEdicao(c: ContratoCompleto) {
    setEditando(c)
    setForm({ ...c })
    setErros({})
    setAba('dados')
    setModal(true)
  }

  /** Ao escolher o imovel, puxa os valores cadastrados nele */
  function escolherImovel(id: string) {
    const im = imoveis.find((i) => i.id === id)
    setForm((f) => ({
      ...f,
      imovel_id: id,
      valor_aluguel: im?.valor_aluguel ?? f.valor_aluguel,
      valor_condominio: im?.valor_condominio ?? 0,
      valor_iptu: im?.valor_iptu ?? 0,
      taxa_administracao: im?.taxa_administracao ?? f.taxa_administracao,
    }))
  }

  function validar(): boolean {
    const e: Record<string, string> = {}
    if (!form.imovel_id) e.imovel_id = 'Selecione o imovel.'
    if (!form.inquilino_id) e.inquilino_id = 'Selecione o inquilino.'
    if (!form.valor_aluguel) e.valor_aluguel = 'Informe o valor do aluguel.'
    if (!form.data_inicio) e.data_inicio = 'Informe a data de inicio.'
    if (!form.data_fim) e.data_fim = 'Informe a data de termino.'
    if (form.data_inicio && form.data_fim && form.data_fim <= form.data_inicio) {
      e.data_fim = 'O termino precisa ser depois do inicio.'
    }
    if (form.garantia === 'fiador' && !form.fiador_id) {
      e.fiador_id = 'Contrato com fiador exige um fiador cadastrado.'
    }
    setErros(e)
    return Object.keys(e).length === 0
  }

  async function salvar() {
    if (!validar()) return
    setSalvando(true)

    const payload: Record<string, unknown> = { ...form }
    for (const c of [
      'imovel_codigo', 'imovel_titulo', 'imovel_bairro', 'imovel_cidade',
      'inquilino_nome', 'inquilino_telefone', 'fiador_nome', 'proprietario_nome',
      'dias_para_vencer', 'created_at', 'updated_at',
    ]) {
      delete payload[c]
    }
    if (!editando) delete payload.id

    // payload e montado como mapa solto para remover as colunas da view
    const dados = payload as Partial<Contrato>

    const resposta = editando
      ? await supabase.from('contratos').update(dados).eq('id', editando.id)
      : await supabase.from('contratos').insert(comTenant(dados)).select('id').single()

    setSalvando(false)
    if (resposta.error) return toastErro('Nao foi possivel salvar', resposta.error.message)

    setModal(false)

    if (!editando) {
      const novoId = (resposta.data as { id: string } | null)?.id
      ok('Contrato criado', 'Use "Gerar parcelas" para lancar os alugueis no financeiro.')
      if (novoId) await gerarParcelas(novoId, true)
    } else {
      ok('Contrato atualizado')
    }

    void carregar()
  }

  /**
   * Sincroniza o financeiro com o contrato: cria as competencias que faltam,
   * atualiza as que estao em aberto e remove o que deixou de valer. Nada que ja
   * foi pago e tocado -- para isso existe estorno, decidido a mao.
   */
  async function gerarParcelas(contratoId: string, silencioso = false) {
    setGerando(contratoId)
    const { data, error } = await supabase.rpc('gerar_parcelas_contrato', {
      p_contrato_id: contratoId,
    })
    setGerando(null)

    if (error) return toastErro('Erro ao gerar parcelas', error.message)

    const criados = Number(data?.criados ?? 0)
    const atualizados = Number(data?.atualizados ?? 0)
    const removidos = Number(data?.removidos ?? 0)

    // Cada numero vira uma frase so quando ha o que contar: "0 removidos" num
    // aviso de sucesso e ruido.
    const partes = [
      criados && `${criados} lancamento(s) criado(s)`,
      atualizados && `${atualizados} atualizado(s)`,
      removidos && `${removidos} removido(s)`,
    ].filter(Boolean) as string[]

    if (partes.length === 0) {
      if (!silencioso) {
        toast(
          'info',
          'Financeiro ja esta em dia',
          'Os lancamentos deste contrato ja refletem os valores atuais.',
        )
      }
      return
    }

    ok(partes.join(' · '), 'Confira no modulo Financeiro.')
  }

  async function confirmarExclusao() {
    if (!excluir) return
    setExcluindo(true)
    const { error } = await supabase.from('contratos').delete().eq('id', excluir.id)
    setExcluindo(false)
    if (error) return toastErro('Nao foi possivel excluir', error.message)
    ok('Contrato excluido', 'Os lancamentos vinculados tambem foram removidos.')
    setExcluir(null)
    void carregar()
  }

  const set = <K extends keyof Form>(c: K, v: Form[K]) => setForm((f) => ({ ...f, [c]: v }))

  const inquilinos = clientes.filter((c) => c.tipo === 'inquilino' || c.tipo === 'interessado')
  const fiadores = clientes.filter((c) => c.tipo === 'fiador' || c.tipo === 'interessado')

  const totalMensal =
    Number(form.valor_aluguel ?? 0) +
    Number(form.valor_condominio ?? 0) +
    Number(form.valor_iptu ?? 0)
  const taxaValor = Number(form.valor_aluguel ?? 0) * Number(form.taxa_administracao ?? 0) / 100

  return (
    <div>
      <div className="barra">
        <div className="busca">
          <Search size={15} />
          <input
            className="input"
            placeholder="Buscar por numero, inquilino, imovel..."
            value={busca}
            onChange={(e) => setBusca(e.target.value)}
          />
        </div>

        <select className="select" value={fStatus} onChange={(e) => setFStatus(e.target.value as ContratoStatus | '')}>
          <option value="">Todos os status</option>
          {Object.entries(LABEL_STATUS_CONTRATO).map(([v, l]) => (
            <option key={v} value={v}>{l}</option>
          ))}
        </select>

        <div className="barra__dir">
          <span className="contador">{filtrados.length} de {lista.length}</span>
          {podeEditar && (
            <button className="btn btn--primario" onClick={abrirNovo}>
              <Plus size={16} /> Novo contrato
            </button>
          )}
        </div>
      </div>

      {carregando ? (
        <SkeletonTabela linhas={5} colunas={6} />
      ) : filtrados.length === 0 ? (
        <div className="card">
          <Vazio
            icone={<FileText size={24} />}
            titulo={lista.length === 0 ? 'Nenhum contrato cadastrado' : 'Nada encontrado'}
            texto={
              lista.length === 0
                ? 'Cadastre o imovel e o inquilino primeiro, depois crie o contrato de locacao.'
                : 'Ajuste a busca ou o filtro de status.'
            }
            acao={
              podeEditar && lista.length === 0 ? (
                <button className="btn btn--primario" onClick={abrirNovo}>
                  <Plus size={16} /> Criar contrato
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
                <th>Contrato</th>
                <th>Imovel</th>
                <th>Inquilino</th>
                <th>Vigencia</th>
                <th>Status</th>
                <th className="num">Aluguel</th>
                {podeEditar && <th className="acoes">Acoes</th>}
              </tr>
            </thead>
            <tbody>
              {filtrados.map((c) => (
                <tr key={c.id}>
                  <td>
                    <span className="codigo">{c.numero}</span>
                    <div className="celula-fraca">Venc. dia {c.dia_vencimento}</div>
                  </td>
                  <td>
                    <div className="celula-forte">{c.imovel_titulo}</div>
                    <div className="celula-fraca">
                      {c.imovel_codigo} - {[c.imovel_bairro, c.imovel_cidade].filter(Boolean).join(', ')}
                    </div>
                  </td>
                  <td>
                    <div className="celula-forte">{c.inquilino_nome}</div>
                    {c.inquilino_telefone && <div className="celula-fraca">{c.inquilino_telefone}</div>}
                  </td>
                  <td>
                    <div className="t-sm">{data(c.data_inicio)} a {data(c.data_fim)}</div>
                    {c.status === 'ativo' && c.dias_para_vencer <= 90 && (
                      <span className={`badge badge--${c.dias_para_vencer <= 30 ? 'erro' : 'alerta'}`}>
                        <AlertTriangle size={10} />
                        {c.dias_para_vencer <= 0 ? 'Vencido' : `${c.dias_para_vencer}d`}
                      </span>
                    )}
                  </td>
                  <td><BadgeContrato status={c.status} /></td>
                  <td className="num">
                    <div className="celula-forte">{moeda(c.valor_aluguel)}</div>
                    <div className="celula-fraca">taxa {c.taxa_administracao}%</div>
                  </td>
                  {podeEditar && (
                    <td className="acoes">
                      <button
                        className="btn btn--fantasma btn--sm"
                        onClick={() => void gerarParcelas(c.id)}
                        disabled={gerando === c.id}
                        title="Gerar parcelas no financeiro"
                      >
                        {gerando === c.id ? <span className="spin spin--sm" /> : <Receipt size={13} />}
                      </button>
                      <button
                        className="btn btn--fantasma btn--sm"
                        onClick={() => setGerandoDoc(c)}
                        title="Gerar o contrato em PDF"
                      >
                        <FileSignature size={13} />
                      </button>
                      <button className="btn btn--fantasma btn--sm" onClick={() => abrirEdicao(c)} title="Editar">
                        <Pencil size={13} />
                      </button>
                      <button className="btn btn--fantasma btn--sm" onClick={() => setExcluir(c)} title="Excluir">
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

      <Modal
        aberto={modal}
        aoFechar={() => setModal(false)}
        titulo={editando ? `Contrato ${editando.numero}` : 'Novo contrato de locacao'}
        subtitulo={editando?.imovel_titulo}
        tamanho="lg"
        rodape={
          <>
            <button className="btn btn--secundario" onClick={() => setModal(false)} disabled={salvando}>
              {aba === 'dados' ? 'Cancelar' : 'Fechar'}
            </button>
            {aba === 'dados' && (
              <button className="btn btn--primario" onClick={() => void salvar()} disabled={salvando}>
                {salvando && <span className="spin spin--sm spin--claro" />}
                {editando ? 'Salvar alteracoes' : 'Criar contrato'}
              </button>
            )}
          </>
        }
      >
        {editando && (
          <div className="abas">
            <button
              className={`aba ${aba === 'dados' ? 'aba--ativa' : ''}`}
              onClick={() => setAba('dados')}
            >
              Dados
            </button>
            <button
              className={`aba ${aba === 'anexos' ? 'aba--ativa' : ''}`}
              onClick={() => setAba('anexos')}
            >
              Contrato assinado e anexos
            </button>
          </div>
        )}

        {editando && aba === 'anexos' && (
          <div className="form-grade">
            <Anexos escopo="contratos" registroId={editando.id} tipoPadrao="contrato_assinado" />
          </div>
        )}

        <div className="form-grade" hidden={aba !== 'dados'}>
          <div className="form-secao">Partes envolvidas</div>

          <Campo rotulo="Imovel" obrigatorio erro={erros.imovel_id} className="col-12">
            <select
              className={`select ${erros.imovel_id ? 'input--erro' : ''}`}
              value={form.imovel_id ?? ''}
              onChange={(e) => escolherImovel(e.target.value)}
            >
              <option value="">Selecione o imovel</option>
              {imoveis.map((i) => (
                <option key={i.id} value={i.id}>
                  {i.codigo} - {i.titulo}
                  {i.status === 'alugado' && i.id !== form.imovel_id ? ' (ja alugado)' : ''}
                </option>
              ))}
            </select>
          </Campo>

          <Campo rotulo="Inquilino" obrigatorio erro={erros.inquilino_id} className="col-6">
            <select
              className={`select ${erros.inquilino_id ? 'input--erro' : ''}`}
              value={form.inquilino_id ?? ''}
              onChange={(e) => set('inquilino_id', e.target.value)}
            >
              <option value="">Selecione</option>
              {inquilinos.map((c) => (
                <option key={c.id} value={c.id}>{c.nome}</option>
              ))}
            </select>
          </Campo>

          <Campo rotulo="Garantia" className="col-6">
            <select
              className="select"
              value={form.garantia}
              onChange={(e) => set('garantia', e.target.value as GarantiaTipo)}
            >
              {Object.entries(LABEL_GARANTIA).map(([v, l]) => (
                <option key={v} value={v}>{l}</option>
              ))}
            </select>
          </Campo>

          {form.garantia === 'fiador' && (
            <Campo rotulo="Fiador" obrigatorio erro={erros.fiador_id} className="col-6">
              <select
                className={`select ${erros.fiador_id ? 'input--erro' : ''}`}
                value={form.fiador_id ?? ''}
                onChange={(e) => set('fiador_id', e.target.value || null)}
              >
                <option value="">Selecione</option>
                {fiadores.map((c) => (
                  <option key={c.id} value={c.id}>{c.nome}</option>
                ))}
              </select>
            </Campo>
          )}

          {(form.garantia === 'caucao' || form.garantia === 'titulo_capitalizacao') && (
            <Campo rotulo="Valor da garantia (R$)" className="col-6">
              <input
                className="input"
                type="number"
                step="0.01"
                value={form.valor_caucao ?? ''}
                onChange={(e) => set('valor_caucao', e.target.value === '' ? null : Number(e.target.value))}
              />
            </Campo>
          )}

          <div className="form-secao">Vigencia</div>

          <Campo rotulo="Inicio" obrigatorio erro={erros.data_inicio} className="col-3">
            <input
              className={`input ${erros.data_inicio ? 'input--erro' : ''}`}
              type="date"
              value={form.data_inicio ?? ''}
              onChange={(e) => set('data_inicio', e.target.value)}
            />
          </Campo>

          <Campo rotulo="Termino" obrigatorio erro={erros.data_fim} className="col-3">
            <input
              className={`input ${erros.data_fim ? 'input--erro' : ''}`}
              type="date"
              value={form.data_fim ?? ''}
              onChange={(e) => set('data_fim', e.target.value)}
            />
          </Campo>

          <Campo rotulo="Dia do vencimento" className="col-3">
            <select
              className="select"
              value={form.dia_vencimento ?? 5}
              onChange={(e) => set('dia_vencimento', Number(e.target.value))}
            >
              {Array.from({ length: 28 }, (_, i) => i + 1).map((d) => (
                <option key={d} value={d}>Dia {d}</option>
              ))}
            </select>
          </Campo>

          <Campo rotulo="Status" className="col-3">
            <select
              className="select"
              value={form.status}
              onChange={(e) => set('status', e.target.value as ContratoStatus)}
            >
              {Object.entries(LABEL_STATUS_CONTRATO).map(([v, l]) => (
                <option key={v} value={v}>{l}</option>
              ))}
            </select>
          </Campo>

          <div className="form-secao">Valores e reajuste</div>

          <Campo rotulo="Aluguel (R$)" obrigatorio erro={erros.valor_aluguel} className="col-3">
            <input
              className={`input ${erros.valor_aluguel ? 'input--erro' : ''}`}
              type="number"
              step="0.01"
              value={form.valor_aluguel ?? ''}
              onChange={(e) => set('valor_aluguel', Number(e.target.value))}
            />
          </Campo>

          <Campo rotulo="Condominio (R$)" className="col-3">
            <input
              className="input"
              type="number"
              step="0.01"
              value={form.valor_condominio ?? 0}
              onChange={(e) => set('valor_condominio', Number(e.target.value))}
            />
          </Campo>

          <Campo rotulo="IPTU (R$)" className="col-3">
            <input
              className="input"
              type="number"
              step="0.01"
              value={form.valor_iptu ?? 0}
              onChange={(e) => set('valor_iptu', Number(e.target.value))}
            />
          </Campo>

          <Campo rotulo="Taxa adm (%)" className="col-3">
            <input
              className="input"
              type="number"
              step="0.01"
              value={form.taxa_administracao ?? 10}
              onChange={(e) => set('taxa_administracao', Number(e.target.value))}
            />
          </Campo>

          <Campo rotulo="Indice de reajuste" className="col-6">
            <select
              className="select"
              value={form.indice_reajuste ?? 'IGPM'}
              onChange={(e) => set('indice_reajuste', e.target.value)}
            >
              <option value="IGPM">IGP-M (FGV)</option>
              <option value="IPCA">IPCA (IBGE)</option>
              <option value="INPC">INPC (IBGE)</option>
              <option value="FIXO">Sem reajuste</option>
            </select>
          </Campo>

          <Campo rotulo="Mes do reajuste" className="col-6">
            <select
              className="select"
              value={form.mes_reajuste ?? ''}
              onChange={(e) => set('mes_reajuste', e.target.value === '' ? null : Number(e.target.value))}
            >
              <option value="">Nao definido</option>
              {MESES.map((m, i) => (
                <option key={m} value={i + 1}>{m}</option>
              ))}
            </select>
          </Campo>

          {/* resumo calculado */}
          <div className="col-12">
            <div className="aviso aviso--info">
              <CheckCircle2 size={16} />
              <div>
                <strong>Total mensal ao inquilino: {moeda(totalMensal)}</strong>
                <div className="t-sm mt-0">
                  Taxa da imobiliaria: {moeda(taxaValor)} &middot; Repasse ao proprietario:{' '}
                  {moeda(Number(form.valor_aluguel ?? 0) - taxaValor)}
                </div>
              </div>
            </div>
          </div>

          {form.status === 'rescindido' && (
            <>
              <Campo rotulo="Data da rescisao" className="col-4">
                <input
                  className="input"
                  type="date"
                  value={form.data_rescisao ?? ''}
                  onChange={(e) => set('data_rescisao', e.target.value || null)}
                />
              </Campo>
              <Campo rotulo="Motivo" className="col-8">
                <input
                  className="input"
                  value={form.motivo_rescisao ?? ''}
                  onChange={(e) => set('motivo_rescisao', e.target.value)}
                />
              </Campo>
            </>
          )}

          <Campo rotulo="Observacoes" className="col-12">
            <textarea
              className="textarea"
              value={form.observacoes ?? ''}
              onChange={(e) => set('observacoes', e.target.value)}
              placeholder="Clausulas especiais, acordos, benfeitorias..."
            />
          </Campo>
        </div>
      </Modal>

      <Confirmar
        aberto={Boolean(excluir)}
        titulo="Excluir contrato"
        mensagem={`Excluir o contrato ${excluir?.numero}? Todos os lancamentos financeiros vinculados serao apagados junto.`}
        textoConfirmar="Excluir"
        perigo
        processando={excluindo}
        aoConfirmar={() => void confirmarExclusao()}
        aoCancelar={() => setExcluir(null)}
      />

      <GerarContrato
        aberto={Boolean(gerandoDoc)}
        aoFechar={() => setGerandoDoc(null)}
        contrato={gerandoDoc}
      />
    </div>
  )
}
