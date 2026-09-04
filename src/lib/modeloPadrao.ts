/**
 * Modelo inicial de contrato de locacao residencial.
 *
 * Ponto de partida, NAO peca juridica pronta: cada imobiliaria tem praxe
 * propria, e clausula de contrato e assunto de advogado. A tela avisa isso ao
 * oferecer o modelo, e tudo aqui e editavel.
 *
 * Este arquivo usa acentuacao, ao contrario do resto do codigo: o texto vai
 * impresso num contrato que alguem assina, e "Locatario" num documento juridico
 * fica relaxado.
 */
import type { Clausula } from '@/lib/contratoTexto'

export const CABECALHO_PADRAO = `CONTRATO DE LOCAÇÃO DE IMÓVEL RESIDENCIAL

LOCADOR: {{locador.nome}}, inscrito no CPF/CNPJ sob o nº {{locador.cpf}}, portador do RG {{locador.rg}}, residente e domiciliado em {{locador.endereco}}.

LOCATÁRIO: {{locatario.nome}}, {{locatario.estadocivil}}, {{locatario.profissao}}, inscrito no CPF/CNPJ sob o nº {{locatario.cpf}}, portador do RG {{locatario.rg}}, residente e domiciliado em {{locatario.endereco}}.

ADMINISTRADORA: {{imobiliaria.nome}}, inscrita no CNPJ sob o nº {{imobiliaria.cpf}}, que administra a presente locação em nome e por conta do LOCADOR.

As partes acima qualificadas têm entre si justo e contratado o presente Contrato de Locação de Imóvel Residencial, regido pela Lei nº 8.245/91 e pelas cláusulas e condições seguintes.`

export const CLAUSULAS_PADRAO: Clausula[] = [
  {
    titulo: 'DO OBJETO',
    texto:
      'O LOCADOR dá em locação ao LOCATÁRIO o imóvel situado em {{imovel.endereco}}, ' +
      'cadastrado sob o código {{imovel.codigo}}, destinado exclusivamente à residência ' +
      'do LOCATÁRIO e de seus familiares, sendo vedada a mudança de destinação sem ' +
      'autorização escrita do LOCADOR.',
  },
  {
    titulo: 'DO PRAZO',
    texto:
      'A locação vigorará pelo prazo de {{contrato.meses}} meses, com início em ' +
      '{{contrato.inicio}} e término em {{contrato.fim}}, data em que o LOCATÁRIO se ' +
      'obriga a devolver o imóvel desocupado e nas condições em que o recebeu, ' +
      'independentemente de aviso ou notificação.',
  },
  {
    titulo: 'DO ALUGUEL',
    texto:
      'O aluguel mensal é de {{contrato.aluguel}}, a ser pago até o dia ' +
      '{{contrato.vencimento}} de cada mês, por meio indicado pela ADMINISTRADORA. ' +
      'O atraso implicará multa de 2% sobre o valor em atraso, juros de mora de 1% ao ' +
      'mês e correção monetária, sem prejuízo das demais medidas cabíveis.',
  },
  {
    titulo: 'DO REAJUSTE',
    texto:
      'O aluguel será reajustado a cada 12 meses pela variação acumulada do ' +
      '{{contrato.reajuste}}, ou por outro índice que legalmente o substitua na hipótese ' +
      'de sua extinção.',
  },
  {
    titulo: 'DOS ENCARGOS',
    texto:
      'Correrão por conta do LOCATÁRIO as despesas de água, energia elétrica, gás, ' +
      'internet e demais serviços de consumo, bem como as despesas ordinárias de ' +
      'condomínio e o IPTU, quando previstos neste contrato. As despesas extraordinárias ' +
      'de condomínio, na forma do art. 22 da Lei nº 8.245/91, permanecem a cargo do ' +
      'LOCADOR.',
  },
  {
    titulo: 'DA GARANTIA',
    texto:
      'A presente locação é garantida na modalidade {{contrato.garantia}}, que ' +
      'permanecerá válida até a efetiva devolução das chaves e a quitação de todos os ' +
      'valores devidos, ainda que apurados posteriormente.',
  },
  {
    titulo: 'DA VISTORIA',
    texto:
      'O imóvel é entregue no estado descrito no laudo de vistoria de entrada, que passa ' +
      'a integrar este contrato para todos os fins. Ao término da locação será realizada ' +
      'nova vistoria, e o LOCATÁRIO responderá pelos danos que não decorram do uso normal ' +
      'do imóvel.',
  },
  {
    titulo: 'DA CONSERVAÇÃO E DAS BENFEITORIAS',
    texto:
      'O LOCATÁRIO obriga-se a conservar o imóvel e a devolvê-lo em perfeitas condições, ' +
      'com pintura em estado equivalente ao do recebimento. Benfeitorias úteis ou ' +
      'voluptuárias somente poderão ser realizadas mediante autorização escrita do ' +
      'LOCADOR, e não darão direito a indenização nem a retenção.',
  },
  {
    titulo: 'DAS OBRIGAÇÕES DO LOCATÁRIO',
    texto:
      'Cabe ao LOCATÁRIO: pagar pontualmente o aluguel e os encargos; comunicar de ' +
      'imediato ao LOCADOR qualquer dano ou defeito cuja reparação lhe caiba; permitir a ' +
      'vistoria do imóvel mediante aviso prévio; não sublocar, ceder ou emprestar o ' +
      'imóvel, no todo ou em parte, sem consentimento escrito; e observar o regulamento ' +
      'interno do condomínio, quando houver.',
  },
  {
    titulo: 'DAS OBRIGAÇÕES DO LOCADOR',
    texto:
      'Cabe ao LOCADOR: entregar o imóvel em condições de servir ao uso a que se destina; ' +
      'garantir ao LOCATÁRIO o uso pacífico durante a locação; responder pelos vícios ' +
      'anteriores à locação; e arcar com as despesas extraordinárias de condomínio e com ' +
      'os reparos estruturais do imóvel.',
  },
  {
    titulo: 'DA RESCISÃO E DA MULTA',
    texto:
      'A rescisão antecipada por iniciativa do LOCATÁRIO sujeita-o a multa equivalente a ' +
      'três aluguéis vigentes, reduzida proporcionalmente ao tempo já cumprido do ' +
      'contrato, na forma do art. 4º da Lei nº 8.245/91. O descumprimento de qualquer ' +
      'cláusula autoriza a rescisão de pleno direito, independentemente de notificação ' +
      'judicial ou extrajudicial.',
  },
  {
    titulo: 'DA DEVOLUÇÃO DO IMÓVEL',
    texto:
      'A entrega das chaves somente será aceita após a vistoria final, a comprovação da ' +
      'quitação dos aluguéis, encargos e contas de consumo, e a reparação de eventuais ' +
      'danos. Até a efetiva entrega das chaves, permanecem devidos o aluguel e todos os ' +
      'encargos.',
  },
  {
    titulo: 'DO FORO',
    texto:
      'As partes elegem o foro da comarca de {{imovel.cidade}}/{{imovel.estado}} para ' +
      'dirimir as questões oriundas deste contrato, com renúncia a qualquer outro, por ' +
      'mais privilegiado que seja.',
  },
]

export const RODAPE_PADRAO = `E por estarem assim justas e contratadas, as partes assinam o presente instrumento, juntamente com as testemunhas abaixo identificadas, para que produza seus jurídicos e legais efeitos.

{{imobiliaria.cidade}}, {{hoje.extenso}}.`
