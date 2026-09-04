import { useCallback, useEffect, useMemo, useState } from 'react'
import {
  Search, ShieldCheck, Pencil, Info, UserCheck, UserX, UserPlus,
  KeyRound, Copy, Check, RefreshCw,
} from 'lucide-react'
import { supabase } from '@/lib/supabase'
import { useAuth } from '@/contexts/AuthContext'
import { useToast } from '@/contexts/ToastContext'
import { Modal, Campo, Vazio, SkeletonTabela } from '@/components/ui'
import { data, iniciais, mascaraTelefone } from '@/lib/format'
import { chamarGestaoContas, gerarSenha, copiar } from '@/lib/gestaoContas'
import { LABEL_CARGO, CARGOS_EQUIPE, type Profile, type UserRole } from '@/lib/types'

const DESCRICAO_CARGO: Record<UserRole, string> = {
  admin: 'Acesso total, inclusive usuarios e auditoria.',
  gerente: 'Tudo operacional e financeiro, sem gerenciar usuarios.',
  financeiro: 'Le tudo; escreve contratos e financeiro.',
  corretor: 'Le tudo; escreve imoveis, clientes e CRM. Nao mexe no financeiro.',
  super_admin: 'Administra a plataforma. Nao aparece dentro de uma imobiliaria.',
}

const COR_CARGO: Record<UserRole, string> = {
  admin: 'erro',
  gerente: 'primaria',
  financeiro: 'ok',
  corretor: 'info',
  super_admin: 'acento',
}

const SENHA_MINIMA = 8

/** Bloco copiavel com o que o admin precisa entregar a pessoa. */
function Credenciais({
  email, senha, codigo,
}: { email: string; senha: string; codigo: string }) {
  const [copiado, setCopiado] = useState(false)
  const texto =
    `Imobiliaria Control\n` +
    `Site: ${window.location.origin}\n` +
    `E-mail: ${email}\n` +
    `Senha: ${senha}\n` +
    `Codigo da imobiliaria: ${codigo}`

  return (
    <div className="aviso aviso--ok" style={{ alignItems: 'flex-start' }}>
      <Check size={16} />
      <div style={{ flex: 1, minWidth: 0 }}>
        <strong>Acesso criado. Entregue estes dados a pessoa:</strong>
        <pre
          className="codigo"
          style={{
            whiteSpace: 'pre-wrap', wordBreak: 'break-all',
            margin: '8px 0 0', padding: 10, lineHeight: 1.7,
          }}
        >
          {texto}
        </pre>
        <button
          className="btn btn--secundario btn--sm mt-2"
          onClick={async () => {
            setCopiado(await copiar(texto))
          }}
        >
          {copiado ? <Check size={13} /> : <Copy size={13} />}
          {copiado ? 'Copiado' : 'Copiar tudo'}
        </button>
        <div className="t-sm t-3 mt-2">
          A senha nao aparece de novo depois que voce fechar esta janela. Se perder,
          use &quot;Redefinir senha&quot;.
        </div>
      </div>
    </div>
  )
}

export default function Usuarios() {
  const { perfil, imobiliaria, recarregarPerfil } = useAuth()
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

  // criacao de usuario
  const [criando, setCriando] = useState(false)
  const [novo, setNovo] = useState({
    nome: '', email: '', telefone: '', creci: '',
    cargo: 'corretor' as UserRole, senha: '',
  })
  const [criado, setCriado] = useState<{ email: string; senha: string } | null>(null)

  // redefinicao de senha
  const [redefinindo, setRedefinindo] = useState<Profile | null>(null)
  const [novaSenha, setNovaSenha] = useState('')

  const carregar = useCallback(async () => {
    setCarregando(true)
    // A RLS ja devolve apenas os usuarios desta imobiliaria.
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

  function abrirCriacao() {
    setNovo({ nome: '', email: '', telefone: '', creci: '', cargo: 'corretor', senha: gerarSenha() })
    setCriado(null)
    setCriando(true)
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

  async function criar() {
    if (novo.nome.trim().length < 3) return toastErro('Informe o nome completo')
    if (!novo.email.trim()) return toastErro('Informe o e-mail')
    if (novo.senha.length < SENHA_MINIMA) {
      return toastErro(`A senha precisa ter no minimo ${SENHA_MINIMA} caracteres`)
    }

    setSalvando(true)
    const { erro } = await chamarGestaoContas({
      acao: 'criar_usuario',
      nome: novo.nome.trim(),
      email: novo.email.trim(),
      senha: novo.senha,
      telefone: novo.telefone || null,
      creci: novo.creci || null,
      cargo: novo.cargo,
    })
    setSalvando(false)

    if (erro) return toastErro('Nao foi possivel criar o usuario', erro)

    setCriado({ email: novo.email.trim().toLowerCase(), senha: novo.senha })
    ok('Usuario criado')
    void carregar()
  }

  async function redefinir() {
    if (!redefinindo) return
    if (novaSenha.length < SENHA_MINIMA) {
      return toastErro(`A senha precisa ter no minimo ${SENHA_MINIMA} caracteres`)
    }

    setSalvando(true)
    const { erro } = await chamarGestaoContas({
      acao: 'redefinir_senha',
      usuario_id: redefinindo.id,
      senha: novaSenha,
    })
    setSalvando(false)

    if (erro) return toastErro('Nao foi possivel redefinir', erro)

    setCriado({ email: redefinindo.email ?? '', senha: novaSenha })
    setRedefinindo(null)
    ok('Senha redefinida')
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
            Clique em <strong>Novo usuario</strong>, defina o cargo e uma senha inicial. Depois
            entregue a pessoa o e-mail, a senha e o <strong>codigo da imobiliaria</strong>
            {imobiliaria && <> (<strong>{imobiliaria.codigo}</strong>)</>} &mdash; os tres sao
            pedidos na tela de login. Oriente a trocar a senha no primeiro acesso.
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
          <button className="btn btn--primario" onClick={abrirCriacao}>
            <UserPlus size={15} />
            Novo usuario
          </button>
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
                      onClick={() => { setRedefinindo(u); setNovaSenha(gerarSenha()); setCriado(null) }}
                      title="Redefinir senha"
                    >
                      <KeyRound size={13} />
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

      {/* --------------------------------------------------- novo usuario -- */}
      <Modal
        aberto={criando}
        aoFechar={() => setCriando(false)}
        titulo="Novo usuario"
        subtitulo={imobiliaria?.nome}
        tamanho="md"
        rodape={
          criado ? (
            <button className="btn btn--primario" onClick={() => setCriando(false)}>
              Concluir
            </button>
          ) : (
            <>
              <button className="btn btn--secundario" onClick={() => setCriando(false)} disabled={salvando}>
                Cancelar
              </button>
              <button className="btn btn--primario" onClick={() => void criar()} disabled={salvando}>
                {salvando && <span className="spin spin--sm spin--claro" />}
                Criar acesso
              </button>
            </>
          )
        }
      >
        {criado ? (
          <Credenciais
            email={criado.email}
            senha={criado.senha}
            codigo={imobiliaria?.codigo ?? ''}
          />
        ) : (
          <div className="form-grade">
            <Campo rotulo="Nome completo" obrigatorio className="col-12">
              <input
                className="input"
                value={novo.nome}
                onChange={(e) => setNovo({ ...novo, nome: e.target.value })}
                placeholder="Maria Silva"
              />
            </Campo>

            <Campo rotulo="E-mail" obrigatorio className="col-12"
              dica="Sera o login da pessoa. Precisa ser um e-mail ainda nao usado no sistema.">
              <input
                className="input"
                type="email"
                value={novo.email}
                onChange={(e) => setNovo({ ...novo, email: e.target.value })}
                placeholder="maria@imobiliaria.com.br"
              />
            </Campo>

            <Campo rotulo="Telefone" className="col-6">
              <input
                className="input"
                value={novo.telefone}
                onChange={(e) => setNovo({ ...novo, telefone: mascaraTelefone(e.target.value) })}
                inputMode="tel"
              />
            </Campo>

            <Campo rotulo="CRECI" className="col-6">
              <input
                className="input"
                value={novo.creci}
                onChange={(e) => setNovo({ ...novo, creci: e.target.value })}
              />
            </Campo>

            <Campo rotulo="Cargo" className="col-12" dica={DESCRICAO_CARGO[novo.cargo]}>
              <select
                className="select"
                value={novo.cargo}
                onChange={(e) => setNovo({ ...novo, cargo: e.target.value as UserRole })}
              >
                {CARGOS_EQUIPE.map((c) => (
                  <option key={c} value={c}>{LABEL_CARGO[c]}</option>
                ))}
              </select>
            </Campo>

            <Campo
              rotulo="Senha inicial"
              obrigatorio
              className="col-12"
              dica={`Minimo de ${SENHA_MINIMA} caracteres. A pessoa deve troca-la no primeiro acesso.`}
            >
              <div className="linha" style={{ gap: 8 }}>
                <input
                  className="input"
                  value={novo.senha}
                  onChange={(e) => setNovo({ ...novo, senha: e.target.value })}
                  style={{ fontFamily: 'var(--fonte-mono, monospace)' }}
                />
                <button
                  type="button"
                  className="btn btn--secundario btn--sm"
                  onClick={() => setNovo({ ...novo, senha: gerarSenha() })}
                  title="Gerar outra senha"
                >
                  <RefreshCw size={13} />
                </button>
              </div>
            </Campo>
          </div>
        )}
      </Modal>

      {/* ----------------------------------------------- redefinir senha -- */}
      <Modal
        aberto={Boolean(redefinindo)}
        aoFechar={() => setRedefinindo(null)}
        titulo="Redefinir senha"
        subtitulo={redefinindo?.nome}
        tamanho="sm"
        rodape={
          <>
            <button className="btn btn--secundario" onClick={() => setRedefinindo(null)} disabled={salvando}>
              Cancelar
            </button>
            <button className="btn btn--primario" onClick={() => void redefinir()} disabled={salvando}>
              {salvando && <span className="spin spin--sm spin--claro" />}
              Redefinir
            </button>
          </>
        }
      >
        <Campo rotulo="Nova senha" obrigatorio dica={`Minimo de ${SENHA_MINIMA} caracteres.`}>
          <div className="linha" style={{ gap: 8 }}>
            <input
              className="input"
              value={novaSenha}
              onChange={(e) => setNovaSenha(e.target.value)}
              style={{ fontFamily: 'var(--fonte-mono, monospace)' }}
            />
            <button
              type="button"
              className="btn btn--secundario btn--sm"
              onClick={() => setNovaSenha(gerarSenha())}
              title="Gerar outra senha"
            >
              <RefreshCw size={13} />
            </button>
          </div>
        </Campo>
      </Modal>

      {/* Confirmacao da senha redefinida, fora do modal que a originou */}
      <Modal
        aberto={Boolean(criado) && !criando}
        aoFechar={() => setCriado(null)}
        titulo="Senha redefinida"
        tamanho="md"
        rodape={
          <button className="btn btn--primario" onClick={() => setCriado(null)}>Concluir</button>
        }
      >
        {criado && (
          <Credenciais
            email={criado.email}
            senha={criado.senha}
            codigo={imobiliaria?.codigo ?? ''}
          />
        )}
      </Modal>

      {/* ------------------------------------------------ editar usuario -- */}
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

          <Campo
            rotulo="Cargo"
            className="col-12"
            dica={souEu ? 'Voce nao pode alterar o proprio cargo.' : DESCRICAO_CARGO[cargo]}
          >
            <select
              className="select"
              value={cargo}
              onChange={(e) => setCargo(e.target.value as UserRole)}
              disabled={souEu}
            >
              {CARGOS_EQUIPE.map((c) => (
                <option key={c} value={c}>{LABEL_CARGO[c]}</option>
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
                  Este e o unico administrador ativo da imobiliaria. Promova outra pessoa a
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
