import { useEffect, useState, type ReactNode } from 'react'
import { NavLink, useLocation } from 'react-router-dom'
import {
  LayoutDashboard, Building2, Users, UserRound, FileText, Wallet,
  Target, ShieldCheck, ScrollText, LogOut, Menu, Sun, Moon, Home, Landmark,
  KeyRound, LifeBuoy,
} from 'lucide-react'
import { useAuth } from '@/contexts/AuthContext'
import { LABEL_CARGO, type UserRole } from '@/lib/types'
import { iniciais } from '@/lib/format'

interface ItemMenu {
  para: string
  rotulo: string
  icone: ReactNode
  grupo: string
  cargos?: UserRole[]
}

const MENU: ItemMenu[] = [
  { para: '/',              rotulo: 'Painel',        icone: <LayoutDashboard size={17} />, grupo: 'Visao geral' },

  { para: '/imoveis',       rotulo: 'Imoveis',       icone: <Building2 size={17} />,  grupo: 'Cadastros' },
  { para: '/proprietarios', rotulo: 'Proprietarios', icone: <UserRound size={17} />,  grupo: 'Cadastros' },
  { para: '/clientes',      rotulo: 'Clientes',      icone: <Users size={17} />,      grupo: 'Cadastros' },

  { para: '/contratos',     rotulo: 'Contratos',     icone: <FileText size={17} />,   grupo: 'Operacao' },
  { para: '/financeiro',    rotulo: 'Financeiro',    icone: <Wallet size={17} />,     grupo: 'Operacao',
    cargos: ['admin', 'gerente', 'financeiro'] },
  { para: '/crm',           rotulo: 'CRM / Funil',   icone: <Target size={17} />,     grupo: 'Operacao' },

  { para: '/usuarios',      rotulo: 'Usuarios',      icone: <ShieldCheck size={17} />, grupo: 'Administracao',
    cargos: ['admin'] },
  { para: '/auditoria',     rotulo: 'Auditoria',     icone: <ScrollText size={17} />,  grupo: 'Administracao',
    cargos: ['admin', 'gerente'] },

  // Fica por ultimo de proposito: ajuda se procura quando ja se esta perdido,
  // e o fim do menu e onde a mao vai. Vale para todos os cargos.
  { para: '/ajuda',         rotulo: 'Como usar',     icone: <LifeBuoy size={17} />,    grupo: 'Ajuda' },

  // Unico item do super admin. Ele nao ve nenhum dos anteriores - nem no menu,
  // nem como rota montada (ver App.tsx).
  { para: '/admin/imobiliarias', rotulo: 'Imobiliarias', icone: <Landmark size={17} />, grupo: 'Plataforma',
    cargos: ['super_admin'] },
]

const TITULOS: Record<string, { titulo: string; sub: string }> = {
  '/':              { titulo: 'Painel de controle', sub: 'Visao geral da imobiliaria' },
  '/imoveis':       { titulo: 'Imoveis',            sub: 'Carteira de propriedades' },
  '/proprietarios': { titulo: 'Proprietarios',      sub: 'Donos dos imoveis e dados de repasse' },
  '/clientes':      { titulo: 'Clientes',           sub: 'Inquilinos, compradores e interessados' },
  '/contratos':     { titulo: 'Contratos',          sub: 'Locacoes e vigencias' },
  '/financeiro':    { titulo: 'Financeiro',         sub: 'Contas a receber e a pagar' },
  '/crm':           { titulo: 'CRM / Funil',        sub: 'Negociacoes em andamento' },
  '/usuarios':      { titulo: 'Usuarios',           sub: 'Equipe e permissoes' },
  '/auditoria':     { titulo: 'Auditoria',          sub: 'Historico de alteracoes' },
  '/ajuda':         { titulo: 'Como usar o sistema', sub: 'Guia rapido e perguntas frequentes' },
  '/admin/imobiliarias': { titulo: 'Imobiliarias',  sub: 'Contas atendidas pela plataforma' },
}

type Tema = 'claro' | 'escuro' | 'sistema'

const preferSistemaEscuro = () =>
  typeof window !== 'undefined' &&
  window.matchMedia('(prefers-color-scheme: dark)').matches

function usarTema() {
  const [tema, setTema] = useState<Tema>(() => {
    try {
      return (localStorage.getItem('tema') as Tema) || 'sistema'
    } catch {
      return 'sistema'
    }
  })

  useEffect(() => {
    const raiz = document.documentElement
    if (tema === 'sistema') raiz.removeAttribute('data-theme')
    else raiz.setAttribute('data-theme', tema === 'escuro' ? 'dark' : 'light')
    try {
      localStorage.setItem('tema', tema)
    } catch {
      /* modo privado pode bloquear o storage - segue sem persistir */
    }
  }, [tema])

  const escuroAtivo = tema === 'escuro' || (tema === 'sistema' && preferSistemaEscuro())
  const alternar = () => setTema(escuroAtivo ? 'claro' : 'escuro')

  return { escuroAtivo, alternar }
}

export default function Layout({ children }: { children: ReactNode }) {
  const { perfil, imobiliaria, ehSuperAdmin, sair } = useAuth()
  const local = useLocation()
  const [menuAberto, setMenuAberto] = useState(false)
  const { escuroAtivo, alternar } = usarTema()

  // Fecha o menu lateral ao trocar de rota (mobile)
  useEffect(() => { setMenuAberto(false) }, [local.pathname])

  const cabecalho = TITULOS[local.pathname] ?? { titulo: 'Imobiliaria Control', sub: '' }

  const visiveis = MENU.filter((m) => {
    if (!perfil) return false
    // O super admin so ve o que e explicitamente dele: nenhuma tela operacional.
    if (ehSuperAdmin) return m.cargos?.includes('super_admin') ?? false
    return !m.cargos || m.cargos.includes(perfil.cargo)
  })
  const grupos = [...new Set(visiveis.map((m) => m.grupo))]

  return (
    <div className="app">
      {menuAberto && <div className="nav__overlay" onClick={() => setMenuAberto(false)} />}

      <nav className={`nav ${menuAberto ? 'nav--aberta' : ''}`}>
        <div className="nav__marca">
          <div className="nav__logo">
            <Home size={17} />
          </div>
          <div style={{ minWidth: 0 }}>
            <div className="nav__titulo">Imobiliaria Control</div>
            <div className="nav__sub">
              {ehSuperAdmin ? 'Plataforma' : imobiliaria?.nome ?? 'Gestao completa'}
            </div>
          </div>
        </div>

        <div className="nav__lista">
          {grupos.map((grupo) => (
            <div key={grupo}>
              <div className="nav__grupo">{grupo}</div>
              {visiveis
                .filter((m) => m.grupo === grupo)
                .map((m) => (
                  <NavLink
                    key={m.para}
                    to={m.para}
                    end={m.para === '/'}
                    className={({ isActive }) =>
                      `nav__item ${isActive ? 'nav__item--ativo' : ''}`
                    }
                  >
                    {m.icone}
                    <span>{m.rotulo}</span>
                  </NavLink>
                ))}
            </div>
          ))}
        </div>

        <div className="nav__rodape">
          {/* O codigo fica a mao porque e o que o admin repassa a equipe e o que
              todo mundo digita no login. */}
          {imobiliaria && (
            <button
              type="button"
              onClick={() => void navigator.clipboard?.writeText(imobiliaria.codigo)}
              title="Copiar o codigo de acesso da imobiliaria"
              style={{
                display: 'flex', alignItems: 'center', gap: 8, width: '100%',
                padding: '7px 8px', marginBottom: 6, borderRadius: 8,
                border: '1px solid rgba(255,255,255,.09)', background: 'transparent',
                color: '#94a3b8', font: 'inherit', fontSize: 11, cursor: 'pointer',
              }}
            >
              <KeyRound size={13} />
              <span>Codigo</span>
              <strong style={{ marginLeft: 'auto', color: '#e2e8f0', letterSpacing: '.12em' }}>
                {imobiliaria.codigo}
              </strong>
            </button>
          )}

          <div className="nav__usuario">
            <div className="nav__avatar">{iniciais(perfil?.nome ?? '?')}</div>
            <div style={{ minWidth: 0, flex: 1 }}>
              <div className="nav__usuario-nome">{perfil?.nome}</div>
              <div className="nav__usuario-cargo">
                {perfil ? LABEL_CARGO[perfil.cargo] : ''}
              </div>
            </div>
            <button className="nav__sair" onClick={() => void sair()} title="Sair do sistema">
              <LogOut size={16} />
            </button>
          </div>
        </div>
      </nav>

      <div className="principal">
        <header className="topo">
          <button
            className="menu-toggle"
            onClick={() => setMenuAberto((v) => !v)}
            aria-label="Abrir menu"
          >
            <Menu size={19} />
          </button>

          <div>
            <div className="topo__titulo">{cabecalho.titulo}</div>
            {cabecalho.sub && <div className="topo__sub">{cabecalho.sub}</div>}
          </div>

          <div className="topo__acoes">
            <button
              className="btn btn--fantasma btn--icone"
              onClick={alternar}
              title={escuroAtivo ? 'Mudar para tema claro' : 'Mudar para tema escuro'}
              aria-label="Alternar tema"
            >
              {escuroAtivo ? <Sun size={17} /> : <Moon size={17} />}
            </button>
          </div>
        </header>

        <main className="conteudo">{children}</main>
      </div>
    </div>
  )
}
