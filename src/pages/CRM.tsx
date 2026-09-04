import { useCallback, useEffect, useMemo, useState, type DragEvent } from 'react'
import {
  Plus, Target, Pencil, Trash2, Building2, User, Trophy, XCircle, Search,
} from 'lucide-react'
import { supabase } from '@/lib/supabase'
import { useAuth } from '@/contexts/AuthContext'
import { useToast } from '@/contexts/ToastContext'
import { Modal, Campo, Confirmar, Carregando, Vazio, BadgeEtapa } from '@/components/ui'
import { moeda, moedaCurta, data } from '@/lib/format'
import {
  LABEL_ETAPA, ETAPAS_FUNIL,
  type Negociacao, type NegociacaoEtapa, type Cliente, type Imovel, type Profile,
} from '@/lib/types'

interface NegociacaoLinha extends Negociacao {
  cliente_nome?: string
  cliente_telefone?: string | null
  imovel_codigo?: string | null
  imovel_titulo?: string | null
  corretor_nome?: string | null
}

type Form = Partial<Negociacao>

const ORIGENS = [
  'Site proprio', 'Portal (Viva Real / ZAP)', 'Indicacao', 'Placa no imovel',
  'Redes sociais', 'WhatsApp', 'Telefone', 'Visita a loja', 'Outro',
]

export default function CRM() {
  const { pode, perfil, comTenant } = useAuth()
  const { ok, erro: toastErro } = useToast()

  const [lista, setLista] = useState<NegociacaoLinha[]>([])
  const [clientes, setClientes] = useState<Cliente[]>([])
  const [imoveis, setImoveis] = useState<Imovel[]>([])
  const [corretores, setCorretores] = useState<Profile[]>([])
  const [carregando, setCarregando] = useState(true)

  const [busca, setBusca] = useState('')
  const [modal, setModal] = useState(false)
  const [editando, setEditando] = useState<NegociacaoLinha | null>(null)
  const [form, setForm] = useState<Form>({})
  const [salvando, setSalvando] = useState(false)
  const [erros, setErros] = useState<Record<string, string>>({})
  const [excluir, setExcluir] = useState<NegociacaoLinha | null>(null)
  const [excluindo, setExcluindo] = useState(false)

  const [arrastando, setArrastando] = useState<string | null>(null)
  const [colunaSobre, setColunaSobre] = useState<NegociacaoEtapa | null>(null)

  const podeEditar = pode('admin', 'gerente', 'corretor')

  const carregar = useCallback(async () => {
    setCarregando(true)
    const [r1, r2, r3, r4] = await Promise.all([
      supabase
        .from('negociacoes')
        // A chave estrangeira e citada explicitamente porque negociacoes tem mais
        // de um caminho para cada uma dessas tabelas (a coluna em si, o
        // created_by e a chave composta de tenant do 005). Sem o apelido da FK,
        // o PostgREST recusa o embed com PGRST201 - ambiguous relationship.
        .select(`
          *,
          cliente:clientes!negociacoes_cliente_id_fkey ( nome, telefone ),
          imovel:imoveis!negociacoes_imovel_id_fkey ( codigo, titulo ),
          corretor:profiles!negociacoes_corretor_id_fkey ( nome )
        `)
        .order('updated_at', { ascending: false }),
      supabase.from('clientes').select('*').eq('ativo', true).order('nome'),
      supabase.from('imoveis').select('*').neq('status', 'inativo').order('codigo'),
      supabase.from('profiles').select('*').eq('ativo', true).order('nome'),
    ])

    if (r1.error) {
      toastErro('Erro ao carregar negociacoes', r1.error.message)
    } else {
      type Bruta = Negociacao & {
        cliente: { nome: string; telefone: string | null } | null
        imovel: { codigo: string | null; titulo: string } | null
        corretor: { nome: string } | null
      }
      setLista(
        ((r1.data ?? []) as Bruta[]).map((n) => ({
          ...n,
          cliente_nome: n.cliente?.nome,
          cliente_telefone: n.cliente?.telefone ?? null,
          imovel_codigo: n.imovel?.codigo ?? null,
          imovel_titulo: n.imovel?.titulo ?? null,
          corretor_nome: n.corretor?.nome ?? null,
        })),
      )
    }
    if (!r2.error) setClientes((r2.data ?? []) as Cliente[])
    if (!r3.error) setImoveis((r3.data ?? []) as Imovel[])
    if (!r4.error) setCorretores((r4.data ?? []) as Profile[])
    setCarregando(false)
  }, [toastErro])

  useEffect(() => { void carregar() }, [carregar])

  const filtrados = useMemo(() => {
    const q = busca.trim().toLowerCase()
    if (!q) return lista
    return lista.filter((n) =>
      [n.cliente_nome, n.imovel_titulo, n.imovel_codigo, n.corretor_nome, n.origem]
        .filter(Boolean)
        .some((x) => String(x).toLowerCase().includes(q)),
    )
  }, [lista, busca])

  const porEtapa = useCallback(
    (etapa: NegociacaoEtapa) => filtrados.filter((n) => n.etapa === etapa),
    [filtrados],
  )

  const fechados = porEtapa('fechado')
  const perdidos = porEtapa('perdido')

  /* --------------------------------------------------- drag and drop -- */

  function aoIniciarArrasto(e: DragEvent<HTMLDivElement>, id: string) {
    setArrastando(id)
    e.dataTransfer.effectAllowed = 'move'
    e.dataTransfer.setData('text/plain', id)
  }

  function aoPassarPorCima(e: DragEvent<HTMLDivElement>, etapa: NegociacaoEtapa) {
    e.preventDefault()
    e.dataTransfer.dropEffect = 'move'
    setColunaSobre(etapa)
  }

  async function aoSoltar(e: DragEvent<HTMLDivElement>, etapa: NegociacaoEtapa) {
    e.preventDefault()
    setColunaSobre(null)
    const id = e.dataTransfer.getData('text/plain') || arrastando
    setArrastando(null)
    if (!id) return

    const atual = lista.find((n) => n.id === id)
    if (!atual || atual.etapa === etapa) return

    // Atualiza na tela primeiro; se falhar no banco, reverte
    setLista((l) => l.map((n) => (n.id === id ? { ...n, etapa } : n)))

    const { error } = await supabase.from('negociacoes').update({ etapa }).eq('id', id)
    if (error) {
      setLista((l) => l.map((n) => (n.id === id ? { ...n, etapa: atual.etapa } : n)))
      toastErro('Nao foi possivel mover', error.message)
      return
    }
    ok(`Movido para ${LABEL_ETAPA[etapa]}`)
  }

  /* --------------------------------------------------------- cadastro -- */

  function abrirNovo(etapa: NegociacaoEtapa = 'lead') {
    setEditando(null)
    setForm({ etapa, corretor_id: perfil?.id })
    setErros({})
    setModal(true)
  }

  function abrirEdicao(n: NegociacaoLinha) {
    setEditando(n)
    setForm({ ...n })
    setErros({})
    setModal(true)
  }

  function validar(): boolean {
    const e: Record<string, string> = {}
    if (!form.cliente_id) e.cliente_id = 'Selecione o cliente.'
    if (form.etapa === 'perdido' && !form.motivo_perda?.trim()) {
      e.motivo_perda = 'Registre o motivo da perda.'
    }
    setErros(e)
    return Object.keys(e).length === 0
  }

  async function salvar() {
    if (!validar()) return
    setSalvando(true)

    const payload: Record<string, unknown> = { ...form }
    for (const c of [
      'cliente', 'imovel', 'corretor', 'cliente_nome', 'cliente_telefone',
      'imovel_codigo', 'imovel_titulo', 'corretor_nome', 'created_at', 'updated_at',
    ]) {
      delete payload[c]
    }
    if (!editando) delete payload.id

    // payload e montado como mapa solto para remover os campos aninhados
    const dados = payload as Partial<Negociacao>

    const resposta = editando
      ? await supabase.from('negociacoes').update(dados).eq('id', editando.id)
      : await supabase.from('negociacoes').insert(comTenant(dados))

    setSalvando(false)
    if (resposta.error) return toastErro('Nao foi possivel salvar', resposta.error.message)

    ok(editando ? 'Negociacao atualizada' : 'Negociacao criada')
    setModal(false)
    void carregar()
  }

  async function confirmarExclusao() {
    if (!excluir) return
    setExcluindo(true)
    const { error } = await supabase.from('negociacoes').delete().eq('id', excluir.id)
    setExcluindo(false)
    if (error) return toastErro('Nao foi possivel excluir', error.message)
    ok('Negociacao excluida')
    setExcluir(null)
    void carregar()
  }

  const set = <K extends keyof Form>(c: K, v: Form[K]) => setForm((f) => ({ ...f, [c]: v }))

  if (carregando) return <Carregando texto="Carregando funil..." />

  return (
    <div>
      <div className="barra">
        <div className="busca">
          <Search size={15} />
          <input
            className="input"
            placeholder="Buscar cliente, imovel, corretor..."
            value={busca}
            onChange={(e) => setBusca(e.target.value)}
          />
        </div>

        <div className="barra__dir">
          <span className="chip">
            <Trophy size={12} /> {fechados.length} fechada(s)
          </span>
          <span className="chip">
            <XCircle size={12} /> {perdidos.length} perdida(s)
          </span>
          {podeEditar && (
            <button className="btn btn--primario" onClick={() => abrirNovo()}>
              <Plus size={16} /> Nova negociacao
            </button>
          )}
        </div>
      </div>

      {lista.length === 0 ? (
        <div className="card">
          <Vazio
            icone={<Target size={24} />}
            titulo="Funil vazio"
            texto="Registre os interessados e acompanhe cada etapa ate o fechamento. Arraste os cards entre as colunas para avancar."
            acao={
              podeEditar ? (
                <button className="btn btn--primario" onClick={() => abrirNovo()}>
                  <Plus size={16} /> Criar primeira negociacao
                </button>
              ) : undefined
            }
          />
        </div>
      ) : (
        <div className="kanban">
          {ETAPAS_FUNIL.map((etapa) => {
            const itens = porEtapa(etapa)
            const soma = itens.reduce((s, n) => s + Number(n.valor_proposta ?? 0), 0)

            return (
              <div
                key={etapa}
                className={`kanban__coluna ${colunaSobre === etapa ? 'kanban__coluna--sobre' : ''}`}
                onDragOver={(e) => aoPassarPorCima(e, etapa)}
                onDragLeave={() => setColunaSobre(null)}
                onDrop={(e) => void aoSoltar(e, etapa)}
              >
                <div className="kanban__topo">
                  <span className="kanban__nome">{LABEL_ETAPA[etapa]}</span>
                  <span className="kanban__qtd">{itens.length}</span>
                </div>

                {soma > 0 && <div className="kanban__soma">{moedaCurta(soma)} em propostas</div>}

                <div className="kanban__cards">
                  {itens.map((n) => (
                    <div
                      key={n.id}
                      className={`kanban__card ${arrastando === n.id ? 'kanban__card--arrastando' : ''}`}
                      draggable={podeEditar}
                      onDragStart={(e) => aoIniciarArrasto(e, n.id)}
                      onDragEnd={() => setArrastando(null)}
                      onDoubleClick={() => podeEditar && abrirEdicao(n)}
                    >
                      <div className="kanban__card-nome">{n.cliente_nome ?? 'Cliente'}</div>

                      {n.imovel_titulo && (
                        <div className="kanban__card-info">
                          <Building2 size={11} />
                          <span style={{ overflow: 'hidden', textOverflow: 'ellipsis', whiteSpace: 'nowrap' }}>
                            {n.imovel_codigo} - {n.imovel_titulo}
                          </span>
                        </div>
                      )}

                      {Boolean(n.valor_proposta) && (
                        <div className="kanban__card-valor">{moeda(n.valor_proposta)}</div>
                      )}

                      <div className="kanban__card-rodape">
                        <User size={11} />
                        <span className="crescer">{n.corretor_nome ?? 'Sem corretor'}</span>
                        {podeEditar && (
                          <>
                            <button
                              className="btn btn--fantasma btn--sm"
                              style={{ padding: 3 }}
                              onClick={() => abrirEdicao(n)}
                              title="Editar"
                            >
                              <Pencil size={11} />
                            </button>
                            <button
                              className="btn btn--fantasma btn--sm"
                              style={{ padding: 3 }}
                              onClick={() => setExcluir(n)}
                              title="Excluir"
                            >
                              <Trash2 size={11} color="var(--erro)" />
                            </button>
                          </>
                        )}
                      </div>
                    </div>
                  ))}

                  {itens.length === 0 && (
                    <div className="t-3 t-xs centro" style={{ padding: '18px 8px' }}>
                      Arraste cards para ca
                    </div>
                  )}
                </div>
              </div>
            )
          })}

          {/* colunas terminais */}
          {(['fechado', 'perdido'] as NegociacaoEtapa[]).map((etapa) => {
            const itens = porEtapa(etapa)
            return (
              <div
                key={etapa}
                className={`kanban__coluna ${colunaSobre === etapa ? 'kanban__coluna--sobre' : ''}`}
                onDragOver={(e) => aoPassarPorCima(e, etapa)}
                onDragLeave={() => setColunaSobre(null)}
                onDrop={(e) => void aoSoltar(e, etapa)}
              >
                <div className="kanban__topo">
                  {etapa === 'fechado'
                    ? <Trophy size={13} color="var(--ok)" />
                    : <XCircle size={13} color="var(--erro)" />}
                  <span className="kanban__nome">{LABEL_ETAPA[etapa]}</span>
                  <span className="kanban__qtd">{itens.length}</span>
                </div>

                <div className="kanban__cards">
                  {itens.slice(0, 25).map((n) => (
                    <div
                      key={n.id}
                      className="kanban__card"
                      draggable={podeEditar}
                      onDragStart={(e) => aoIniciarArrasto(e, n.id)}
                      onDragEnd={() => setArrastando(null)}
                      onDoubleClick={() => podeEditar && abrirEdicao(n)}
                    >
                      <div className="kanban__card-nome">{n.cliente_nome}</div>
                      {Boolean(n.valor_proposta) && (
                        <div
                          className="kanban__card-valor"
                          style={{ color: etapa === 'fechado' ? 'var(--ok)' : 'var(--texto-3)' }}
                        >
                          {moeda(n.valor_proposta)}
                        </div>
                      )}
                      {etapa === 'perdido' && n.motivo_perda && (
                        <div className="kanban__card-info mt-1">{n.motivo_perda}</div>
                      )}
                    </div>
                  ))}
                  {itens.length === 0 && (
                    <div className="t-3 t-xs centro" style={{ padding: '18px 8px' }}>
                      Nenhuma
                    </div>
                  )}
                </div>
              </div>
            )
          })}
        </div>
      )}

      <Modal
        aberto={modal}
        aoFechar={() => setModal(false)}
        titulo={editando ? 'Editar negociacao' : 'Nova negociacao'}
        subtitulo={editando ? `Criada em ${data(editando.created_at)}` : undefined}
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
          <Campo rotulo="Cliente" obrigatorio erro={erros.cliente_id} className="col-12">
            <select
              className={`select ${erros.cliente_id ? 'input--erro' : ''}`}
              value={form.cliente_id ?? ''}
              onChange={(e) => set('cliente_id', e.target.value)}
            >
              <option value="">Selecione o cliente</option>
              {clientes.map((c) => (
                <option key={c.id} value={c.id}>{c.nome}</option>
              ))}
            </select>
          </Campo>

          <Campo rotulo="Imovel de interesse" className="col-12">
            <select
              className="select"
              value={form.imovel_id ?? ''}
              onChange={(e) => set('imovel_id', e.target.value || null)}
            >
              <option value="">Ainda nao definido</option>
              {imoveis.map((i) => (
                <option key={i.id} value={i.id}>{i.codigo} - {i.titulo}</option>
              ))}
            </select>
          </Campo>

          <Campo rotulo="Etapa" className="col-6">
            <select
              className="select"
              value={form.etapa ?? 'lead'}
              onChange={(e) => set('etapa', e.target.value as NegociacaoEtapa)}
            >
              {Object.entries(LABEL_ETAPA).map(([v, l]) => (
                <option key={v} value={v}>{l}</option>
              ))}
            </select>
          </Campo>

          <Campo rotulo="Corretor responsavel" className="col-6">
            <select
              className="select"
              value={form.corretor_id ?? ''}
              onChange={(e) => set('corretor_id', e.target.value || null)}
            >
              <option value="">Sem responsavel</option>
              {corretores.map((c) => (
                <option key={c.id} value={c.id}>{c.nome}</option>
              ))}
            </select>
          </Campo>

          <Campo rotulo="Valor da proposta (R$)" className="col-6">
            <input
              className="input"
              type="number"
              step="0.01"
              value={form.valor_proposta ?? ''}
              onChange={(e) => set('valor_proposta', e.target.value === '' ? null : Number(e.target.value))}
            />
          </Campo>

          <Campo rotulo="Previsao de fechamento" className="col-6">
            <input
              className="input"
              type="date"
              value={form.data_prevista_fechamento ?? ''}
              onChange={(e) => set('data_prevista_fechamento', e.target.value || null)}
            />
          </Campo>

          <Campo rotulo="Origem do contato" className="col-12">
            <select
              className="select"
              value={form.origem ?? ''}
              onChange={(e) => set('origem', e.target.value || null)}
            >
              <option value="">Nao informada</option>
              {ORIGENS.map((o) => (
                <option key={o} value={o}>{o}</option>
              ))}
            </select>
          </Campo>

          {form.etapa === 'perdido' && (
            <Campo rotulo="Motivo da perda" obrigatorio erro={erros.motivo_perda} className="col-12">
              <input
                className={`input ${erros.motivo_perda ? 'input--erro' : ''}`}
                value={form.motivo_perda ?? ''}
                onChange={(e) => set('motivo_perda', e.target.value)}
                placeholder="Preco acima do orcamento, escolheu outro imovel..."
              />
            </Campo>
          )}

          <Campo rotulo="Anotacoes" className="col-12">
            <textarea
              className="textarea"
              value={form.observacoes ?? ''}
              onChange={(e) => set('observacoes', e.target.value)}
              placeholder="Historico do atendimento, preferencias, proximos passos..."
            />
          </Campo>

          {editando && (
            <div className="col-12">
              <div className="linha t-sm t-3">
                Etapa atual: <BadgeEtapa etapa={editando.etapa} />
              </div>
            </div>
          )}
        </div>
      </Modal>

      <Confirmar
        aberto={Boolean(excluir)}
        titulo="Excluir negociacao"
        mensagem={`Excluir a negociacao de ${excluir?.cliente_nome}? Esta acao nao pode ser desfeita.`}
        textoConfirmar="Excluir"
        perigo
        processando={excluindo}
        aoConfirmar={() => void confirmarExclusao()}
        aoCancelar={() => setExcluir(null)}
      />
    </div>
  )
}
