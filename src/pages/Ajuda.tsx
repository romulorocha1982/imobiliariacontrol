/**
 * Tela de ajuda: guia rapido de uso e perguntas frequentes.
 *
 * O conteudo vive aqui, em constantes, e nao no banco: e material de produto,
 * igual para todas as imobiliarias, e nao precisa de tela de edicao nem de
 * migracao para mudar. Trocar um texto e um deploy.
 *
 * As perguntas cobrem o que de fato gera duvida, e cada resposta diz ONDE
 * clicar -- resposta de FAQ que so explica o conceito nao resolve o chamado.
 */
import { useMemo, useState } from 'react'
import {
  Search, LifeBuoy, ListOrdered, KeyRound, Images, Wallet, ShieldCheck,
} from 'lucide-react'
import { useAuth } from '@/contexts/AuthContext'
import { Vazio } from '@/components/ui'
import { LABEL_CARGO } from '@/lib/types'

/* ----------------------------------------------------------------- dados -- */

type Passo = { titulo: string; texto: string }

const FLUXO: Passo[] = [
  {
    titulo: 'Proprietario',
    texto:
      'Dono do imovel. Cadastre tambem os dados bancarios ou a chave PIX: e para la que o repasse mensal vai.',
  },
  {
    titulo: 'Imovel',
    texto:
      'Endereco, caracteristicas, valor do aluguel, taxa de administracao e comissao. O codigo IM-0001 e gerado sozinho.',
  },
  {
    titulo: 'Cliente',
    texto:
      'Inquilino, comprador, interessado e fiador ficam no mesmo cadastro, separados por tipo. O CPF ou CNPJ e conferido de verdade ao salvar.',
  },
  {
    titulo: 'Contrato',
    texto:
      'Vigencia, dia de vencimento, indice e mes de reajuste, e a garantia: fiador, caucao ou seguro-fianca. A numeracao CT-2026-0001 sai pronta.',
  },
  {
    titulo: 'Gerar parcelas',
    texto:
      'Um clique cria os lancamentos de toda a vigencia. E o passo que liga o contrato ao financeiro: sem ele, nada aparece em contas a receber.',
  },
]

type Pergunta = { p: string; r: string; tags: string }

const FAQ: Pergunta[] = [
  {
    p: 'Cadastrei o contrato mas nao aparece nada no Financeiro',
    r: 'Faltou gerar as parcelas. Abra Contratos e use o botao de parcelas na linha do contrato. Ele cria os lancamentos de toda a vigencia, e pode ser usado de novo depois se voce esticar o periodo: competencias ja lancadas nao sao duplicadas.',
    tags: 'contrato financeiro parcelas lancamento receber vigencia',
  },
  {
    p: 'Um pagamento entrou mas o saldo do mes nao mudou',
    r: 'O lancamento continua em aberto. No Financeiro, use a baixa na linha e informe valor, data e forma de pagamento. O saldo realizado conta apenas o que foi baixado; enquanto isso o valor aparece como previsto.',
    tags: 'financeiro baixa pagamento saldo recebido',
  },
  {
    p: 'O card do imovel esta sem foto',
    r: 'Nenhuma foto foi enviada, ou nenhuma esta marcada como capa. Abra o imovel, va na aba Fotos do anuncio e clique na estrela da foto escolhida. A primeira foto enviada ja vira capa sozinha.',
    tags: 'imovel foto capa anuncio card imagem',
  },
  {
    p: 'Onde anexo a vistoria e o contrato assinado',
    r: 'Na aba Vistoria e documentos, que existe dentro do imovel, do contrato e do cliente. Escolha o tipo, anexe fotos ou PDF, e o arquivo fica em area privada: cada abertura gera um link que expira em uma hora.',
    tags: 'vistoria documento contrato assinado anexo pdf arquivo matricula rg',
  },
  {
    p: 'Nao consigo anexar documento, o botao recusa',
    r: 'Documentos sao enviados por administrador, gerente e financeiro. Corretor envia foto de anuncio, mas nao documento, porque essa area guarda dado pessoal do inquilino. Se a sua operacao precisa que o corretor envie a vistoria, fale com o suporte: da para liberar so a vistoria.',
    tags: 'documento permissao corretor cargo anexo vistoria negado',
  },
  {
    p: 'Uma pessoa da equipe nao consegue editar contrato',
    r: 'Provavelmente o cargo dela e corretor, que tem apenas leitura em contratos e financeiro. Confira em Usuarios e ajuste se for o caso.',
    tags: 'usuario cargo permissao corretor contrato editar',
  },
  {
    p: 'Como adiciono alguem na equipe',
    r: 'Em Usuarios, botao Novo usuario. Defina o cargo e uma senha inicial. No fim aparece um bloco com e-mail, senha e o codigo da imobiliaria: os tres que a pessoa digita no login. Oriente a trocar a senha no primeiro acesso.',
    tags: 'usuario equipe novo acesso senha convidar cadastrar',
  },
  {
    p: 'Alguem saiu da empresa, apago o usuario',
    r: 'Nao apague, desative. Em Usuarios, o icone da pessoa com X corta o acesso na hora e mantem o historico do que ela fez integro na Auditoria. O sistema tambem nao deixa a imobiliaria ficar sem nenhum administrador ativo.',
    tags: 'usuario desativar excluir demitir acesso remover',
  },
  {
    p: 'Esqueci minha senha',
    r: 'Use Esqueci minha senha na tela de entrada para receber o link por e-mail, ou peca ao administrador para gerar uma nova em Usuarios, no icone da chave.',
    tags: 'senha esqueci login redefinir acesso',
  },
  {
    p: 'Qual e o codigo da imobiliaria que o login pede',
    r: 'Sao seis digitos, iguais para toda a equipe e fixos. Ele aparece no rodape do menu a esquerda sempre que alguem esta logado, e um clique ali copia o codigo.',
    tags: 'codigo login acesso seis digitos entrar equipe',
  },
  {
    p: 'Outra imobiliaria consegue ver a minha carteira',
    r: 'Nao. A separacao e feita no proprio banco de dados, nao na tela: o dado de outra imobiliaria nao e devolvido, por nenhum caminho. Nem quem administra a plataforma le seus imoveis, contratos, clientes ou financeiro. Ele ve so o nome, o codigo e as quantidades.',
    tags: 'seguranca privacidade dados isolamento lgpd outra imobiliaria',
  },
  {
    p: 'Um contrato esta vencendo, o sistema avisa',
    r: 'Sim. A tela de Contratos destaca quem entra nos ultimos 90 e nos ultimos 30 dias de vigencia, e o Painel repete o alerta na abertura, para dar tempo de negociar a renovacao.',
    tags: 'contrato vencimento renovacao alerta aviso prazo',
  },
  {
    p: 'O que marca uma cobranca como atrasada',
    r: 'O que venceu e continua em aberto vira atrasado sozinho, toda vez que alguem abre o Painel. O botao Atualizar atrasos, no Financeiro, forca essa verificacao na hora.',
    tags: 'atraso inadimplencia cobranca vencido financeiro',
  },
  {
    p: 'Preciso saber quem alterou um cadastro',
    r: 'A tela Auditoria registra toda criacao, alteracao e exclusao, com o antes e o depois campo a campo. Ninguem edita nem apaga esse historico, nem o administrador.',
    tags: 'auditoria historico alteracao quem mudou log',
  },
]

/* --------------------------------------------------------------- a tela -- */

export default function Ajuda() {
  const { perfil, imobiliaria } = useAuth()
  const [aba, setAba] = useState<'guia' | 'faq'>('guia')
  const [busca, setBusca] = useState('')

  const filtradas = useMemo(() => {
    const termo = busca.trim().toLowerCase()
    if (!termo) return FAQ
    return FAQ.filter((f) =>
      `${f.p} ${f.r} ${f.tags}`.toLowerCase().includes(termo),
    )
  }, [busca])

  return (
    <div>
      <div className="abas">
        <button
          className={`aba ${aba === 'guia' ? 'aba--ativa' : ''}`}
          onClick={() => setAba('guia')}
        >
          Guia rapido
        </button>
        <button
          className={`aba ${aba === 'faq' ? 'aba--ativa' : ''}`}
          onClick={() => setAba('faq')}
        >
          Perguntas frequentes
        </button>
      </div>

      {aba === 'guia' ? (
        <div className="grade grade--2 ajuda-grade">
          {/* ---------------------------------------------------- sequencia -- */}
          <section className="card">
            <div className="card__topo">
              <ListOrdered size={16} />
              <span className="card__titulo">A rotina em 5 passos</span>
            </div>
            <div className="card__corpo">
              <p className="t-2 t-xs mt-0">
                Esta ordem nao e sugestao: cada passo precisa do anterior. Um contrato
                exige imovel e inquilino ja cadastrados, e o imovel exige um proprietario.
              </p>
              <ol className="passos">
                {FLUXO.map((p, i) => (
                  <li key={p.titulo}>
                    <span className="passos__n">{i + 1}</span>
                    <div>
                      <strong>{p.titulo}</strong>
                      <p>{p.texto}</p>
                    </div>
                  </li>
                ))}
              </ol>
            </div>
          </section>

          <div className="coluna">
            {/* ------------------------------------------------ o dinheiro -- */}
            <section className="card">
              <div className="card__topo">
                <Wallet size={16} />
                <span className="card__titulo">Como o dinheiro entra</span>
              </div>
              <div className="card__corpo">
                <p className="t-2 t-xs mt-0">
                  Cada mes da vigencia gera tres lancamentos. Entender os tres resolve
                  quase toda duvida de financeiro.
                </p>
                <ul className="tres">
                  <li>
                    <span className="tres__pt tres__pt--entra" />
                    <span>
                      <strong>Aluguel a receber</strong> — o que o inquilino paga:
                      aluguel mais condominio e IPTU, quando previstos.
                    </span>
                  </li>
                  <li>
                    <span className="tres__pt tres__pt--sai" />
                    <span>
                      <strong>Repasse ao proprietario</strong> — o aluguel menos a taxa
                      de administracao.
                    </span>
                  </li>
                  <li>
                    <span className="tres__pt tres__pt--taxa" />
                    <span>
                      <strong>Taxa de administracao</strong> — a receita da imobiliaria,
                      separada desde a origem.
                    </span>
                  </li>
                </ul>
              </div>
            </section>

            {/* -------------------------------------------------- arquivos -- */}
            <section className="card">
              <div className="card__topo">
                <Images size={16} />
                <span className="card__titulo">Fotos e documentos</span>
              </div>
              <div className="card__corpo">
                <p className="t-2 t-xs mt-0">
                  Sao dois lugares diferentes, de proposito.
                </p>
                <p className="t-xs mt-2">
                  <strong>Fotos do anuncio</strong> ficam em area publica, para poderem
                  ser usadas na divulgacao. A primeira enviada vira a capa do card.
                </p>
                <p className="t-xs mt-2">
                  <strong>Vistoria e documentos</strong> ficam em area fechada: carregam
                  CPF, RG, renda e assinatura. Cada abertura gera um link que expira em
                  uma hora.
                </p>
                <div className="aviso aviso--alerta mt-2">
                  <ShieldCheck size={15} />
                  <span>Nunca coloque documento pessoal na aba de fotos do anuncio.</span>
                </div>
              </div>
            </section>

            {/* ----------------------------------------------------- acesso -- */}
            <section className="card">
              <div className="card__topo">
                <KeyRound size={16} />
                <span className="card__titulo">Acesso da equipe</span>
              </div>
              <div className="card__corpo">
                <p className="t-2 t-xs mt-0">
                  O login pede tres informacoes: e-mail, senha e o codigo da
                  imobiliaria. Ninguem se cadastra sozinho — quem cria acessos e o
                  administrador, em Usuarios.
                </p>
                {imobiliaria && (
                  <p className="t-xs mt-2">
                    Codigo da {imobiliaria.nome}:{' '}
                    <span className="codigo">{imobiliaria.codigo}</span>
                  </p>
                )}
                {perfil && (
                  <p className="t-xs mt-2 t-2">
                    Seu cargo aqui e <strong>{LABEL_CARGO[perfil.cargo]}</strong>. Ele
                    decide o que voce ve e o que pode alterar.
                  </p>
                )}
              </div>
            </section>
          </div>
        </div>
      ) : (
        /* -------------------------------------------------------------- faq -- */
        <div>
          <div className="barra">
            <div className="busca">
              <Search size={15} />
              <input
                className="input"
                placeholder="Buscar por palavra: parcela, senha, vistoria, atraso..."
                value={busca}
                onChange={(e) => setBusca(e.target.value)}
              />
            </div>
            <div className="barra__dir">
              <span className="contador">
                {filtradas.length} de {FAQ.length}
              </span>
            </div>
          </div>

          {filtradas.length === 0 ? (
            <Vazio
              icone={<LifeBuoy size={22} />}
              titulo="Nenhuma pergunta encontrada"
              texto="Tente outra palavra, ou fale com o administrador da sua imobiliaria."
            />
          ) : (
            <div className="faq">
              {filtradas.map((f) => (
                <details key={f.p} className="faq__item">
                  <summary>{f.p}</summary>
                  <p>{f.r}</p>
                </details>
              ))}
            </div>
          )}
        </div>
      )}
    </div>
  )
}
