/**
 * Gera o contrato de um modelo, com os dados reais da locacao.
 *
 * Busca as partes na abertura -- imovel, proprietario, inquilino, fiador -- e
 * mostra o texto ja resolvido antes de gerar o PDF. A previa importa: e a
 * ultima chance de ver uma clausula errada antes do documento existir.
 *
 * O PDF pode ser baixado ou arquivado como `minuta` nos anexos do contrato.
 * Minuta, e nao contrato assinado: assinatura vem depois.
 */
import { useCallback, useEffect, useMemo, useState } from 'react'
import { AlertTriangle, Download, FileSignature, Save } from 'lucide-react'
import { supabase } from '@/lib/supabase'
import { useAuth } from '@/contexts/AuthContext'
import { useToast } from '@/contexts/ToastContext'
import { Modal, Vazio, Carregando } from '@/components/ui'
import {
  BUCKET_DOCUMENTOS, caminhoArquivo, enviarObjeto, removerObjeto,
} from '@/lib/arquivos'
import {
  marcadoresSemDado, resolverMarcadores, type DadosContrato,
} from '@/lib/contratoTexto'
import { gerarPdfContrato, ordinalClausula, signatarios } from '@/lib/contratoPdf'
import type {
  Cliente, ContratoCompleto, Imovel, ModeloContrato, Proprietario,
} from '@/lib/types'

type Props = {
  aberto: boolean
  aoFechar: () => void
  contrato: ContratoCompleto | null
  /** Recarrega a lista de anexos da tela de contratos apos arquivar. */
  aoArquivar?: () => void
}

export function GerarContrato({ aberto, aoFechar, contrato, aoArquivar }: Props) {
  const { perfil, imobiliaria, pode } = useAuth()
  const { ok, erro: toastErro } = useToast()

  const [modelos, setModelos] = useState<ModeloContrato[]>([])
  const [modeloId, setModeloId] = useState('')
  const [dados, setDados] = useState<DadosContrato | null>(null)
  const [carregando, setCarregando] = useState(true)
  const [gerando, setGerando] = useState(false)

  const podeArquivar = pode('admin', 'gerente', 'financeiro')

  const carregar = useCallback(async () => {
    if (!contrato) return
    setCarregando(true)

    const [rModelos, rImovel, rInquilino, rFiador] = await Promise.all([
      supabase.from('modelos_contrato').select('*').eq('ativo', true).order('padrao', { ascending: false }).order('nome'),
      supabase.from('imoveis').select('*').eq('id', contrato.imovel_id).maybeSingle(),
      supabase.from('clientes').select('*').eq('id', contrato.inquilino_id).maybeSingle(),
      contrato.fiador_id
        ? supabase.from('clientes').select('*').eq('id', contrato.fiador_id).maybeSingle()
        : Promise.resolve({ data: null, error: null }),
    ])

    const imovel = (rImovel.data ?? null) as Imovel | null

    // O locador e o dono do imovel; o contrato nao guarda essa ligacao direta.
    let locador: Proprietario | null = null
    if (imovel?.proprietario_id) {
      const { data } = await supabase
        .from('proprietarios').select('*').eq('id', imovel.proprietario_id).maybeSingle()
      locador = (data ?? null) as Proprietario | null
    }

    const lista = rModelos.data ?? []
    setModelos(lista)
    setModeloId((atual) => atual || lista.find((m) => m.padrao)?.id || lista[0]?.id || '')

    setDados({
      contrato,
      imovel,
      locador,
      locatario: (rInquilino.data ?? null) as Cliente | null,
      fiador: (rFiador.data ?? null) as Cliente | null,
      imobiliaria: imobiliaria ?? null,
    })
    setCarregando(false)
  }, [contrato, imobiliaria])

  useEffect(() => {
    if (aberto) void carregar()
  }, [aberto, carregar])

  const modelo = modelos.find((m) => m.id === modeloId) ?? null

  /** Textos resolvidos, para a previa e para a checagem de campos faltando. */
  const previa = useMemo(() => {
    if (!modelo || !dados) return null
    const textos = [
      modelo.cabecalho ?? '',
      ...modelo.clausulas.map((c) => c.texto),
      modelo.rodape ?? '',
    ]
    return {
      cabecalho: resolverMarcadores(modelo.cabecalho ?? '', dados),
      clausulas: modelo.clausulas.map((c, i) => ({
        titulo: `CLAUSULA ${ordinalClausula(i)} - ${c.titulo.toUpperCase()}`,
        texto: resolverMarcadores(c.texto, dados),
      })),
      rodape: resolverMarcadores(modelo.rodape ?? '', dados),
      faltando: marcadoresSemDado(textos, dados),
    }
  }, [modelo, dados])

  function nomeArquivo(): string {
    return `Contrato ${contrato?.numero ?? 'sem numero'}.pdf`
  }

  async function baixar() {
    if (!modelo || !dados) return
    setGerando(true)
    try {
      const blob = await gerarPdfContrato(modelo, dados)
      const url = URL.createObjectURL(blob)
      const a = document.createElement('a')
      a.href = url
      a.download = nomeArquivo()
      a.click()
      URL.revokeObjectURL(url)
    } catch (e) {
      toastErro('Nao foi possivel gerar o PDF', e instanceof Error ? e.message : undefined)
    }
    setGerando(false)
  }

  async function arquivar() {
    if (!modelo || !dados || !contrato) return
    const tenant = perfil?.imobiliaria_id
    if (!tenant) return toastErro('Sessao sem imobiliaria definida')

    setGerando(true)
    try {
      const blob = await gerarPdfContrato(modelo, dados)
      const caminho = caminhoArquivo(tenant, 'contratos', contrato.id, nomeArquivo())

      const { erro } = await enviarObjeto(BUCKET_DOCUMENTOS, caminho, blob, 'application/pdf')
      if (erro) {
        toastErro('Falhou ao enviar o arquivo', erro)
        setGerando(false)
        return
      }

      const { error } = await supabase.from('documentos').insert({
        imobiliaria_id: tenant,
        tipo: 'minuta',
        titulo: `Minuta - ${modelo.nome}`,
        contrato_id: contrato.id,
        path: caminho,
        nome_arquivo: nomeArquivo(),
        mime: 'application/pdf',
        tamanho: blob.size,
      })

      if (error) {
        // Sem a linha, o PDF viraria lixo invisivel no bucket.
        await removerObjeto(BUCKET_DOCUMENTOS, [caminho])
        toastErro('Falhou ao registrar o anexo', error.message)
        setGerando(false)
        return
      }

      ok('Minuta arquivada', 'Esta na aba de anexos do contrato.')
      aoArquivar?.()
      aoFechar()
    } catch (e) {
      toastErro('Nao foi possivel gerar o PDF', e instanceof Error ? e.message : undefined)
    }
    setGerando(false)
  }

  return (
    <Modal
      aberto={aberto}
      aoFechar={aoFechar}
      titulo="Gerar contrato"
      subtitulo={contrato?.numero ?? undefined}
      tamanho="xl"
      rodape={
        <>
          <button className="btn btn--secundario" onClick={aoFechar} disabled={gerando}>
            Fechar
          </button>
          <button
            className="btn btn--secundario"
            onClick={() => void baixar()}
            disabled={gerando || !modelo}
          >
            <Download size={14} /> Baixar PDF
          </button>
          {podeArquivar && (
            <button
              className="btn btn--primario"
              onClick={() => void arquivar()}
              disabled={gerando || !modelo}
            >
              {gerando && <span className="spin spin--sm spin--claro" />}
              <Save size={14} /> Arquivar nos anexos
            </button>
          )}
        </>
      }
    >
      {carregando || !dados ? (
        <Carregando texto="Reunindo os dados da locacao..." />
      ) : modelos.length === 0 ? (
        <Vazio
          icone={<FileSignature size={22} />}
          titulo="Nenhum modelo cadastrado"
          texto="Crie um modelo em Administracao > Modelos de contrato. La existe um de locacao residencial pronto para comecar."
        />
      ) : (
        <div className="form-grade">
          <div className="col-12 linha linha--entre">
            <select
              className="select"
              value={modeloId}
              onChange={(e) => setModeloId(e.target.value)}
              style={{ maxWidth: 320 }}
              aria-label="Modelo de contrato"
            >
              {modelos.map((m) => (
                <option key={m.id} value={m.id}>
                  {m.nome}{m.padrao ? ' (padrao)' : ''}
                </option>
              ))}
            </select>
            <span className="t-2 t-xs">
              {signatarios(dados).length} assinaturas no documento
            </span>
          </div>

          {previa && previa.faltando.length > 0 && (
            <div className="col-12">
              <div className="aviso aviso--alerta">
                <AlertTriangle size={16} />
                <span>
                  <strong>{previa.faltando.length} campo(s) sem dado</strong> vao sair como
                  “[campo nao preenchido]”: {previa.faltando.join(', ')}. Complete o
                  cadastro antes de usar este contrato com o cliente.
                </span>
              </div>
            </div>
          )}

          <div className="col-12">
            <div className="minuta">
              {previa?.cabecalho.split('\n').map((l, i) => (
                <p key={`c${i}`} className={i === 0 ? 'minuta__titulo' : undefined}>{l}</p>
              ))}

              {previa?.clausulas.map((c, i) => (
                <div key={i} className="minuta__clausula">
                  <p className="minuta__cl-titulo">{c.titulo}</p>
                  <p>{c.texto}</p>
                </div>
              ))}

              {previa?.rodape.split('\n').map((l, i) => (
                <p key={`r${i}`}>{l}</p>
              ))}

              <div className="minuta__assinaturas">
                {signatarios(dados).map((s) => (
                  <div key={s.papel} className="minuta__assina">
                    <span className="minuta__linha" />
                    <strong>{s.papel}</strong>
                    {s.nome && <span> {s.nome}</span>}
                  </div>
                ))}
              </div>
            </div>
          </div>
        </div>
      )}
    </Modal>
  )
}
