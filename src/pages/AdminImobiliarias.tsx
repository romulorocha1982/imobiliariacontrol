import { useCallback, useEffect, useMemo, useState } from 'react'
import {
  Plus, Search, Landmark, Pencil, PauseCircle, PlayCircle, UserPlus,
  Copy, Check, RefreshCw, Info, Users, Building2, FileText,
} from 'lucide-react'
import { supabase } from '@/lib/supabase'
import { useToast } from '@/contexts/ToastContext'
import { Modal, Campo, Vazio, SkeletonTabela, Confirmar } from '@/components/ui'
import { data, dataHora, mascaraCpfCnpj, mascaraTelefone, validarCpfCnpj } from '@/lib/format'
import { chamarGestaoContas, gerarSenha, copiar } from '@/lib/gestaoContas'
import { UF_LISTA, type Imobiliaria, type PainelImobiliaria } from '@/lib/types'

/**
 * Area do administrador da plataforma.
 *
 * Aqui NAO existe nenhuma leitura de dado operacional: a listagem vem de
 * painel_imobiliarias(), que devolve so agregados (quantos usuarios, quantos
 * imoveis, quantos contratos ativos). Imoveis, clientes, contratos e financeiro
 * de cada cliente sao invisiveis para este cargo, por RLS - e o compromisso de
 * LGPD que o produto assume.
 */

const SENHA_MINIMA = 8

type FormImobiliaria = Partial<Imobiliaria>
type FormAdmin = { nome: string; email: string; senha: string }

const ADMIN_VAZIO: FormAdmin = { nome: '', email: '', senha: '' }

/** Dados de acesso recem-criados, para o super admin repassar ao cliente. */
function Entrega({
  nome, codigo, email, senha,
}: { nome: string; codigo: string; email: string; senha: string }) {
  const [copiado, setCopiado] = useState(false)
  const texto =
    `Imobiliaria Control - acesso de ${nome}\n` +
    `Site: ${window.location.origin}\n` +
    `E-mail: ${email}\n` +
    `Senha: ${senha}\n` +
    `Codigo da imobiliaria: ${codigo}`

  return (
    <div className="aviso aviso--ok" style={{ alignItems: 'flex-start' }}>
      <Check size={16} />
      <div style={{ flex: 1, minWidth: 0 }}>
        <strong>Conta criada. Entregue estes dados ao cliente:</strong>
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
          onClick={async () => { setCopiado(await copiar(texto)) }}
        >
          {copiado ? <Check size={13} /> : <Copy size={13} />}
          {copiado ? 'Copiado' : 'Copiar tudo'}
        </button>
        <div className="t-sm t-3 mt-2">
          A senha nao aparece de novo depois que voce fechar. O codigo continua
          visivel na lista.
        </div>
      </div>
    </div>
  )
}

export default function AdminImobiliarias() {
  const { ok, erro: toastErro } = useToast()

  const [lista, setLista] = useState<PainelImobiliaria[]>([])
  const [carregando, setCarregando] = useState(true)
  const [busca, setBusca] = useState('')

  // criar imobiliaria
  const [criando, setCriando] = useState(false)
  const [form, setForm] = useState<FormImobiliaria>({})
  const [admin, setAdmin] = useState<FormAdmin>(ADMIN_VAZIO)
  const [erros, setErros] = useState<Record<string, string>>({})
  const [salvando, setSalvando] = useState(false)
  const [entrega, setEntrega] = useState<
    { nome: string; codigo: string; email: string; senha: string } | null
  >(null)

  // editar cadastro
  const [editando, setEditando] = useState<PainelImobiliaria | null>(null)

  // novo administrador para imobiliaria existente
  const [novoAdminDe, setNovoAdminDe] = useState<PainelImobiliaria | null>(null)

  // suspender / reativar
  const [alternando, setAlternando] = useState<PainelImobiliaria | null>(null)
  const [processando, setProcessando] = useState(false)

  const carregar = useCallback(async () => {
    setCarregando(true)
    const { data: linhas, error } = await supabase.rpc('painel_imobiliarias')
    if (error) toastErro('Erro ao carregar imobiliarias', error.message)
    else setLista((linhas ?? []) as PainelImobiliaria[])
    setCarregando(false)
  }, [toastErro])

  useEffect(() => { void carregar() }, [carregar])

  const filtrados = useMemo(() => {
    const q = busca.trim().toLowerCase()
    if (!q) return lista
    return lista.filter((i) =>
      [i.nome, i.razao_social, i.cpf_cnpj, i.codigo, i.cidade, i.email]
        .filter(Boolean)
        .some((c) => String(c).toLowerCase().includes(q)),
    )
  }, [lista, busca])

  function abrirNova() {
    setForm({ plano: 'basico' })
    setAdmin({ ...ADMIN_VAZIO, senha: gerarSenha() })
    setErros({})
    setEntrega(null)
    setCriando(true)
  }

  function validar(comAdmin: boolean): boolean {
    const e: Record<string, string> = {}
    if (!form.nome?.trim() || form.nome.trim().length < 3) e.nome = 'Informe o nome da imobiliaria.'
    if (form.cpf_cnpj && !validarCpfCnpj(form.cpf_cnpj)) e.cpf_cnpj = 'CPF ou CNPJ invalido.'
    if (form.email && !/^[^\s@]+@[^\s@]+\.[^\s@]+$/.test(form.email)) e.email = 'E-mail invalido.'

    if (comAdmin) {
      if (admin.nome.trim().length < 3) e.admin_nome = 'Informe o nome do administrador.'
      if (!/^[^\s@]+@[^\s@]+\.[^\s@]+$/.test(admin.email)) e.admin_email = 'E-mail invalido.'
      if (admin.senha.length < SENHA_MINIMA) {
        e.admin_senha = `Minimo de ${SENHA_MINIMA} caracteres.`
      }
    }
    setErros(e)
    return Object.keys(e).length === 0
  }

  async function criar() {
    if (!validar(true)) return
    setSalvando(true)

    const { dados, erro } = await chamarGestaoContas<{
      imobiliaria_id: string; nome: string; codigo: string; admin_email: string
    }>({
      acao: 'criar_imobiliaria',
      nome: form.nome?.trim(),
      razao_social: form.razao_social ?? null,
      cpf_cnpj: form.cpf_cnpj ?? null,
      email: form.email ?? null,
      telefone: form.telefone ?? null,
      cidade: form.cidade ?? null,
      estado: form.estado ?? null,
      plano: form.plano ?? 'basico',
      admin: { nome: admin.nome.trim(), email: admin.email.trim(), senha: admin.senha },
    })

    setSalvando(false)
    if (erro || !dados) return toastErro('Nao foi possivel criar a imobiliaria', erro)

    setEntrega({
      nome: dados.nome,
      codigo: dados.codigo,
      email: dados.admin_email,
      senha: admin.senha,
    })
    ok('Imobiliaria criada')
    void carregar()
  }

  async function salvarEdicao() {
    if (!editando) return
    if (!validar(false)) return
    setSalvando(true)

    // UPDATE comum: o super admin ja tem essa permissao pela policy
    // imobiliarias_super_update. Nao precisa de Edge Function.
    const { error } = await supabase
      .from('imobiliarias')
      .update({
        nome: form.nome?.trim(),
        razao_social: form.razao_social ?? null,
        cpf_cnpj: form.cpf_cnpj ?? null,
        email: form.email ?? null,
        telefone: form.telefone ?? null,
        cidade: form.cidade ?? null,
        estado: form.estado ?? null,
        plano: form.plano ?? 'basico',
        observacoes: form.observacoes ?? null,
      })
      .eq('id', editando.id)

    setSalvando(false)
    if (error) return toastErro('Nao foi possivel salvar', error.message)

    ok('Cadastro atualizado')
    setEditando(null)
    void carregar()
  }

  async function criarAdmin() {
    if (!novoAdminDe) return
    const e: Record<string, string> = {}
    if (admin.nome.trim().length < 3) e.admin_nome = 'Informe o nome.'
    if (!/^[^\s@]+@[^\s@]+\.[^\s@]+$/.test(admin.email)) e.admin_email = 'E-mail invalido.'
    if (admin.senha.length < SENHA_MINIMA) e.admin_senha = `Minimo de ${SENHA_MINIMA} caracteres.`
    setErros(e)
    if (Object.keys(e).length) return

    setSalvando(true)
    const { erro } = await chamarGestaoContas({
      acao: 'criar_admin',
      imobiliaria_id: novoAdminDe.id,
      nome: admin.nome.trim(),
      email: admin.email.trim(),
      senha: admin.senha,
    })
    setSalvando(false)

    if (erro) return toastErro('Nao foi possivel criar o administrador', erro)

    setEntrega({
      nome: novoAdminDe.nome,
      codigo: novoAdminDe.codigo,
      email: admin.email.trim().toLowerCase(),
      senha: admin.senha,
    })
    setNovoAdminDe(null)
    ok('Administrador criado')
    void carregar()
  }

  async function confirmarSituacao() {
    if (!alternando) return
    setProcessando(true)
    const { error } = await supabase
      .from('imobiliarias')
      .update({ ativa: !alternando.ativa })
      .eq('id', alternando.id)
    setProcessando(false)

    if (error) return toastErro('Nao foi possivel alterar', error.message)
    ok(alternando.ativa ? 'Imobiliaria suspensa' : 'Imobiliaria reativada')
    setAlternando(null)
    void carregar()
  }

  const set = <K extends keyof FormImobiliaria>(c: K, v: FormImobiliaria[K]) =>
    setForm((f) => ({ ...f, [c]: v }))

  /** Campos cadastrais, reaproveitados na criacao e na edicao. */
  const camposCadastro = (
    <>
      <Campo rotulo="Nome" obrigatorio className="col-8" erro={erros.nome}>
        <input
          className="input"
          value={form.nome ?? ''}
          onChange={(e) => set('nome', e.target.value)}
          placeholder="Imobiliaria Horizonte"
        />
      </Campo>

      <Campo rotulo="Plano" className="col-4">
        <select
          className="select"
          value={form.plano ?? 'basico'}
          onChange={(e) => set('plano', e.target.value)}
        >
          <option value="basico">Basico</option>
          <option value="profissional">Profissional</option>
          <option value="premium">Premium</option>
        </select>
      </Campo>

      <Campo rotulo="Razao social" className="col-7">
        <input
          className="input"
          value={form.razao_social ?? ''}
          onChange={(e) => set('razao_social', e.target.value)}
        />
      </Campo>

      <Campo rotulo="CPF / CNPJ" className="col-5" erro={erros.cpf_cnpj}>
        <input
          className="input"
          value={form.cpf_cnpj ?? ''}
          onChange={(e) => set('cpf_cnpj', mascaraCpfCnpj(e.target.value))}
          inputMode="numeric"
        />
      </Campo>

      <Campo rotulo="E-mail de contato" className="col-7" erro={erros.email}>
        <input
          className="input"
          type="email"
          value={form.email ?? ''}
          onChange={(e) => set('email', e.target.value)}
        />
      </Campo>

      <Campo rotulo="Telefone" className="col-5">
        <input
          className="input"
          value={form.telefone ?? ''}
          onChange={(e) => set('telefone', mascaraTelefone(e.target.value))}
          inputMode="tel"
        />
      </Campo>

      <Campo rotulo="Cidade" className="col-8">
        <input
          className="input"
          value={form.cidade ?? ''}
          onChange={(e) => set('cidade', e.target.value)}
        />
      </Campo>

      <Campo rotulo="UF" className="col-4">
        <select
          className="select"
          value={form.estado ?? ''}
          onChange={(e) => set('estado', e.target.value)}
        >
          <option value="">-</option>
          {UF_LISTA.map((uf) => <option key={uf} value={uf}>{uf}</option>)}
        </select>
      </Campo>
    </>
  )

  /** Campos do administrador, reaproveitados na criacao e no "novo admin". */
  const camposAdmin = (
    <>
      <Campo rotulo="Nome do administrador" obrigatorio className="col-12" erro={erros.admin_nome}>
        <input
          className="input"
          value={admin.nome}
          onChange={(e) => setAdmin({ ...admin, nome: e.target.value })}
        />
      </Campo>

      <Campo
        rotulo="E-mail de acesso"
        obrigatorio
        className="col-12"
        erro={erros.admin_email}
        dica="Sera o login. Um e-mail so pode existir em uma imobiliaria."
      >
        <input
          className="input"
          type="email"
          value={admin.email}
          onChange={(e) => setAdmin({ ...admin, email: e.target.value })}
        />
      </Campo>

      <Campo
        rotulo="Senha inicial"
        obrigatorio
        className="col-12"
        erro={erros.admin_senha}
        dica={`Minimo de ${SENHA_MINIMA} caracteres. Oriente a trocar no primeiro acesso.`}
      >
        <div className="linha" style={{ gap: 8 }}>
          <input
            className="input"
            value={admin.senha}
            onChange={(e) => setAdmin({ ...admin, senha: e.target.value })}
            style={{ fontFamily: 'var(--fonte-mono, monospace)' }}
          />
          <button
            type="button"
            className="btn btn--secundario btn--sm"
            onClick={() => setAdmin({ ...admin, senha: gerarSenha() })}
            title="Gerar outra senha"
          >
            <RefreshCw size={13} />
          </button>
        </div>
      </Campo>
    </>
  )

  return (
    <div>
      <div className="aviso aviso--info mb-3">
        <Info size={16} />
        <div>
          <strong>Voce nao enxerga os dados dos clientes</strong>
          <div className="t-sm mt-0">
            Esta area mostra apenas quantidades. Imoveis, clientes, contratos e financeiro de
            cada imobiliaria sao invisiveis para o administrador da plataforma &mdash; garantido
            pelo banco, nao pela tela. Suspender uma imobiliaria bloqueia o acesso na hora,
            sem apagar nada.
          </div>
        </div>
      </div>

      <div className="barra">
        <div className="busca">
          <Search size={15} />
          <input
            className="input"
            placeholder="Buscar por nome, CNPJ, codigo ou cidade..."
            value={busca}
            onChange={(e) => setBusca(e.target.value)}
          />
        </div>
        <div className="barra__dir">
          <span className="contador">
            {lista.filter((i) => i.ativa).length} ativa(s) de {lista.length}
          </span>
          <button className="btn btn--primario" onClick={abrirNova}>
            <Plus size={15} />
            Nova imobiliaria
          </button>
        </div>
      </div>

      {carregando ? (
        <SkeletonTabela linhas={4} colunas={6} />
      ) : filtrados.length === 0 ? (
        <div className="card">
          <Vazio
            icone={<Landmark size={24} />}
            titulo="Nenhuma imobiliaria cadastrada"
            texto="Cadastre a primeira para comecar a entregar o sistema."
            acao={
              <button className="btn btn--primario" onClick={abrirNova}>
                <Plus size={15} /> Nova imobiliaria
              </button>
            }
          />
        </div>
      ) : (
        <div className="tabela-wrap">
          <table className="tabela">
            <thead>
              <tr>
                <th>Imobiliaria</th>
                <th>Codigo</th>
                <th>Uso</th>
                <th>Ultimo acesso</th>
                <th>Situacao</th>
                <th className="acoes">Acoes</th>
              </tr>
            </thead>
            <tbody>
              {filtrados.map((i) => (
                <tr key={i.id}>
                  <td>
                    <div className="celula-forte">{i.nome}</div>
                    <div className="celula-fraca">
                      {[i.cpf_cnpj, [i.cidade, i.estado].filter(Boolean).join('/')]
                        .filter(Boolean).join(' · ') || `Desde ${data(i.created_at)}`}
                    </div>
                  </td>
                  <td>
                    <button
                      className="btn btn--fantasma btn--sm"
                      onClick={() => void copiar(i.codigo)}
                      title="Copiar codigo de acesso"
                      style={{ letterSpacing: '.12em', fontWeight: 600 }}
                    >
                      {i.codigo}
                    </button>
                  </td>
                  <td className="t-sm">
                    <div className="linha" style={{ gap: 12, flexWrap: 'wrap' }}>
                      <span title="Usuarios"><Users size={12} /> {i.total_usuarios}</span>
                      <span title="Imoveis"><Building2 size={12} /> {i.total_imoveis}</span>
                      <span title="Contratos ativos"><FileText size={12} /> {i.total_contratos_ativos}</span>
                    </div>
                  </td>
                  <td className="t-sm">
                    {i.ultimo_acesso ? dataHora(i.ultimo_acesso) : <span className="t-3">nunca</span>}
                  </td>
                  <td>
                    {i.ativa ? (
                      <span className="badge badge--ok"><i className="ponto" /> Ativa</span>
                    ) : (
                      <span className="badge badge--erro"><i className="ponto" /> Suspensa</span>
                    )}
                  </td>
                  <td className="acoes">
                    <button
                      className="btn btn--fantasma btn--sm"
                      title="Editar cadastro"
                      onClick={() => {
                        setEditando(i)
                        setForm({ ...i })
                        setErros({})
                      }}
                    >
                      <Pencil size={13} />
                    </button>
                    <button
                      className="btn btn--fantasma btn--sm"
                      title="Criar administrador"
                      onClick={() => {
                        setNovoAdminDe(i)
                        setAdmin({ ...ADMIN_VAZIO, senha: gerarSenha() })
                        setErros({})
                      }}
                    >
                      <UserPlus size={13} />
                    </button>
                    <button
                      className="btn btn--fantasma btn--sm"
                      title={i.ativa ? 'Suspender acesso' : 'Reativar acesso'}
                      onClick={() => setAlternando(i)}
                    >
                      {i.ativa
                        ? <PauseCircle size={14} color="var(--erro)" />
                        : <PlayCircle size={14} color="var(--ok)" />}
                    </button>
                  </td>
                </tr>
              ))}
            </tbody>
          </table>
        </div>
      )}

      {/* ---------------------------------------------- nova imobiliaria -- */}
      <Modal
        aberto={criando}
        aoFechar={() => setCriando(false)}
        titulo="Nova imobiliaria"
        subtitulo="O codigo de acesso de 6 digitos e gerado automaticamente."
        tamanho="lg"
        rodape={
          entrega ? (
            <button className="btn btn--primario" onClick={() => { setCriando(false); setEntrega(null) }}>
              Concluir
            </button>
          ) : (
            <>
              <button className="btn btn--secundario" onClick={() => setCriando(false)} disabled={salvando}>
                Cancelar
              </button>
              <button className="btn btn--primario" onClick={() => void criar()} disabled={salvando}>
                {salvando && <span className="spin spin--sm spin--claro" />}
                Criar imobiliaria
              </button>
            </>
          )
        }
      >
        {entrega ? (
          <Entrega {...entrega} />
        ) : (
          <div className="form-grade">
            {camposCadastro}
            <div className="col-12"><div className="divisor" /></div>
            <div className="col-12 t-sm t-3" style={{ marginBottom: -4 }}>
              <strong>Administrador da imobiliaria</strong> &mdash; e ele quem cadastra o
              restante da equipe depois.
            </div>
            {camposAdmin}
          </div>
        )}
      </Modal>

      {/* -------------------------------------------- editar imobiliaria -- */}
      <Modal
        aberto={Boolean(editando)}
        aoFechar={() => setEditando(null)}
        titulo="Editar cadastro"
        subtitulo={editando ? `Codigo ${editando.codigo}` : undefined}
        tamanho="lg"
        rodape={
          <>
            <button className="btn btn--secundario" onClick={() => setEditando(null)} disabled={salvando}>
              Cancelar
            </button>
            <button className="btn btn--primario" onClick={() => void salvarEdicao()} disabled={salvando}>
              {salvando && <span className="spin spin--sm spin--claro" />}
              Salvar
            </button>
          </>
        }
      >
        <div className="form-grade">
          {camposCadastro}
          <Campo rotulo="Observacoes internas" className="col-12">
            <textarea
              className="input"
              rows={2}
              value={form.observacoes ?? ''}
              onChange={(e) => set('observacoes', e.target.value)}
            />
          </Campo>
        </div>
      </Modal>

      {/* ------------------------------------------- novo administrador -- */}
      <Modal
        aberto={Boolean(novoAdminDe)}
        aoFechar={() => setNovoAdminDe(null)}
        titulo="Criar administrador"
        subtitulo={novoAdminDe?.nome}
        tamanho="md"
        rodape={
          <>
            <button className="btn btn--secundario" onClick={() => setNovoAdminDe(null)} disabled={salvando}>
              Cancelar
            </button>
            <button className="btn btn--primario" onClick={() => void criarAdmin()} disabled={salvando}>
              {salvando && <span className="spin spin--sm spin--claro" />}
              Criar acesso
            </button>
          </>
        }
      >
        <div className="form-grade">{camposAdmin}</div>
      </Modal>

      {/* Entrega das credenciais criadas fora do fluxo de "nova imobiliaria" */}
      <Modal
        aberto={Boolean(entrega) && !criando}
        aoFechar={() => setEntrega(null)}
        titulo="Acesso criado"
        tamanho="md"
        rodape={<button className="btn btn--primario" onClick={() => setEntrega(null)}>Concluir</button>}
      >
        {entrega && <Entrega {...entrega} />}
      </Modal>

      <Confirmar
        aberto={Boolean(alternando)}
        titulo={alternando?.ativa ? 'Suspender imobiliaria' : 'Reativar imobiliaria'}
        mensagem={
          alternando?.ativa
            ? `Todos os usuarios da ${alternando?.nome} perdem o acesso imediatamente, mesmo quem ja esta logado. Nenhum dado e apagado: ao reativar, tudo volta como estava.`
            : `A ${alternando?.nome} volta a ter acesso ao sistema.`
        }
        textoConfirmar={alternando?.ativa ? 'Suspender' : 'Reativar'}
        perigo={alternando?.ativa}
        processando={processando}
        aoConfirmar={() => void confirmarSituacao()}
        aoCancelar={() => setAlternando(null)}
      />
    </div>
  )
}
