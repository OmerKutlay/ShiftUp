/**
 * pdf — rapor tablolarını tarayıcıda A4 PDF olarak üretir ve indirir.
 *
 * jsPDF ve tablo eklentisi yalnızca indirme anında yüklenir (sayfa paketine girmez). Yerleşik PDF
 * fontları Türkçe karakterleri (ğ ş ı İ) basamadığından Roboto gömülür: /public/fonts altındaki dosyalar
 * Latin + Latin Genişletilmiş-A alt kümesidir (Apache 2.0 lisanslı, Google). PDF'e yalnızca kullanılan
 * glifler yazılır.
 */
import type { CellDef, Styles, UserOptions } from 'jspdf-autotable'
import { saveBlob } from './download'
import { generatedAtTr } from './fileName'

/** Gövde satırı: hücreler ya da tüm genişliği kaplayan grup başlığı */
export type PdfRow = Array<string | number> | { group: string }

export interface PdfTable {
  title: string
  /** Başlığın altındaki satır (dönem, mağaza) */
  subtitle?: string
  /** Tablodan önce küçük puntoyla yazılan ek bilgiler (filtre, özet) */
  meta?: string[]
  head: string[]
  body: PdfRow[]
  /** Son sayfada tablonun altında kalın toplam satırı */
  foot?: Array<string | number>
  /** Tablonun altına yazılan açıklamalar (kod listesi vb.) */
  notes?: string[]
  orientation?: 'portrait' | 'landscape'
  fontSize?: number
  columnStyles?: Record<number, Partial<Styles>>
  /** Gövde hücresine özel stil (ör. tatil sütunu zemini); satır indeksi gövde satırları içindedir */
  cellStyle?: (row: number, col: number) => Partial<Styles> | undefined
  filename: string
}

const FONT = 'Roboto'
const MARGIN = 10
const INK: [number, number, number] = [20, 20, 20]
const HEAD_FILL: [number, number, number] = [228, 228, 231]
const GROUP_FILL: [number, number, number] = [244, 244, 245]

let fontsPromise: Promise<[string, string]> | null = null

async function fontBase64(url: string): Promise<string> {
  const res = await fetch(url)
  if (!res.ok) throw new Error('PDF yazı tipi yüklenemedi. Bağlantınızı kontrol edip tekrar deneyin.')
  const bytes = new Uint8Array(await res.arrayBuffer())
  let bin = ''
  for (let i = 0; i < bytes.length; i += 0x8000) bin += String.fromCharCode(...bytes.subarray(i, i + 0x8000))
  return btoa(bin)
}

function loadFonts(): Promise<[string, string]> {
  fontsPromise ??= Promise.all([fontBase64('/fonts/Roboto-Regular.ttf'), fontBase64('/fonts/Roboto-Bold.ttf')])
    .catch((err) => {
      fontsPromise = null // bir sonraki denemede yeniden indirilsin
      throw err
    })
  return fontsPromise
}

/**
 * PDF motoru yalnızca tarayıcıda yüklenir. `typeof window` derlemede sabitlenir: sunucu (SSR) paketinde bu
 * dal ölü kod olur ve jsPDF Worker paketine girmez (ücretsiz planın 3 MiB sınırı).
 */
function loadEngine() {
  return typeof window === 'undefined'
    ? Promise.reject(new Error('PDF yalnızca tarayıcıda üretilebilir.'))
    : Promise.all([import('jspdf'), import('jspdf-autotable')])
}

export async function downloadPdf(t: PdfTable): Promise<void> {
  const [[{ jsPDF }, { autoTable }], [regular, bold]] = await Promise.all([loadEngine(), loadFonts()])

  const doc = new jsPDF({ orientation: t.orientation ?? 'portrait', unit: 'mm', format: 'a4', compress: true })
  doc.addFileToVFS('Roboto-Regular.ttf', regular)
  doc.addFont('Roboto-Regular.ttf', FONT, 'normal')
  doc.addFileToVFS('Roboto-Bold.ttf', bold)
  doc.addFont('Roboto-Bold.ttf', FONT, 'bold')
  doc.setProperties({ title: t.title, creator: 'ShiftUp' })

  const pageWidth = doc.internal.pageSize.getWidth()
  const pageHeight = doc.internal.pageSize.getHeight()
  doc.setTextColor(...INK)

  // ── Başlık bloğu (yalnızca ilk sayfa) ──
  let y = MARGIN + 5
  doc.setFont(FONT, 'bold').setFontSize(14).text(t.title, MARGIN, y)
  doc.setFont(FONT, 'normal').setFontSize(8).text(`Oluşturma: ${generatedAtTr()}`, pageWidth - MARGIN, y, { align: 'right' })
  if (t.subtitle) {
    y += 5.5
    doc.setFontSize(10).text(t.subtitle, MARGIN, y)
  }
  for (const line of t.meta ?? []) {
    const wrapped = doc.setFontSize(8).splitTextToSize(line, pageWidth - 2 * MARGIN) as string[]
    y += 4.5
    doc.text(wrapped, MARGIN, y)
    y += (wrapped.length - 1) * 3.5
  }

  const groupStyles: Partial<Styles> = { fillColor: GROUP_FILL, fontStyle: 'bold', halign: 'left' }
  const body = t.body.map((r): Array<string | number | CellDef> =>
    Array.isArray(r) ? r : [{ content: r.group, colSpan: t.head.length, styles: groupStyles }]
  )
  const options: UserOptions = {
    startY: y + 4,
    margin: { top: MARGIN, right: MARGIN, bottom: MARGIN + 4, left: MARGIN },
    theme: 'grid',
    head: [t.head],
    body,
    foot: t.foot ? [t.foot] : undefined,
    showHead: 'everyPage',
    showFoot: 'lastPage',
    rowPageBreak: 'avoid',
    styles: {
      font: FONT,
      fontSize: t.fontSize ?? 8,
      cellPadding: 1.2,
      textColor: INK,
      lineColor: [170, 170, 175],
      lineWidth: 0.1,
      valign: 'middle',
      overflow: 'linebreak',
    },
    headStyles: { fillColor: HEAD_FILL, textColor: INK, fontStyle: 'bold' },
    footStyles: { fillColor: HEAD_FILL, textColor: INK, fontStyle: 'bold' },
    columnStyles: t.columnStyles,
    didParseCell: (data) => {
      // Başlık ve toplam satırı sütunun hizasını izler (sayı sütunlarında sağa)
      if (data.section !== 'body') {
        const halign = t.columnStyles?.[data.column.index]?.halign
        if (halign) data.cell.styles.halign = halign
        return
      }
      // data.row.index = t.body indeksi (grup satırları da birer satırdır; onlara cellStyle uygulanmaz)
      if (!t.cellStyle || !Array.isArray(t.body[data.row.index])) return
      const extra = t.cellStyle(data.row.index, data.column.index)
      if (extra) Object.assign(data.cell.styles, extra)
    },
  }
  autoTable(doc, options)

  // ── Notlar ──
  if (t.notes?.length) {
    const last = (doc as unknown as { lastAutoTable?: { finalY: number } }).lastAutoTable
    let ny = (last?.finalY ?? y) + 5
    doc.setFont(FONT, 'normal').setFontSize(7.5)
    for (const note of t.notes) {
      const wrapped = doc.splitTextToSize(note, pageWidth - 2 * MARGIN) as string[]
      if (ny + wrapped.length * 3.4 > pageHeight - MARGIN - 4) {
        doc.addPage()
        ny = MARGIN + 4
      }
      doc.text(wrapped, MARGIN, ny)
      ny += wrapped.length * 3.4 + 1
    }
  }

  // ── Sayfa altı: rapor adı + sayfa numarası (tüm sayfalar) ──
  const pages = doc.getNumberOfPages()
  doc.setFont(FONT, 'normal').setFontSize(7).setTextColor(110, 110, 115)
  for (let p = 1; p <= pages; p++) {
    doc.setPage(p)
    doc.text(t.title, MARGIN, pageHeight - MARGIN + 2)
    doc.text(`Sayfa ${p} / ${pages}`, pageWidth - MARGIN, pageHeight - MARGIN + 2, { align: 'right' })
  }

  saveBlob(doc.output('blob'), t.filename)
}
