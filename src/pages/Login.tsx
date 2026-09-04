import { useState, type FormEvent } from 'react'
import {
  Home, Eye, EyeOff, AlertCircle, CheckCircle2, Building2,
  Wallet, Target, FileText,
} from 'lucide-react'
import { useAuth, codigoLembrado } from '@/contexts/AuthContext'
import { Campo } from '@/components/ui'

type Modo = 'entrar' | 'recuperar'

export default function Login() {
  const { entrar, recuperarSenha } = useAuth()

  const [modo, setModo] = useState<Modo>('entrar')
  const [email, setEmail] = useState('')
  const [senha, setSenha] = useState('')
  const [codigo, setCodigo] = useState(codigoLembrado)
  const [verSenha, setVerSenha] = useState(false)
  const [enviando, setEnviando] = useState(false)
  const [erro, setErro] = useState('')
  const [sucesso, setSucesso] = useState('')

  function limparAvisos() {
    setErro('')
    setSucesso('')
  }

  function trocarModo(novo: Modo) {
    setModo(novo)
    limparAvisos()
    setSenha('')
  }

  async function enviar(e: FormEvent) {
    e.preventDefault()
    limparAvisos()

    if (!email.trim()) return setErro('Informe o e-mail.')

    if (modo === 'recuperar') {
      setEnviando(true)
      const { erro: err } = await recuperarSenha(email)
      setEnviando(false)
      if (err) return setErro(err)
      return setSucesso('Enviamos um link de redefinicao para o seu e-mail.')
    }

    if (senha.length < 6) return setErro('A senha precisa ter no minimo 6 caracteres.')

    setEnviando(true)
    const { erro: err } = await entrar(email, senha, codigo)
    setEnviando(false)
    if (err) setErro(err)
  }

  const titulos: Record<Modo, { titulo: string; sub: string; botao: string }> = {
    entrar: {
      titulo: 'Bem-vindo de volta',
      sub: 'Entre com suas credenciais e o codigo da sua imobiliaria.',
      botao: 'Entrar',
    },
    recuperar: {
      titulo: 'Recuperar senha',
      sub: 'Enviaremos um link para voce definir uma nova senha.',
      botao: 'Enviar link',
    },
  }

  const t = titulos[modo]

  return (
    <div className="login">
      {/* ------------------------------------------------ lado ilustrado -- */}
      <aside className="login__arte">
        <div className="login__marca">
          <div className="nav__logo">
            <Home size={17} />
          </div>
          <span className="login__marca-nome">Imobiliaria Control</span>
        </div>

        <div>
          <h1 className="login__frase">
            Sua imobiliaria inteira<br />
            em <span>um so lugar</span>.
          </h1>
          <p className="login__desc">
            Carteira de imoveis, contratos de locacao, repasses e funil de vendas.
            Tudo organizado, com historico e permissoes por cargo.
          </p>

          <div className="login__recursos">
            <div className="login__recurso">
              <span className="login__recurso-ic"><Building2 size={14} /></span>
              Cadastro de imoveis com fotos e proprietarios
            </div>
            <div className="login__recurso">
              <span className="login__recurso-ic"><FileText size={14} /></span>
              Contratos com reajuste e alerta de vencimento
            </div>
            <div className="login__recurso">
              <span className="login__recurso-ic"><Wallet size={14} /></span>
              Alugueis, repasses, comissoes e inadimplencia
            </div>
            <div className="login__recurso">
              <span className="login__recurso-ic"><Target size={14} /></span>
              Funil de negociacoes e agenda de visitas
            </div>
          </div>
        </div>

        <div className="login__rodape">
          Imobiliaria Control &middot; {new Date().getFullYear()}
        </div>
      </aside>

      {/* ---------------------------------------------------- formulario -- */}
      <main className="login__form-lado">
        <div className="login__caixa">
          <h2 className="login__titulo">{t.titulo}</h2>
          <p className="login__subtitulo">{t.sub}</p>

          <form className="login__campos" onSubmit={enviar}>
            {erro && (
              <div className="login__mensagem login__mensagem--erro">
                <AlertCircle size={16} />
                <span>{erro}</span>
              </div>
            )}
            {sucesso && (
              <div className="login__mensagem login__mensagem--ok">
                <CheckCircle2 size={16} />
                <span>{sucesso}</span>
              </div>
            )}

            <Campo rotulo="E-mail" obrigatorio>
              <input
                className="input"
                type="email"
                value={email}
                onChange={(e) => setEmail(e.target.value)}
                placeholder="voce@imobiliaria.com.br"
                autoComplete="email"
                autoFocus
              />
            </Campo>

            {modo === 'entrar' && (
              <>
                <Campo rotulo="Senha" obrigatorio>
                  <div className="senha-wrap">
                    <input
                      className="input"
                      type={verSenha ? 'text' : 'password'}
                      value={senha}
                      onChange={(e) => setSenha(e.target.value)}
                      placeholder="••••••••"
                      autoComplete="current-password"
                    />
                    <button
                      type="button"
                      className="senha-olho"
                      onClick={() => setVerSenha((v) => !v)}
                      aria-label={verSenha ? 'Ocultar senha' : 'Mostrar senha'}
                    >
                      {verSenha ? <EyeOff size={16} /> : <Eye size={16} />}
                    </button>
                  </div>
                </Campo>

                <Campo
                  rotulo="Codigo da imobiliaria"
                  obrigatorio
                  dica="Os 6 digitos que o administrador da sua imobiliaria informou."
                >
                  <input
                    className="input"
                    value={codigo}
                    onChange={(e) => setCodigo(e.target.value.replace(/\D/g, '').slice(0, 6))}
                    placeholder="000000"
                    inputMode="numeric"
                    maxLength={6}
                    autoComplete="off"
                    style={{ letterSpacing: '.35em', textAlign: 'center', fontSize: 16 }}
                  />
                </Campo>

                <div style={{ textAlign: 'right', marginTop: -4 }}>
                  <button
                    type="button"
                    className="btn btn--fantasma btn--sm"
                    onClick={() => trocarModo('recuperar')}
                  >
                    Esqueci minha senha
                  </button>
                </div>
              </>
            )}

            <button
              type="submit"
              className="btn btn--primario btn--bloco"
              disabled={enviando}
              style={{ marginTop: 4, padding: '10px 14px' }}
            >
              {enviando && <span className="spin spin--sm spin--claro" />}
              {t.botao}
            </button>
          </form>

          <div className="login__troca">
            {modo === 'entrar' ? (
              // Nao ha mais autocadastro: quem cria os acessos e o administrador
              // da imobiliaria, pela tela Usuarios.
              <>Nao tem acesso? Peca ao administrador da sua imobiliaria para criar o seu usuario.</>
            ) : (
              <button onClick={() => trocarModo('entrar')}>Voltar para o login</button>
            )}
          </div>
        </div>
      </main>
    </div>
  )
}
