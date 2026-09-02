import { useCallback, useEffect, useMemo, useState } from 'react'
import { Plus, Search, UserRound, Pencil, Trash2, Phone, Mail, Landmark } from 'lucide-react'
import { supabase } from '@/lib/supabase'
import { useAuth } from '@/contexts/AuthContext'
import { useToast } from '@/contexts/ToastContext'
import { Modal, Campo, Confirmar, Vazio, SkeletonTabela } from '@/components/ui'
import { mascaraCpfCnpj, mascaraTelefone, mascaraCep, validarCpfCnpj } from '@/lib/format'
import { UF_LISTA, type Proprietario } from '@/lib/types'

type Form = Partial<Proprietario>

const FORM_VAZIO: Form = { nome: '', ativo: true }

export default function Proprietarios() {
  const { pode } = useAuth()
  const { ok, erro: toastErro } = useToast()

  const [lista, setLista] = useState<Proprietario[]>([])
  const [contagemImoveis, setContagemImoveis] = useState<Record<string, number>>({})
  const [carregando, setCarregando] = useState(true)
  const [busca, setBusca] = useState('')

  const [modal, setModal] = useState(false)
  const [editando, setEditando] = useState<Proprietario | null>(null)
  const [form, setForm] = useState<Form>(FORM_VAZIO)
  const [salvando, setSalvando] = useState(false)
  const [erros, setErros] = useState<Record<string, string>>({})
  const [excluir, setExcluir] = useState<Proprietario | null>(null)
  const [excluindo, setExcluindo] = useState(false)

  const podeEditar = pode('admin', 'gerente', 'corretor')

  const carregar = useCallback(async () => {
    setCarregando(true)
    const [r1, r2] = await Promise.all([
      supabase.from('proprietarios').select('*').order('nome'),
      supabase.from('imoveis').select('proprietario_id'),
    ])

    if (r1.error) toastErro('Erro ao carregar proprietarios', r1.error.message)
    else setLista((r1.data ?? []) as Proprietario[])

    if (!r2.error && r2.data) {
      const contagem: Record<string, number> = {}
      for (const i of r2.data as { proprietario_id: string | null }[]) {
        if (i.proprietario_id) contagem[i.proprietario_id] = (contagem[i.proprietario_id] ?? 0) + 1
      }
      setContagemImoveis(contagem)
    }
    setCarregando(false)
  }, [toastErro])

  useEffect(() => { void carregar() }, [carregar])

  const filtrados = useMemo(() => {
    const q = busca.trim().toLowerCase()
    if (!q) return lista
    return lista.filter((p) =>
      [p.nome, p.cpf_cnpj, p.email, p.telefone, p.cidade]
        .filter(Boolean)
        .some((c) => String(c).toLowerCase().includes(q)),
    )
  }, [lista, busca])

  function abrirNovo() {
    setEditando(null)
    setForm(FORM_VAZIO)
    setErros({})
    setModal(true)
  }

  function abrirEdicao(p: Proprietario) {
    setEditando(p)
    setForm({ ...p })
    setErros({})
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
      ? await supabase.from('proprietarios').update(payload).eq('id', editando.id)
      : await supabase.from('proprietarios').insert(payload)

    setSalvando(false)
    if (resposta.error) return toastErro('Nao foi possivel salvar', resposta.error.message)

    ok(editando ? 'Proprietario atualizado' : 'Proprietario cadastrado')
    setModal(false)
    void carregar()
  }

  async function confirmarExclusao() {
    if (!excluir) return
    setExcluindo(true)
    const { error } = await supabase.from('proprietarios').delete().eq('id', excluir.id)
    setExcluindo(false)
    if (error) return toastErro('Nao foi possivel excluir', error.message)
    ok('Proprietario excluido')
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
            placeholder="Buscar por nome, CPF/CNPJ, telefone..."
            value={busca}
            onChange={(e) => setBusca(e.target.value)}
          />
        </div>
        <div className="barra__dir">
          <span className="contador">{filtrados.length} de {lista.length}</span>
          {podeEditar && (
            <button className="btn btn--primario" onClick={abrirNovo}>
              <Plus size={16} /> Novo proprietario
            </button>
          )}
        </div>
      </div>

      {carregando ? (
        <SkeletonTabela linhas={5} colunas={5} />
      ) : filtrados.length === 0 ? (
        <div className="card">
          <Vazio
            icone={<UserRound size={24} />}
            titulo={lista.length === 0 ? 'Nenhum proprietario cadastrado' : 'Nada encontrado'}
            texto={
              lista.length === 0
                ? 'Cadastre os donos dos imoveis para vincular contratos e repasses.'
                : 'Tente outro termo de busca.'
            }
            acao={
              podeEditar && lista.length === 0 ? (
                <button className="btn btn--primario" onClick={abrirNovo}>
                  <Plus size={16} /> Cadastrar proprietario
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
                <th>CPF / CNPJ</th>
                <th>Contato</th>
                <th>Cidade</th>
                <th className="num">Imoveis</th>
                <th>Repasse</th>
                {podeEditar && <th className="acoes">Acoes</th>}
              </tr>
            </thead>
            <tbody>
              {filtrados.map((p) => (
                <tr key={p.id}>
                  <td>
                    <div className="celula-forte">{p.nome}</div>
                    {!p.ativo && <span className="badge badge--neutro">Inativo</span>}
                  </td>
                  <td className="t-num">{p.cpf_cnpj || <span className="t-3">-</span>}</td>
                  <td>
                    {p.telefone && (
                      <div className="linha t-sm" style={{ gap: 5 }}>
                        <Phone size={12} className="t-3" /> {p.telefone}
                      </div>
                    )}
                    {p.email && (
                      <div className="linha celula-fraca" style={{ gap: 5 }}>
                        <Mail size={12} /> {p.email}
                      </div>
                    )}
                    {!p.telefone && !p.email && <span className="t-3">-</span>}
                  </td>
                  <td>{[p.cidade, p.estado].filter(Boolean).join(' - ') || <span className="t-3">-</span>}</td>
                  <td className="num">
                    <span className="chip">{contagemImoveis[p.id] ?? 0}</span>
                  </td>
                  <td>
                    {p.pix ? (
                      <span className="badge badge--ok"><Landmark size={11} /> PIX</span>
                    ) : p.banco ? (
                      <span className="badge badge--info">{p.banco}</span>
                    ) : (
                      <span className="t-3 t-sm">Nao informado</span>
                    )}
                  </td>
                  {podeEditar && (
                    <td className="acoes">
                      <button className="btn btn--fantasma btn--sm" onClick={() => abrirEdicao(p)}>
                        <Pencil size={13} />
                      </button>
                      <button className="btn btn--fantasma btn--sm" onClick={() => setExcluir(p)}>
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
        titulo={editando ? 'Editar proprietario' : 'Novo proprietario'}
        subtitulo={editando?.nome}
        tamanho="lg"
        rodape={
          <>
            <button className="btn btn--secundario" onClick={() => setModal(false)} disabled={salvando}>
              Cancelar
            </button>
            <button className="btn btn--primario" onClick={() => void salvar()} disabled={salvando}>
              {salvando && <span className="spin spin--sm spin--claro" />}
              {editando ? 'Salvar' : 'Cadastrar'}
            </button>
          </>
        }
      >
        <div className="form-grade">
          <div className="form-secao">Dados pessoais</div>

          <Campo rotulo="Nome completo / Razao social" obrigatorio erro={erros.nome} className="col-8">
            <input
              className={`input ${erros.nome ? 'input--erro' : ''}`}
              value={form.nome ?? ''}
              onChange={(e) => set('nome', e.target.value)}
            />
          </Campo>

          <Campo rotulo="CPF / CNPJ" erro={erros.cpf_cnpj} className="col-4">
            <input
              className={`input ${erros.cpf_cnpj ? 'input--erro' : ''}`}
              value={form.cpf_cnpj ?? ''}
              onChange={(e) => set('cpf_cnpj', mascaraCpfCnpj(e.target.value))}
              inputMode="numeric"
            />
          </Campo>

          <Campo rotulo="RG / Inscricao estadual" className="col-4">
            <input className="input" value={form.rg ?? ''} onChange={(e) => set('rg', e.target.value)} />
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

          <Campo rotulo="E-mail" erro={erros.email} className="col-12">
            <input
              className={`input ${erros.email ? 'input--erro' : ''}`}
              type="email"
              value={form.email ?? ''}
              onChange={(e) => set('email', e.target.value)}
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

          <div className="form-secao">Dados para repasse do aluguel</div>

          <Campo rotulo="Chave PIX" className="col-6" dica="Forma mais simples de repassar.">
            <input
              className="input"
              value={form.pix ?? ''}
              onChange={(e) => set('pix', e.target.value)}
              placeholder="CPF, e-mail, telefone ou chave aleatoria"
            />
          </Campo>

          <Campo rotulo="Banco" className="col-3">
            <input className="input" value={form.banco ?? ''} onChange={(e) => set('banco', e.target.value)} />
          </Campo>

          <Campo rotulo="Tipo de conta" className="col-3">
            <select
              className="select"
              value={form.tipo_conta ?? ''}
              onChange={(e) => set('tipo_conta', e.target.value)}
            >
              <option value="">--</option>
              <option value="corrente">Corrente</option>
              <option value="poupanca">Poupanca</option>
            </select>
          </Campo>

          <Campo rotulo="Agencia" className="col-3">
            <input className="input" value={form.agencia ?? ''} onChange={(e) => set('agencia', e.target.value)} />
          </Campo>

          <Campo rotulo="Conta" className="col-3">
            <input className="input" value={form.conta ?? ''} onChange={(e) => set('conta', e.target.value)} />
          </Campo>

          <Campo rotulo="Observacoes" className="col-12">
            <textarea
              className="textarea"
              value={form.observacoes ?? ''}
              onChange={(e) => set('observacoes', e.target.value)}
            />
          </Campo>

          <div className="col-12">
            <label className="check">
              <input
                type="checkbox"
                checked={form.ativo ?? true}
                onChange={(e) => set('ativo', e.target.checked)}
              />
              <span>Proprietario ativo</span>
            </label>
          </div>
        </div>
      </Modal>

      <Confirmar
        aberto={Boolean(excluir)}
        titulo="Excluir proprietario"
        mensagem={
          (contagemImoveis[excluir?.id ?? ''] ?? 0) > 0
            ? `${excluir?.nome} possui ${contagemImoveis[excluir?.id ?? '']} imovel(is). Os imoveis ficarao sem proprietario vinculado. Continuar?`
            : `Excluir ${excluir?.nome} permanentemente?`
        }
        textoConfirmar="Excluir"
        perigo
        processando={excluindo}
        aoConfirmar={() => void confirmarExclusao()}
        aoCancelar={() => setExcluir(null)}
      />
    </div>
  )
}
