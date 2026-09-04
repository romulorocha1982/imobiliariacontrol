import { useCallback, useEffect, useMemo, useState } from 'react'
import { Plus, Search, Users, Pencil, Trash2, Phone, Mail } from 'lucide-react'
import { supabase } from '@/lib/supabase'
import { useAuth } from '@/contexts/AuthContext'
import { useToast } from '@/contexts/ToastContext'
import { Modal, Campo, Confirmar, Vazio, SkeletonTabela, BadgeCliente } from '@/components/ui'
import { Anexos } from '@/components/Anexos'
import {
  mascaraCpfCnpj, mascaraTelefone, mascaraCep, validarCpfCnpj, moeda, data,
} from '@/lib/format'
import { LABEL_TIPO_CLIENTE, UF_LISTA, type Cliente, type ClienteTipo } from '@/lib/types'

type Form = Partial<Cliente>

const FORM_VAZIO: Form = { nome: '', tipo: 'interessado', ativo: true }

export default function Clientes() {
  const { pode, comTenant } = useAuth()
  const { ok, erro: toastErro } = useToast()

  const [lista, setLista] = useState<Cliente[]>([])
  const [carregando, setCarregando] = useState(true)
  const [busca, setBusca] = useState('')
  const [fTipo, setFTipo] = useState<'' | ClienteTipo>('')

  const [modal, setModal] = useState(false)
  const [editando, setEditando] = useState<Cliente | null>(null)
  const [form, setForm] = useState<Form>(FORM_VAZIO)
  const [salvando, setSalvando] = useState(false)
  const [erros, setErros] = useState<Record<string, string>>({})
  const [excluir, setExcluir] = useState<Cliente | null>(null)
  const [excluindo, setExcluindo] = useState(false)

  /** Aba do modal. Anexos precisam do id, entao so existem na edicao. */
  const [aba, setAba] = useState<'dados' | 'anexos'>('dados')

  const podeEditar = pode('admin', 'gerente', 'corretor')

  const carregar = useCallback(async () => {
    setCarregando(true)
    const { data: linhas, error } = await supabase
      .from('clientes')
      .select('*')
      .order('nome')
    if (error) toastErro('Erro ao carregar clientes', error.message)
    else setLista((linhas ?? []) as Cliente[])
    setCarregando(false)
  }, [toastErro])

  useEffect(() => { void carregar() }, [carregar])

  const filtrados = useMemo(() => {
    const q = busca.trim().toLowerCase()
    return lista.filter((c) => {
      if (fTipo && c.tipo !== fTipo) return false
      if (!q) return true
      return [c.nome, c.cpf_cnpj, c.email, c.telefone, c.cidade]
        .filter(Boolean)
        .some((x) => String(x).toLowerCase().includes(q))
    })
  }, [lista, busca, fTipo])

  function abrirNovo() {
    setEditando(null)
    setForm(FORM_VAZIO)
    setErros({})
    setAba('dados')
    setModal(true)
  }

  function abrirEdicao(c: Cliente) {
    setEditando(c)
    setForm({ ...c })
    setErros({})
    setAba('dados')
    setModal(true)
  }

  function validar(): boolean {
    const e: Record<string, string> = {}
    if (!form.nome?.trim()) e.nome = 'Informe o nome.'
    if (form.cpf_cnpj && !validarCpfCnpj(form.cpf_cnpj)) e.cpf_cnpj = 'CPF ou CNPJ invalido.'
    if (form.email && !/^[^\s@]+@[^\s@]+\.[^\s@]+$/.test(form.email)) e.email = 'E-mail invalido.'
    setErros(e)
    return Object.keys(e).length === 0
  }

  async function salvar() {
    if (!validar()) return
    setSalvando(true)

    const payload = { ...form }
    delete (payload as Record<string, unknown>).created_at
    delete (payload as Record<string, unknown>).updated_at
    if (!editando) delete (payload as Record<string, unknown>).id

    const resposta = editando
      ? await supabase.from('clientes').update(payload).eq('id', editando.id)
      : await supabase.from('clientes').insert(comTenant(payload))

    setSalvando(false)
    if (resposta.error) return toastErro('Nao foi possivel salvar', resposta.error.message)

    ok(editando ? 'Cliente atualizado' : 'Cliente cadastrado')
    setModal(false)
    void carregar()
  }

  async function confirmarExclusao() {
    if (!excluir) return
    setExcluindo(true)
    const { error } = await supabase.from('clientes').delete().eq('id', excluir.id)
    setExcluindo(false)
    if (error) {
      const vinculado = error.message.includes('violates foreign key')
      return toastErro(
        'Nao foi possivel excluir',
        vinculado
          ? 'Este cliente tem contrato vinculado. Encerre o contrato antes de excluir.'
          : error.message,
      )
    }
    ok('Cliente excluido')
    setExcluir(null)
    void carregar()
  }

  const set = <K extends keyof Form>(c: K, v: Form[K]) => setForm((f) => ({ ...f, [c]: v }))

  return (
    <div>
      <div className="barra">
        <div className="busca">
          <Search size={15} />
          <input
            className="input"
            placeholder="Buscar por nome, CPF, telefone..."
            value={busca}
            onChange={(e) => setBusca(e.target.value)}
          />
        </div>

        <select className="select" value={fTipo} onChange={(e) => setFTipo(e.target.value as ClienteTipo | '')}>
          <option value="">Todos os tipos</option>
          {Object.entries(LABEL_TIPO_CLIENTE).map(([v, l]) => (
            <option key={v} value={v}>{l}</option>
          ))}
        </select>

        <div className="barra__dir">
          <span className="contador">{filtrados.length} de {lista.length}</span>
          {podeEditar && (
            <button className="btn btn--primario" onClick={abrirNovo}>
              <Plus size={16} /> Novo cliente
            </button>
          )}
        </div>
      </div>

      {carregando ? (
        <SkeletonTabela linhas={5} colunas={5} />
      ) : filtrados.length === 0 ? (
        <div className="card">
          <Vazio
            icone={<Users size={24} />}
            titulo={lista.length === 0 ? 'Nenhum cliente cadastrado' : 'Nada encontrado'}
            texto={
              lista.length === 0
                ? 'Cadastre inquilinos, compradores e interessados aqui.'
                : 'Tente outro termo ou limpe os filtros.'
            }
            acao={
              podeEditar && lista.length === 0 ? (
                <button className="btn btn--primario" onClick={abrirNovo}>
                  <Plus size={16} /> Cadastrar cliente
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
                <th>Nome</th>
                <th>Tipo</th>
                <th>CPF / CNPJ</th>
                <th>Contato</th>
                <th>Cidade</th>
                <th className="num">Renda</th>
                {podeEditar && <th className="acoes">Acoes</th>}
              </tr>
            </thead>
            <tbody>
              {filtrados.map((c) => (
                <tr key={c.id}>
                  <td>
                    <div className="celula-forte">{c.nome}</div>
                    {c.profissao && <div className="celula-fraca">{c.profissao}</div>}
                  </td>
                  <td><BadgeCliente tipo={c.tipo} /></td>
                  <td className="t-num">{c.cpf_cnpj || <span className="t-3">-</span>}</td>
                  <td>
                    {c.telefone && (
                      <div className="linha t-sm" style={{ gap: 5 }}>
                        <Phone size={12} className="t-3" /> {c.telefone}
                      </div>
                    )}
                    {c.email && (
                      <div className="linha celula-fraca" style={{ gap: 5 }}>
                        <Mail size={12} /> {c.email}
                      </div>
                    )}
                    {!c.telefone && !c.email && <span className="t-3">-</span>}
                  </td>
                  <td>{[c.cidade, c.estado].filter(Boolean).join(' - ') || <span className="t-3">-</span>}</td>
                  <td className="num">{c.renda ? moeda(c.renda) : <span className="t-3">-</span>}</td>
                  {podeEditar && (
                    <td className="acoes">
                      <button className="btn btn--fantasma btn--sm" onClick={() => abrirEdicao(c)}>
                        <Pencil size={13} />
                      </button>
                      <button className="btn btn--fantasma btn--sm" onClick={() => setExcluir(c)}>
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
        titulo={editando ? 'Editar cliente' : 'Novo cliente'}
        subtitulo={editando ? `Cadastrado em ${data(editando.created_at)}` : undefined}
        tamanho="lg"
        rodape={
          <>
            <button className="btn btn--secundario" onClick={() => setModal(false)} disabled={salvando}>
              {aba === 'dados' ? 'Cancelar' : 'Fechar'}
            </button>
            {aba === 'dados' && (
              <button className="btn btn--primario" onClick={() => void salvar()} disabled={salvando}>
                {salvando && <span className="spin spin--sm spin--claro" />}
                {editando ? 'Salvar' : 'Cadastrar'}
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
              Documentos
            </button>
          </div>
        )}

        {editando && aba === 'anexos' && (
          <div className="form-grade">
            <Anexos escopo="clientes" registroId={editando.id} tipoPadrao="identidade" />
          </div>
        )}

        <div className="form-grade" hidden={aba !== 'dados'}>
          <div className="form-secao">Dados pessoais</div>

          <Campo rotulo="Nome completo" obrigatorio erro={erros.nome} className="col-8">
            <input
              className={`input ${erros.nome ? 'input--erro' : ''}`}
              value={form.nome ?? ''}
              onChange={(e) => set('nome', e.target.value)}
            />
          </Campo>

          <Campo rotulo="Tipo" className="col-4">
            <select className="select" value={form.tipo} onChange={(e) => set('tipo', e.target.value as ClienteTipo)}>
              {Object.entries(LABEL_TIPO_CLIENTE).map(([v, l]) => (
                <option key={v} value={v}>{l}</option>
              ))}
            </select>
          </Campo>

          <Campo rotulo="CPF / CNPJ" erro={erros.cpf_cnpj} className="col-4">
            <input
              className={`input ${erros.cpf_cnpj ? 'input--erro' : ''}`}
              value={form.cpf_cnpj ?? ''}
              onChange={(e) => set('cpf_cnpj', mascaraCpfCnpj(e.target.value))}
              inputMode="numeric"
            />
          </Campo>

          <Campo rotulo="RG" className="col-4">
            <input className="input" value={form.rg ?? ''} onChange={(e) => set('rg', e.target.value)} />
          </Campo>

          <Campo rotulo="Nascimento" className="col-4">
            <input
              className="input"
              type="date"
              value={form.data_nascimento ?? ''}
              onChange={(e) => set('data_nascimento', e.target.value || null)}
            />
          </Campo>

          <Campo rotulo="Telefone" className="col-4">
            <input
              className="input"
              value={form.telefone ?? ''}
              onChange={(e) => set('telefone', mascaraTelefone(e.target.value))}
              inputMode="tel"
            />
          </Campo>

          <Campo rotulo="Telefone 2" className="col-4">
            <input
              className="input"
              value={form.telefone2 ?? ''}
              onChange={(e) => set('telefone2', mascaraTelefone(e.target.value))}
              inputMode="tel"
            />
          </Campo>

          <Campo rotulo="E-mail" erro={erros.email} className="col-4">
            <input
              className={`input ${erros.email ? 'input--erro' : ''}`}
              type="email"
              value={form.email ?? ''}
              onChange={(e) => set('email', e.target.value)}
            />
          </Campo>

          <div className="form-secao">Perfil financeiro</div>

          <Campo rotulo="Profissao" className="col-4">
            <input className="input" value={form.profissao ?? ''} onChange={(e) => set('profissao', e.target.value)} />
          </Campo>

          <Campo rotulo="Estado civil" className="col-4">
            <select
              className="select"
              value={form.estado_civil ?? ''}
              onChange={(e) => set('estado_civil', e.target.value)}
            >
              <option value="">--</option>
              <option value="solteiro">Solteiro(a)</option>
              <option value="casado">Casado(a)</option>
              <option value="divorciado">Divorciado(a)</option>
              <option value="viuvo">Viuvo(a)</option>
              <option value="uniao_estavel">Uniao estavel</option>
            </select>
          </Campo>

          <Campo rotulo="Renda mensal (R$)" className="col-4" dica="Usado na analise de locacao.">
            <input
              className="input"
              type="number"
              step="0.01"
              value={form.renda ?? ''}
              onChange={(e) => set('renda', e.target.value === '' ? null : Number(e.target.value))}
            />
          </Campo>

          <div className="form-secao">Endereco</div>

          <Campo rotulo="CEP" className="col-2">
            <input
              className="input"
              value={form.cep ?? ''}
              onChange={(e) => set('cep', mascaraCep(e.target.value))}
              inputMode="numeric"
            />
          </Campo>

          <Campo rotulo="Logradouro" className="col-6">
            <input className="input" value={form.logradouro ?? ''} onChange={(e) => set('logradouro', e.target.value)} />
          </Campo>

          <Campo rotulo="Numero" className="col-2">
            <input className="input" value={form.numero ?? ''} onChange={(e) => set('numero', e.target.value)} />
          </Campo>

          <Campo rotulo="Complemento" className="col-2">
            <input className="input" value={form.complemento ?? ''} onChange={(e) => set('complemento', e.target.value)} />
          </Campo>

          <Campo rotulo="Bairro" className="col-4">
            <input className="input" value={form.bairro ?? ''} onChange={(e) => set('bairro', e.target.value)} />
          </Campo>

          <Campo rotulo="Cidade" className="col-4">
            <input className="input" value={form.cidade ?? ''} onChange={(e) => set('cidade', e.target.value)} />
          </Campo>

          <Campo rotulo="UF" className="col-2">
            <select className="select" value={form.estado ?? ''} onChange={(e) => set('estado', e.target.value)}>
              <option value="">--</option>
              {UF_LISTA.map((uf) => <option key={uf} value={uf}>{uf}</option>)}
            </select>
          </Campo>

          <Campo rotulo="Observacoes" className="col-12">
            <textarea
              className="textarea"
              value={form.observacoes ?? ''}
              onChange={(e) => set('observacoes', e.target.value)}
              placeholder="Preferencias, historico de atendimento, restricoes..."
            />
          </Campo>

          <div className="col-12">
            <label className="check">
              <input
                type="checkbox"
                checked={form.ativo ?? true}
                onChange={(e) => set('ativo', e.target.checked)}
              />
              <span>Cliente ativo</span>
            </label>
          </div>
        </div>
      </Modal>

      <Confirmar
        aberto={Boolean(excluir)}
        titulo="Excluir cliente"
        mensagem={`Excluir ${excluir?.nome} permanentemente? Esta acao nao pode ser desfeita.`}
        textoConfirmar="Excluir"
        perigo
        processando={excluindo}
        aoConfirmar={() => void confirmarExclusao()}
        aoCancelar={() => setExcluir(null)}
      />
    </div>
  )
}
