import { useCallback, useEffect, useMemo, useState } from 'react'
import { Search, ShieldCheck, Pencil, Info, UserCheck, UserX } from 'lucide-react'
import { supabase } from '@/lib/supabase'
import { useAuth } from '@/contexts/AuthContext'
import { useToast } from '@/contexts/ToastContext'
import { Modal, Campo, Vazio, SkeletonTabela } from '@/components/ui'
import { data, iniciais, mascaraTelefone } from '@/lib/format'
import { LABEL_CARGO, type Profile, type UserRole } from '@/lib/types'

const DESCRICAO_CARGO: Record<UserRole, string> = {
  admin: 'Acesso total, inclusive usuarios e auditoria.',
  gerente: 'Tudo operacional e financeiro, sem gerenciar usuarios.',
  financeiro: 'Le tudo; escreve contratos e financeiro.',
  corretor: 'Le tudo; escreve imoveis, clientes e CRM. Nao mexe no financeiro.',
}

const COR_CARGO: Record<UserRole, string> = {
  admin: 'erro',
  gerente: 'primaria',
  financeiro: 'ok',
  corretor: 'info',
}

export default function Usuarios() {
  const { perfil, recarregarPerfil } = useAuth()
  const { ok, erro: toastErro } = useToast()

  const [lista, setLista] = useState<Profile[]>([])
  const [carregando, setCarregando] = useState(true)
  const [busca, setBusca] = useState('')

  const [editando, setEditando] = useState<Profile | null>(null)
  const [cargo, setCargo] = useState<UserRole>('corretor')
  const [nome, setNome] = useState('')
  const [telefone, setTelefone] = useState('')
  const [creci, setCreci] = useState('')
  const [ativo, setAtivo] = useState(true)
  const [salvando, setSalvando] = useState(false)

  const carregar = useCallback(async () => {
    setCarregando(true)
    const { data: linhas, error } = await supabase
      .from('profiles')
      .select('*')
      .order('created_at')
    if (error) toastErro('Erro ao carregar usuarios', error.message)
    else setLista((linhas ?? []) as Profile[])
    setCarregando(false)
  }, [toastErro])

  useEffect(() => { void carregar() }, [carregar])

  const filtrados = useMemo(() => {
    const q = busca.trim().toLowerCase()
    if (!q) return lista
    return lista.filter((u) =>
      [u.nome, u.email, u.creci].filter(Boolean).some((x) => String(x).toLowerCase().includes(q)),
    )
  }, [lista, busca])

  function abrirEdicao(u: Profile) {
    setEditando(u)
    setCargo(u.cargo)
    setNome(u.nome)
    setTelefone(u.telefone ?? '')
    setCreci(u.creci ?? '')
    setAtivo(u.ativo)
  }

  const souEu = editando?.id === perfil?.id
  const admins = lista.filter((u) => u.cargo === 'admin' && u.ativo)
  const ultimoAdmin =
    editando?.cargo === 'admin' && admins.length <= 1 && (cargo !== 'admin' || !ativo)

  async function salvar() {
    if (!editando) return
    if (!nome.trim()) return toastErro('Informe o nome')
    if (ultimoAdmin) {
      return toastErro(
        'Operacao bloqueada',
        'Este e o unico administrador ativo. Promova outro usuario a admin antes de alterar este.',
      )
    }

    setSalvando(true)
    const { error } = await supabase
      .from('profiles')
      .update({
        nome: nome.trim(),
        cargo,
        ativo,
        telefone: telefone || null,
        creci: creci || null,
      })
      .eq('id', editando.id)
    setSalvando(false)

    if (error) return toastErro('Nao foi possivel salvar', error.message)

    ok('Usuario atualizado')
    setEditando(null)
    void carregar()
    if (souEu) void recarregarPerfil()
  }

  async function alternarAtivo(u: Profile) {
    if (u.id === perfil?.id) {
      return toastErro('Voce nao pode desativar a si mesmo')
    }
    if (u.cargo === 'admin' && u.ativo && admins.length <= 1) {
      return toastErro('Operacao bloqueada', 'Nao e possivel desativar o unico administrador ativo.')
    }

    const { error } = await supabase
      .from('profiles')
      .update({ ativo: !u.ativo })
      .eq('id', u.id)

    if (error) return toastErro('Nao foi possivel alterar', error.message)
    ok(u.ativo ? 'Usuario desativado' : 'Usuario reativado')
    void carregar()
  }

  return (
    <div>
      <div className="aviso aviso--info mb-3">
        <Info size={16} />
        <div>
          <strong>Como adicionar alguem a equipe</strong>
          <div className="t-sm mt-0">
            A pessoa cria a propria conta pela tela de login (&quot;Criar agora&quot;) e entra como{' '}
            <strong>Corretor</strong>. Depois voce ajusta o cargo aqui. Isso mantem a senha
            conhecida so pelo dono da conta &mdash; ninguem, nem voce, precisa saber a senha dela.
          </div>
        </div>
      </div>

      <div className="barra">
        <div className="busca">
          <Search size={15} />
          <input
            className="input"
            placeholder="Buscar por nome, e-mail ou CRECI..."
            value={busca}
            onChange={(e) => setBusca(e.target.value)}
          />
        </div>
        <div className="barra__dir">
          <span className="contador">
            {lista.filter((u) => u.ativo).length} ativo(s) de {lista.length}
          </span>
        </div>
      </div>

      {carregando ? (
        <SkeletonTabela linhas={4} colunas={5} />
      ) : filtrados.length === 0 ? (
        <div className="card">
          <Vazio icone={<ShieldCheck size={24} />} titulo="Nenhum usuario encontrado" />
        </div>
      ) : (
        <div className="tabela-wrap">
          <table className="tabela">
            <thead>
              <tr>
                <th>Usuario</th>
                <th>Cargo</th>
                <th>CRECI</th>
                <th>Cadastro</th>
                <th>Situacao</th>
                <th className="acoes">Acoes</th>
              </tr>
            </thead>
            <tbody>
              {filtrados.map((u) => (
                <tr key={u.id}>
                  <td>
                    <div className="linha" style={{ gap: 10 }}>
                      <div className="nav__avatar" style={{ width: 32, height: 32, fontSize: 11 }}>
                        {iniciais(u.nome)}
                      </div>
                      <div>
                        <div className="celula-forte">
                          {u.nome}
                          {u.id === perfil?.id && <span className="chip" style={{ marginLeft: 6 }}>voce</span>}
                        </div>
                        <div className="celula-fraca">{u.email}</div>
                      </div>
                    </div>
                  </td>
                  <td>
                    <span className={`badge badge--${COR_CARGO[u.cargo]}`}>{LABEL_CARGO[u.cargo]}</span>
                  </td>
                  <td className="t-sm">{u.creci || <span className="t-3">-</span>}</td>
                  <td className="t-sm">{data(u.created_at)}</td>
                  <td>
                    {u.ativo ? (
                      <span className="badge badge--ok"><i className="ponto" /> Ativo</span>
                    ) : (
                      <span className="badge badge--neutro"><i className="ponto" /> Desativado</span>
                    )}
                  </td>
                  <td className="acoes">
                    <button className="btn btn--fantasma btn--sm" onClick={() => abrirEdicao(u)} title="Editar">
                      <Pencil size={13} />
                    </button>
                    <button
                      className="btn btn--fantasma btn--sm"
                      onClick={() => void alternarAtivo(u)}
                      title={u.ativo ? 'Desativar acesso' : 'Reativar acesso'}
                      disabled={u.id === perfil?.id}
                    >
                      {u.ativo
                        ? <UserX size={14} color="var(--erro)" />
                        : <UserCheck size={14} color="var(--ok)" />}
                    </button>
                  </td>
                </tr>
              ))}
            </tbody>
          </table>
        </div>
      )}

      <Modal
        aberto={Boolean(editando)}
        aoFechar={() => setEditando(null)}
        titulo="Editar usuario"
        subtitulo={editando?.email ?? undefined}
        tamanho="md"
        rodape={
          <>
            <button className="btn btn--secundario" onClick={() => setEditando(null)} disabled={salvando}>
              Cancelar
            </button>
            <button
              className="btn btn--primario"
              onClick={() => void salvar()}
              disabled={salvando || ultimoAdmin}
            >
              {salvando && <span className="spin spin--sm spin--claro" />}
              Salvar
            </button>
          </>
        }
      >
        <div className="form-grade">
          <Campo rotulo="Nome" obrigatorio className="col-12">
            <input className="input" value={nome} onChange={(e) => setNome(e.target.value)} />
          </Campo>

          <Campo rotulo="Telefone" className="col-6">
            <input
              className="input"
              value={telefone}
              onChange={(e) => setTelefone(mascaraTelefone(e.target.value))}
              inputMode="tel"
            />
          </Campo>

          <Campo rotulo="CRECI" className="col-6">
            <input className="input" value={creci} onChange={(e) => setCreci(e.target.value)} />
          </Campo>

          <Campo rotulo="Cargo" className="col-12" dica={DESCRICAO_CARGO[cargo]}>
            <select className="select" value={cargo} onChange={(e) => setCargo(e.target.value as UserRole)}>
              {Object.entries(LABEL_CARGO).map(([v, l]) => (
                <option key={v} value={v}>{l}</option>
              ))}
            </select>
          </Campo>

          <div className="col-12">
            <label className="check">
              <input
                type="checkbox"
                checked={ativo}
                onChange={(e) => setAtivo(e.target.checked)}
                disabled={souEu}
              />
              <span>Acesso ativo{souEu && ' (voce nao pode desativar a si mesmo)'}</span>
            </label>
          </div>

          {ultimoAdmin && (
            <div className="col-12">
              <div className="aviso aviso--erro">
                <Info size={16} />
                <span>
                  Este e o unico administrador ativo do sistema. Promova outra pessoa a
                  administrador antes de rebaixar ou desativar esta conta &mdash; caso contrario
                  ninguem conseguiria gerenciar usuarios.
                </span>
              </div>
            </div>
          )}
        </div>
      </Modal>
    </div>
  )
}
