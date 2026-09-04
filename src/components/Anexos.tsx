/**
 * Anexos de um registro -- vistoria, contrato assinado, aditivo, identidade,
 * comprovante de renda, matricula.
 *
 * Vai tudo para o bucket privado `documentos`. Nada aqui tem URL permanente:
 * abrir um arquivo gera um link assinado que expira em uma hora. Esses arquivos
 * carregam CPF, RG, renda e assinatura -- e a diferenca em relacao as fotos de
 * anuncio, que sao publicas de proposito.
 *
 * Serve as tres telas com o mesmo codigo: muda so o escopo e a coluna de
 * vinculo, porque a tabela `documentos` tem uma FK para cada uma e um check que
 * obriga exatamente um vinculo preenchido.
 */
import { useCallback, useEffect, useRef, useState } from 'react'
import { Download, FileText, Paperclip, Trash2 } from 'lucide-react'
import { supabase } from '@/lib/supabase'
import { useAuth } from '@/contexts/AuthContext'
import { useToast } from '@/contexts/ToastContext'
import { Vazio } from '@/components/ui'
import { dataHora } from '@/lib/format'
import type { Documento, TipoDocumento } from '@/lib/types'
import {
  BUCKET_DOCUMENTOS,
  MIME_DOCUMENTO,
  ROTULO_TIPO,
  TIPOS_DOCUMENTO,
  caminhoArquivo,
  comprimirImagem,
  enviarObjeto,
  formatarTamanho,
  removerObjeto,
  urlAssinada,
  validarArquivo,
  type Escopo,
} from '@/lib/arquivos'

/** A coluna de vinculo de cada escopo, para filtrar e para gravar. */
const COLUNA: Record<Escopo, 'imovel_id' | 'contrato_id' | 'cliente_id'> = {
  imoveis: 'imovel_id',
  contratos: 'contrato_id',
  clientes: 'cliente_id',
}

type Props = {
  escopo: Escopo
  registroId: string
  /** Tipo ja selecionado ao abrir. Cada tela sugere o mais provavel. */
  tipoPadrao?: TipoDocumento
}

export function Anexos({ escopo, registroId, tipoPadrao = 'outro' }: Props) {
  const { comTenant, pode, perfil } = useAuth()
  const { ok, erro: toastErro } = useToast()

  const [docs, setDocs] = useState<Documento[]>([])
  const [carregando, setCarregando] = useState(true)
  const [enviando, setEnviando] = useState(false)
  const [tipo, setTipo] = useState<TipoDocumento>(tipoPadrao)
  const entrada = useRef<HTMLInputElement>(null)

  // Os mesmos cargos da policy `documentos_escrever` do Storage e da RLS da
  // tabela. Corretor le, mas nao anexa: o bucket guarda documento pessoal.
  const podeEditar = pode('admin', 'gerente', 'financeiro')
  const coluna = COLUNA[escopo]

  const carregar = useCallback(async () => {
    const { data, error } = await supabase
      .from('documentos')
      .select('*')
      .eq(coluna, registroId)
      .order('created_at', { ascending: false })

    if (error) toastErro('Nao foi possivel carregar os anexos', error.message)
    setDocs(data ?? [])
    setCarregando(false)
  }, [coluna, registroId, toastErro])

  useEffect(() => {
    void carregar()
  }, [carregar])

  async function enviar(lista: FileList | null) {
    if (!lista || lista.length === 0) return
    const tenant = perfil?.imobiliaria_id
    if (!tenant) return toastErro('Sessao sem imobiliaria definida')

    setEnviando(true)
    let enviados = 0

    for (const arquivo of Array.from(lista)) {
      const recusa = validarArquivo(arquivo, MIME_DOCUMENTO)
      if (recusa) {
        toastErro('Arquivo recusado', recusa)
        continue
      }

      // Foto de vistoria vem do celular e pesa; PDF passa intacto.
      const conteudo = await comprimirImagem(arquivo)
      const ehImagemConvertida = conteudo !== arquivo
      const mime = ehImagemConvertida ? 'image/jpeg' : arquivo.type || 'application/octet-stream'

      const caminho = caminhoArquivo(tenant, escopo, registroId, arquivo.name)

      const { erro } = await enviarObjeto(BUCKET_DOCUMENTOS, caminho, conteudo, mime)
      if (erro) {
        toastErro(`Falhou ao enviar "${arquivo.name}"`, erro)
        continue
      }

      // Vinculo montado por ramo, e nao com chave computada `[coluna]`: uma
      // chave dinamica faz o TypeScript alargar o objeto para assinatura de
      // indice e o insert perde a tipagem da tabela.
      // A anotacao colapsa a uniao dos tres ramos num tipo so; sem ela o
      // supabase-js escolhe o primeiro membro da uniao e reclama que as outras
      // duas colunas estao faltando.
      const vinculo: Partial<Pick<Documento, 'imovel_id' | 'contrato_id' | 'cliente_id'>> =
        escopo === 'imoveis'
          ? { imovel_id: registroId }
          : escopo === 'contratos'
            ? { contrato_id: registroId }
            : { cliente_id: registroId }

      const { error } = await supabase.from('documentos').insert(
        comTenant({
          tipo,
          ...vinculo,
          path: caminho,
          nome_arquivo: arquivo.name,
          mime,
          tamanho: conteudo.size,
        }),
      )

      if (error) {
        // Sem a linha, o binario viraria lixo invisivel no bucket.
        await removerObjeto(BUCKET_DOCUMENTOS, [caminho])
        toastErro(`Falhou ao registrar "${arquivo.name}"`, error.message)
        continue
      }

      enviados += 1
    }

    setEnviando(false)
    if (entrada.current) entrada.current.value = ''
    if (enviados > 0) {
      ok(enviados === 1 ? 'Anexo enviado' : `${enviados} anexos enviados`)
      await carregar()
    }
  }

  async function abrir(doc: Documento) {
    // A aba precisa ser aberta AGORA, dentro do clique. O link assinado so fica
    // pronto depois de uma ida ao servidor, e um window.open depois do await
    // perde o vinculo com o gesto do usuario -- o bloqueador de pop-up barra.
    const aba = window.open('', '_blank', 'noopener,noreferrer')

    const { url, erro } = await urlAssinada(doc.path)
    if (!url) {
      aba?.close()
      return toastErro('Nao foi possivel abrir o arquivo', erro ?? undefined)
    }

    if (aba) aba.location.href = url
    // Bloqueador impediu mesmo assim: navegar na propria aba e melhor do que
    // deixar o clique sem efeito nenhum.
    else window.location.href = url
  }

  async function excluir(doc: Documento) {
    const { error } = await supabase.from('documentos').delete().eq('id', doc.id)
    if (error) return toastErro('Nao foi possivel excluir', error.message)
    await removerObjeto(BUCKET_DOCUMENTOS, [doc.path])
    ok('Anexo excluido')
    await carregar()
  }

  return (
    <div className="col-12">
      <div className="linha linha--entre mb-2">
        <span className="t-2 t-xs">
          {carregando ? 'Carregando...' : `${docs.length} anexo(s)`}
          {docs.length > 0 && ' · o link de abertura expira em 1 hora'}
        </span>

        {podeEditar && (
          <div className="linha">
            <select
              className="select"
              value={tipo}
              onChange={(e) => setTipo(e.target.value as TipoDocumento)}
              disabled={enviando}
              aria-label="Tipo do anexo"
            >
              {TIPOS_DOCUMENTO.map((t) => (
                <option key={t} value={t}>
                  {ROTULO_TIPO[t]}
                </option>
              ))}
            </select>

            <input
              ref={entrada}
              type="file"
              accept={[...MIME_DOCUMENTO, '.pdf'].join(',')}
              multiple
              hidden
              onChange={(e) => void enviar(e.target.files)}
            />
            <button
              type="button"
              className="btn btn--secundario btn--sm"
              onClick={() => entrada.current?.click()}
              disabled={enviando}
            >
              {enviando ? <span className="spin spin--sm" /> : <Paperclip size={14} />}
              {enviando ? 'Enviando...' : 'Anexar'}
            </button>
          </div>
        )}
      </div>

      {!carregando && docs.length === 0 ? (
        <Vazio
          icone={<Paperclip size={22} />}
          titulo="Nenhum anexo"
          texto={
            podeEditar
              ? 'Escolha o tipo ao lado e envie fotos ou PDF. Ficam em area privada.'
              : 'Nenhum arquivo anexado a este registro.'
          }
        />
      ) : (
        <div className="tabela-wrap">
          <table className="tabela">
            <thead>
              <tr>
                <th>Arquivo</th>
                <th>Tipo</th>
                <th>Tamanho</th>
                <th>Enviado em</th>
                <th className="dir">Acoes</th>
              </tr>
            </thead>
            <tbody>
              {docs.map((d) => (
                <tr key={d.id}>
                  <td className="celula-forte">
                    <span className="linha">
                      <FileText size={14} />
                      {d.titulo ?? d.nome_arquivo}
                    </span>
                  </td>
                  <td>
                    <span className="badge badge--neutro">{ROTULO_TIPO[d.tipo]}</span>
                  </td>
                  <td className="t-num">{formatarTamanho(d.tamanho)}</td>
                  <td className="celula-fraca">{dataHora(d.created_at)}</td>
                  <td className="dir nowrap">
                    <button
                      type="button"
                      className="btn btn--fantasma btn--sm"
                      title="Abrir arquivo"
                      onClick={() => void abrir(d)}
                    >
                      <Download size={13} />
                    </button>
                    {podeEditar && (
                      <button
                        type="button"
                        className="btn btn--fantasma btn--sm"
                        title="Excluir anexo"
                        onClick={() => void excluir(d)}
                      >
                        <Trash2 size={13} color="var(--erro)" />
                      </button>
                    )}
                  </td>
                </tr>
              ))}
            </tbody>
          </table>
        </div>
      )}
    </div>
  )
}
