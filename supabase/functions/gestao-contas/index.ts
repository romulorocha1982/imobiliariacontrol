// =============================================================================
// IMOBILIARIA CONTROL - Edge Function `gestao-contas`
//
// Criar usuario com senha exige a service_role key, que NUNCA pode ir para o
// navegador. Por isso este codigo roda no servidor.
//
// Uma funcao so, com roteamento por `acao`: o deploy e manual pelo painel,
// entao quanto menos funcoes, menos trabalho a cada mudanca.
//
// DEPLOY (sem CLI)
//   Painel Supabase > Edge Functions > Deploy a new function > Via Editor
//   Nome: gestao-contas    Cole este arquivo    Deploy
//
//   - Nenhum secret a cadastrar: SUPABASE_URL, SUPABASE_ANON_KEY e
//     SUPABASE_SERVICE_ROLE_KEY sao injetados automaticamente no runtime.
//   - Deixe "Verify JWT" LIGADO. Ele nao basta sozinho (a anon key tambem e um
//     JWT valido), por isso a validacao de identidade abaixo continua obrigatoria.
//
// Este arquivo e a fonte de verdade versionada. Se editar pelo painel, traga a
// mudanca de volta para ca.
// =============================================================================

import { createClient } from 'https://esm.sh/@supabase/supabase-js@2.45.4'

const ORIGENS_PERMITIDAS = [
  'https://imobiliariacontrol.netlify.app',
  'http://localhost:5173',
]

const CARGOS_EQUIPE = ['admin', 'gerente', 'corretor', 'financeiro']

const SENHA_MINIMA = 8

function cors(origem: string | null) {
  // Nunca '*': isso permitiria qualquer site chamar a funcao com o cookie/token
  // do usuario logado.
  const permitida = origem && ORIGENS_PERMITIDAS.includes(origem)
    ? origem
    : ORIGENS_PERMITIDAS[0]
  return {
    'Access-Control-Allow-Origin': permitida,
    'Access-Control-Allow-Headers': 'authorization, content-type, apikey, x-client-info',
    'Access-Control-Allow-Methods': 'POST, OPTIONS',
    'Vary': 'Origin',
  }
}

function responder(corpo: unknown, status: number, origem: string | null) {
  return new Response(JSON.stringify(corpo), {
    status,
    headers: { ...cors(origem), 'Content-Type': 'application/json' },
  })
}

function erro(mensagem: string, status: number, origem: string | null) {
  return responder({ ok: false, erro: mensagem }, status, origem)
}

function validarEmail(email: unknown): string | null {
  if (typeof email !== 'string') return null
  const limpo = email.trim().toLowerCase()
  return /^[^\s@]+@[^\s@]+\.[^\s@]+$/.test(limpo) ? limpo : null
}

function validarPessoa(dados: Record<string, unknown>) {
  const email = validarEmail(dados.email)
  if (!email) return { erro: 'Informe um e-mail valido.' }

  const nome = typeof dados.nome === 'string' ? dados.nome.trim() : ''
  if (nome.length < 3) return { erro: 'Informe o nome completo.' }

  const senha = typeof dados.senha === 'string' ? dados.senha : ''
  if (senha.length < SENHA_MINIMA) {
    return { erro: `A senha precisa ter no minimo ${SENHA_MINIMA} caracteres.` }
  }

  return {
    dados: {
      email,
      nome,
      senha,
      telefone: typeof dados.telefone === 'string' ? dados.telefone.trim() || null : null,
      creci: typeof dados.creci === 'string' ? dados.creci.trim() || null : null,
    },
  }
}

/** Traduz os erros do Auth Admin API para mensagens que o admin entende. */
function traduzirErroAuth(mensagem: string): { texto: string; status: number } {
  const m = mensagem.toLowerCase()
  if (m.includes('already registered') || m.includes('email_exists') ||
      m.includes('already been registered')) {
    // Nao revela EM QUAL imobiliaria o e-mail esta: isso seria enumeracao
    // de usuarios entre clientes diferentes.
    return {
      texto: 'Este e-mail ja possui conta no sistema. Se a pessoa e da sua equipe, ' +
             'use "Redefinir senha". Caso contrario, cadastre outro e-mail.',
      status: 409,
    }
  }
  if (m.includes('password')) {
    return { texto: `A senha precisa ter no minimo ${SENHA_MINIMA} caracteres.`, status: 400 }
  }
  return { texto: mensagem, status: 400 }
}

Deno.serve(async (req: Request) => {
  const origem = req.headers.get('origin')

  if (req.method === 'OPTIONS') {
    return new Response(null, { status: 204, headers: cors(origem) })
  }
  if (req.method !== 'POST') {
    return erro('Metodo nao suportado.', 405, origem)
  }

  const URL = Deno.env.get('SUPABASE_URL')!
  const ANON = Deno.env.get('SUPABASE_ANON_KEY')!
  const SERVICE = Deno.env.get('SUPABASE_SERVICE_ROLE_KEY')!

  const autorizacao = req.headers.get('Authorization') ?? ''
  if (!autorizacao) return erro('Sessao nao informada.', 401, origem)

  // -------------------------------------------------------------------------
  // DOIS CLIENTS, NUNCA UM SO
  //
  // clienteUsuario -> valida a ASSINATURA do JWT no servidor de auth.
  // admin          -> service_role, SEM repassar o header do chamador.
  //
  // Se o header vazasse para o client admin, auth.uid() deixaria de ser NULL no
  // banco e o trigger fn_proteger_profile bloquearia o ajuste de cargo logo
  // apos criar o usuario.
  // -------------------------------------------------------------------------
  const clienteUsuario = createClient(URL, ANON, {
    global: { headers: { Authorization: autorizacao } },
    auth: { persistSession: false },
  })
  const admin = createClient(URL, SERVICE, { auth: { persistSession: false } })

  const { data: auth, error: erroAuth } = await clienteUsuario.auth.getUser()
  if (erroAuth || !auth?.user) return erro('Sessao invalida ou expirada.', 401, origem)

  const { data: chamador } = await admin
    .from('profiles')
    .select('id, nome, cargo, ativo, imobiliaria_id')
    .eq('id', auth.user.id)
    .maybeSingle()

  if (!chamador) return erro('Perfil nao encontrado.', 403, origem)
  if (!chamador.ativo) return erro('Sua conta esta desativada.', 403, origem)

  let corpo: Record<string, unknown>
  try {
    corpo = await req.json()
  } catch {
    return erro('Requisicao invalida.', 400, origem)
  }

  const acao = corpo.acao

  // ===========================================================================
  // Helper: cria o usuario no Auth e ajusta o cargo, com compensacao.
  // O tenant SEMPRE vem de quem chama ou da imobiliaria recem-criada - nunca do
  // payload. E isso que impede um admin de A criar usuario dentro de B.
  // ===========================================================================
  async function criarPessoa(
    pessoa: { email: string; nome: string; senha: string; telefone: string | null; creci: string | null },
    tenantId: string,
    cargo: string,
  ): Promise<{ erro?: string; status?: number; id?: string }> {
    const { data: imob } = await admin
      .from('imobiliarias')
      .select('codigo, ativa')
      .eq('id', tenantId)
      .maybeSingle()

    if (!imob) return { erro: 'Imobiliaria nao encontrada.', status: 404 }
    if (!imob.ativa) return { erro: 'Esta imobiliaria esta suspensa.', status: 409 }

    const { data: criado, error: erroCriar } = await admin.auth.admin.createUser({
      email: pessoa.email,
      password: pessoa.senha,
      // quem cria e o administrador, nao o dono da conta: sem isto a pessoa
      // travaria no primeiro login esperando um e-mail de confirmacao
      email_confirm: true,
      user_metadata: {
        nome: pessoa.nome,
        telefone: pessoa.telefone,
        imobiliaria_id: tenantId,
        codigo_acesso: imob.codigo,
      },
    })

    if (erroCriar || !criado?.user) {
      const t = traduzirErroAuth(erroCriar?.message ?? 'Falha ao criar o usuario.')
      return { erro: t.texto, status: t.status }
    }

    // A trigger handle_new_user criou o profile como 'corretor', no tenant certo.
    // O cargo real e definido aqui, com service_role - nunca pelo metadata.
    const { error: erroCargo } = await admin
      .from('profiles')
      .update({ cargo, creci: pessoa.creci })
      .eq('id', criado.user.id)

    if (erroCargo) {
      // compensacao: nada de usuario orfao com o cargo errado
      await admin.auth.admin.deleteUser(criado.user.id)
      return { erro: 'Falha ao definir o cargo. Nenhum usuario foi criado.', status: 500 }
    }

    return { id: criado.user.id }
  }

  // ===========================================================================
  // ACOES DO ADMIN DA IMOBILIARIA
  // ===========================================================================
  if (acao === 'criar_usuario') {
    if (chamador.cargo !== 'admin') {
      return erro('Somente o administrador da imobiliaria cria usuarios.', 403, origem)
    }
    if (!chamador.imobiliaria_id) {
      return erro('Sua conta nao esta vinculada a uma imobiliaria.', 403, origem)
    }

    const cargo = String(corpo.cargo ?? '')
    if (!CARGOS_EQUIPE.includes(cargo)) {
      return erro('Cargo invalido.', 400, origem)
    }

    const v = validarPessoa(corpo)
    if (v.erro) return erro(v.erro, 400, origem)

    const r = await criarPessoa(v.dados!, chamador.imobiliaria_id, cargo)
    if (r.erro) return erro(r.erro, r.status ?? 400, origem)

    return responder(
      { ok: true, dados: { id: r.id, email: v.dados!.email, cargo } },
      200, origem,
    )
  }

  if (acao === 'redefinir_senha') {
    const alvoId = String(corpo.usuario_id ?? '')
    const senha = typeof corpo.senha === 'string' ? corpo.senha : ''
    if (senha.length < SENHA_MINIMA) {
      return erro(`A senha precisa ter no minimo ${SENHA_MINIMA} caracteres.`, 400, origem)
    }

    const { data: alvo } = await admin
      .from('profiles')
      .select('id, cargo, imobiliaria_id')
      .eq('id', alvoId)
      .maybeSingle()

    if (!alvo) return erro('Usuario nao encontrado.', 404, origem)

    const souSuper = chamador.cargo === 'super_admin'
    const souAdminDoMesmoTenant =
      chamador.cargo === 'admin' &&
      chamador.imobiliaria_id !== null &&
      alvo.imobiliaria_id === chamador.imobiliaria_id

    // super admin so redefine senha de administrador (suporte), nunca da equipe
    if (!(souAdminDoMesmoTenant || (souSuper && alvo.cargo === 'admin'))) {
      return erro('Sem permissao para redefinir esta senha.', 403, origem)
    }

    const { error: e } = await admin.auth.admin.updateUserById(alvoId, { password: senha })
    if (e) {
      const t = traduzirErroAuth(e.message)
      return erro(t.texto, t.status, origem)
    }
    return responder({ ok: true, dados: { id: alvoId } }, 200, origem)
  }

  // ===========================================================================
  // ACOES DO SUPER ADMIN
  // ===========================================================================
  if (acao === 'criar_imobiliaria') {
    if (chamador.cargo !== 'super_admin') {
      return erro('Acao restrita ao administrador da plataforma.', 403, origem)
    }

    const nome = typeof corpo.nome === 'string' ? corpo.nome.trim() : ''
    if (nome.length < 3) return erro('Informe o nome da imobiliaria.', 400, origem)

    const v = validarPessoa((corpo.admin ?? {}) as Record<string, unknown>)
    if (v.erro) return erro(`Administrador: ${v.erro}`, 400, origem)

    const texto = (c: unknown) =>
      typeof c === 'string' && c.trim() ? c.trim() : null

    const novaImobiliaria = {
      nome,
      razao_social: texto(corpo.razao_social),
      cpf_cnpj: texto(corpo.cpf_cnpj),
      email: texto(corpo.email),
      telefone: texto(corpo.telefone),
      cidade: texto(corpo.cidade),
      estado: texto(corpo.estado),
      plano: texto(corpo.plano) ?? 'basico',
    }

    // O codigo de 6 digitos vem do trigger. Colisao e 23505: uma nova tentativa
    // sorteia outro codigo.
    let imobiliaria: { id: string; codigo: string } | null = null
    for (let tentativa = 0; tentativa < 2 && !imobiliaria; tentativa++) {
      const { data, error: e } = await admin
        .from('imobiliarias')
        .insert(novaImobiliaria)
        .select('id, codigo')
        .single()

      if (!e && data) imobiliaria = data
      else if (e && e.code !== '23505') {
        return erro(`Falha ao criar a imobiliaria: ${e.message}`, 400, origem)
      }
    }
    if (!imobiliaria) {
      return erro('Nao foi possivel gerar um codigo de acesso. Tente novamente.', 500, origem)
    }

    const r = await criarPessoa(v.dados!, imobiliaria.id, 'admin')
    if (r.erro) {
      // compensacao: a imobiliaria recem-criada esta vazia, pode sumir
      await admin.from('imobiliarias').delete().eq('id', imobiliaria.id)
      return erro(r.erro, r.status ?? 400, origem)
    }

    return responder({
      ok: true,
      dados: {
        imobiliaria_id: imobiliaria.id,
        nome,
        codigo: imobiliaria.codigo,
        admin_email: v.dados!.email,
      },
    }, 200, origem)
  }

  // Cria um administrador para uma imobiliaria que JA EXISTE.
  // Usada logo apos a migracao (a Matriz fica sem admin quando a conta do dono
  // vira super_admin) e no suporte, quando o admin de um cliente sai da empresa.
  if (acao === 'criar_admin') {
    if (chamador.cargo !== 'super_admin') {
      return erro('Acao restrita ao administrador da plataforma.', 403, origem)
    }

    const tenantId = String(corpo.imobiliaria_id ?? '')
    if (!tenantId) return erro('Informe a imobiliaria.', 400, origem)

    const v = validarPessoa(corpo)
    if (v.erro) return erro(v.erro, 400, origem)

    const r = await criarPessoa(v.dados!, tenantId, 'admin')
    if (r.erro) return erro(r.erro, r.status ?? 400, origem)

    return responder(
      { ok: true, dados: { id: r.id, email: v.dados!.email } },
      200, origem,
    )
  }

  // Nota: suspender/reativar e editar os dados cadastrais de uma imobiliaria NAO
  // passam por aqui. Sao UPDATE comuns, ja permitidos ao super admin pelas
  // policies imobiliarias_super_update. Esta funcao existe apenas para o que
  // exige a service_role - criar usuarios e trocar senha -, e manter essa
  // fronteira estreita e o que a torna facil de auditar.

  return erro('Acao desconhecida.', 400, origem)
})
