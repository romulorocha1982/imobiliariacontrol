/**
 * Monta o PDF do contrato a partir do modelo e dos dados reais.
 *
 * O jsPDF entra por import dinamico: sao uns 350 KB que so interessam a quem
 * clica em gerar contrato, e o Vite os separa num arquivo proprio em vez de
 * empurra-los para todo mundo que abre o sistema.
 *
 * Texto alinhado a esquerda, nao justificado. O `align: 'justify'` do jsPDF
 * estica tambem a ultima linha do paragrafo, que fica com as palavras espalhadas
 * pela largura da pagina -- pior do que a margem irregular que ele corrige.
 */
import { resolverMarcadores, type DadosContrato } from '@/lib/contratoTexto'
import type { ModeloContrato } from '@/lib/types'

/** Nomeia a clausula como se escreve em contrato: CLAUSULA PRIMEIRA. */
const ORDINAIS = [
  'PRIMEIRA', 'SEGUNDA', 'TERCEIRA', 'QUARTA', 'QUINTA', 'SEXTA', 'SETIMA',
  'OITAVA', 'NONA', 'DECIMA', 'DECIMA PRIMEIRA', 'DECIMA SEGUNDA',
  'DECIMA TERCEIRA', 'DECIMA QUARTA', 'DECIMA QUINTA', 'DECIMA SEXTA',
  'DECIMA SETIMA', 'DECIMA OITAVA', 'DECIMA NONA', 'VIGESIMA',
  'VIGESIMA PRIMEIRA', 'VIGESIMA SEGUNDA', 'VIGESIMA TERCEIRA',
  'VIGESIMA QUARTA', 'VIGESIMA QUINTA',
]

export function ordinalClausula(i: number): string {
  return ORDINAIS[i] ?? `${i + 1}a`
}

/* --------------------------------------------------------------- medidas -- */

const MARGEM = 20      // mm
const LARGURA = 170    // 210 - 2 * MARGEM
const TOPO = 24
const RODAPE = 272     // ultima linha util; A4 tem 297
const ENTRELINHA = 5.2

/**
 * Quem assina, e em que ordem. O fiador so entra quando a garantia e fiador e
 * ha um cadastrado -- linha de assinatura vazia num contrato e convite a
 * confusao.
 */
export function signatarios(d: DadosContrato): { papel: string; nome: string }[] {
  const lista = [
    { papel: 'LOCADOR', nome: d.locador?.nome ?? '' },
    { papel: 'LOCATARIO', nome: d.locatario?.nome ?? '' },
  ]
  if (d.contrato.garantia === 'fiador' && d.fiador) {
    lista.push({ papel: 'FIADOR', nome: d.fiador.nome })
  }
  lista.push({ papel: 'TESTEMUNHA 1', nome: '' })
  lista.push({ papel: 'TESTEMUNHA 2', nome: '' })
  return lista
}

export async function gerarPdfContrato(
  modelo: ModeloContrato,
  dados: DadosContrato,
): Promise<Blob> {
  const { jsPDF } = await import('jspdf')
  const doc = new jsPDF({ unit: 'mm', format: 'a4' })

  let y = TOPO

  /** Quebra de pagina antes de escrever, quando o que vem nao cabe. */
  function garantirEspaco(altura: number) {
    if (y + altura > RODAPE) {
      doc.addPage()
      y = TOPO
    }
  }

  function paragrafo(texto: string, opcoes: { negrito?: boolean; tamanho?: number } = {}) {
    const { negrito = false, tamanho = 10 } = opcoes
    doc.setFont('helvetica', negrito ? 'bold' : 'normal')
    doc.setFontSize(tamanho)

    for (const bloco of texto.split('\n')) {
      if (bloco.trim() === '') {
        y += ENTRELINHA * 0.6
        continue
      }
      const linhas: string[] = doc.splitTextToSize(bloco, LARGURA)
      for (const linha of linhas) {
        garantirEspaco(ENTRELINHA)
        doc.text(linha, MARGEM, y)
        y += ENTRELINHA
      }
    }
  }

  /* ------------------------------------------------------------ titulo -- */
  // A primeira linha do cabecalho e o titulo do documento; o resto e a
  // qualificacao das partes.
  const cabecalho = resolverMarcadores(modelo.cabecalho ?? '', dados)
  const [titulo, ...restoCabecalho] = cabecalho.split('\n')

  doc.setFont('helvetica', 'bold')
  doc.setFontSize(13)
  const tituloLinhas: string[] = doc.splitTextToSize(titulo || 'CONTRATO', LARGURA)
  for (const linha of tituloLinhas) {
    doc.text(linha, 105, y, { align: 'center' })
    y += 6
  }
  y += 4

  if (restoCabecalho.length > 0) {
    paragrafo(restoCabecalho.join('\n').trim())
    y += 3
  }

  /* --------------------------------------------------------- clausulas -- */
  modelo.clausulas.forEach((cl, i) => {
    // O titulo nunca fica sozinho no pe da pagina: reserva o espaco dele mais
    // duas linhas de texto antes de decidir a quebra.
    garantirEspaco(ENTRELINHA * 3)
    y += 3
    paragrafo(`CLAUSULA ${ordinalClausula(i)} - ${cl.titulo.toUpperCase()}`, { negrito: true })
    paragrafo(resolverMarcadores(cl.texto, dados))
  })

  /* ------------------------------------------------------------ rodape -- */
  if (modelo.rodape) {
    y += 5
    paragrafo(resolverMarcadores(modelo.rodape, dados))
  }

  /* ------------------------------------------------------- assinaturas -- */
  const partes = signatarios(dados)
  y += 8

  for (const p of partes) {
    // Linha, nome e papel formam um bloco de 20mm que nao pode ser partido.
    garantirEspaco(20)
    y += 10
    doc.setDrawColor(60)
    doc.line(MARGEM, y, MARGEM + 85, y)
    y += 4.5
    doc.setFont('helvetica', 'bold')
    doc.setFontSize(9)
    doc.text(p.papel, MARGEM, y)
    if (p.nome) {
      doc.setFont('helvetica', 'normal')
      doc.text(` ${p.nome}`, MARGEM + doc.getTextWidth(p.papel), y)
    }
    y += 2
  }

  /* ------------------------------------------------------ numeracao -- */
  const total = doc.getNumberOfPages()
  for (let i = 1; i <= total; i++) {
    doc.setPage(i)
    doc.setFont('helvetica', 'normal')
    doc.setFontSize(8)
    doc.setTextColor(120)
    doc.text(`Pagina ${i} de ${total}`, 105, 287, { align: 'center' })
    if (dados.contrato.numero) {
      doc.text(dados.contrato.numero, MARGEM, 287)
    }
    doc.setTextColor(0)
  }

  return doc.output('blob')
}
