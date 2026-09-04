import { Navigate, Route, Routes } from 'react-router-dom'
import { useAuth } from '@/contexts/AuthContext'
import { supabaseConfigurado } from '@/lib/supabase'
import type { UserRole } from '@/lib/types'
import Layout from '@/components/Layout'
import Login from '@/pages/Login'
import Dashboard from '@/pages/Dashboard'
import Imoveis from '@/pages/Imoveis'
import Proprietarios from '@/pages/Proprietarios'
import Clientes from '@/pages/Clientes'
import Contratos from '@/pages/Contratos'
import Financeiro from '@/pages/Financeiro'
import CRM from '@/pages/CRM'
import Usuarios from '@/pages/Usuarios'
import Auditoria from '@/pages/Auditoria'
import AdminImobiliarias from '@/pages/AdminImobiliarias'
import Ajuda from '@/pages/Ajuda'
import { Carregando, Vazio } from '@/components/ui'
import { ShieldAlert, PlugZap, PauseCircle } from 'lucide-react'

/** Tela mostrada quando o .env ainda nao foi preenchido */
function FaltaConfigurar() {
  return (
    <div style={{ display: 'grid', placeItems: 'center', minHeight: '100vh', padding: 24 }}>
      <div className="card" style={{ maxWidth: 560 }}>
        <div className="card__corpo">
          <Vazio
            icone={<PlugZap size={24} />}
            titulo="Conecte o Supabase para comecar"
            texto="As variaveis VITE_SUPABASE_URL e VITE_SUPABASE_ANON_KEY nao foram encontradas."
          />
          <div className="divisor" />
          <ol style={{ paddingLeft: 20, lineHeight: 1.9, fontSize: 13.5 }}>
            <li>Crie um projeto em <a href="https://supabase.com" target="_blank" rel="noreferrer">supabase.com</a></li>
            <li>Rode os arquivos de <code className="codigo">supabase/migrations/</code> no SQL Editor, na ordem</li>
            <li>Copie <code className="codigo">.env.example</code> para <code className="codigo">.env</code></li>
            <li>Preencha a URL e a chave anon (Project Settings &gt; API)</li>
            <li>Reinicie o servidor: <code className="codigo">npm run dev</code></li>
          </ol>
          <div className="aviso aviso--info mt-3">
            <ShieldAlert size={16} />
            <span>
              No Netlify, cadastre as mesmas variaveis em
              <strong> Site configuration &gt; Environment variables</strong> e refaca o deploy.
            </span>
          </div>
        </div>
      </div>
    </div>
  )
}

/** Bloqueia rota por cargo */
function Restrito({ cargos, children }: { cargos: UserRole[]; children: React.ReactNode }) {
  const { perfil } = useAuth()
  if (!perfil) return null
  if (!cargos.includes(perfil.cargo)) {
    return (
      <Vazio
        icone={<ShieldAlert size={24} />}
        titulo="Acesso restrito"
        texto="Seu cargo nao tem permissao para abrir esta area. Fale com um administrador se precisar de acesso."
      />
    )
  }
  return <>{children}</>
}

export default function App() {
  const { session, perfil, imobiliaria, ehSuperAdmin, carregando } = useAuth()

  if (!supabaseConfigurado) return <FaltaConfigurar />

  if (carregando) {
    return (
      <div style={{ display: 'grid', placeItems: 'center', minHeight: '100vh' }}>
        <Carregando texto="Carregando sistema..." />
      </div>
    )
  }

  if (!session) {
    return (
      <Routes>
        <Route path="/login" element={<Login />} />
        <Route path="*" element={<Navigate to="/login" replace />} />
      </Routes>
    )
  }

  // Sessao valida, mas o perfil ainda nao chegou
  if (!perfil) {
    return (
      <div style={{ display: 'grid', placeItems: 'center', minHeight: '100vh' }}>
        <Carregando texto="Carregando seu perfil..." />
      </div>
    )
  }

  // Conta desativada por um administrador
  if (!perfil.ativo) {
    return <ContaDesativada />
  }

  // O super admin gerencia contas de imobiliaria e nada mais. As telas
  // operacionais nao sao sequer montadas para ele - o requisito de LGPD fica
  // implementado tambem aqui, nao so na RLS.
  if (ehSuperAdmin) {
    return (
      <Layout>
        <Routes>
          <Route path="/admin/imobiliarias" element={<AdminImobiliarias />} />
          <Route path="*" element={<Navigate to="/admin/imobiliarias" replace />} />
        </Routes>
      </Layout>
    )
  }

  // Imobiliaria suspensa pelo administrador da plataforma.
  // Sem esta tela, minha_imobiliaria() devolveria NULL e TODAS as listas
  // voltariam vazias, sem nenhuma explicacao para o usuario.
  if (imobiliaria && !imobiliaria.ativa) {
    return <ImobiliariaSuspensa />
  }

  return (
    <Layout>
      <Routes>
        <Route path="/" element={<Dashboard />} />
        <Route path="/imoveis" element={<Imoveis />} />
        <Route path="/proprietarios" element={<Proprietarios />} />
        <Route path="/clientes" element={<Clientes />} />
        <Route path="/contratos" element={<Contratos />} />
        <Route
          path="/financeiro"
          element={
            <Restrito cargos={['admin', 'gerente', 'financeiro']}>
              <Financeiro />
            </Restrito>
          }
        />
        <Route path="/crm" element={<CRM />} />
        <Route
          path="/usuarios"
          element={
            <Restrito cargos={['admin']}>
              <Usuarios />
            </Restrito>
          }
        />
        <Route
          path="/auditoria"
          element={
            <Restrito cargos={['admin', 'gerente']}>
              <Auditoria />
            </Restrito>
          }
        />
        {/* Sem Restrito: a ajuda vale para todos os cargos, e o conteudo dela
            ja explica o que cada um pode fazer. */}
        <Route path="/ajuda" element={<Ajuda />} />
        <Route path="/login" element={<Navigate to="/" replace />} />
        <Route path="*" element={<Navigate to="/" replace />} />
      </Routes>
    </Layout>
  )
}

function ImobiliariaSuspensa() {
  const { sair, imobiliaria } = useAuth()
  return (
    <div style={{ display: 'grid', placeItems: 'center', minHeight: '100vh', padding: 24 }}>
      <div className="card" style={{ maxWidth: 430 }}>
        <div className="card__corpo">
          <Vazio
            icone={<PauseCircle size={24} />}
            titulo="Acesso suspenso"
            texto={`O acesso da ${imobiliaria?.nome ?? 'sua imobiliaria'} esta suspenso no momento. Nenhum dado foi perdido: assim que a situacao for regularizada, tudo volta como estava. Fale com o suporte do Imobiliaria Control.`}
            acao={
              <button className="btn btn--secundario" onClick={() => void sair()}>
                Sair
              </button>
            }
          />
        </div>
      </div>
    </div>
  )
}

function ContaDesativada() {
  const { sair, perfil } = useAuth()
  return (
    <div style={{ display: 'grid', placeItems: 'center', minHeight: '100vh', padding: 24 }}>
      <div className="card" style={{ maxWidth: 430 }}>
        <div className="card__corpo">
          <Vazio
            icone={<ShieldAlert size={24} />}
            titulo="Conta desativada"
            texto={`Ola, ${perfil?.nome}. Seu acesso foi desativado por um administrador. Procure o responsavel pelo sistema para reativar.`}
            acao={
              <button className="btn btn--secundario" onClick={() => void sair()}>
                Sair
              </button>
            }
          />
        </div>
      </div>
    </div>
  )
}
