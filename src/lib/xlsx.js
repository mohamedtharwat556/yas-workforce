import * as XLSX from 'xlsx'

// بنحوّل بيانات ورقة واحدة لصفوف (array of arrays).
// لو فيه blocks، بنكتبها ورا بعض في نفس الورقة وبنسيب سطر فاضي بين كل بلوك والتاني.
function sheetToAoa({ title, meta = [], headers = [], rows = [], blocks, footer }) {
  const aoa = []
  if (title) aoa.push([title])
  for (const line of meta) aoa.push(line)
  if (title || meta.length) aoa.push([])

  const list = blocks?.length ? blocks : [{ headers, rows }]
  list.forEach((b, i) => {
    if (i) aoa.push([])
    if (b.title) aoa.push([b.title])
    aoa.push(b.headers ?? [])
    for (const row of b.rows ?? []) aoa.push(row)
    if (b.footer) aoa.push(b.footer)
  })

  if (footer) aoa.push(footer)
  return { aoa, headers: list.flatMap((b) => b.headers ?? []) }
}

function widths(headers) {
  return headers.map((h) => ({ wch: Math.min(28, Math.max(12, String(h).length + 6)) }))
}

// يصدّر ملف Excel حقيقي (.xlsx) من رؤوس أعمدة + صفوف
// rows: مصفوفة صفوف، كل صف مصفوفة قيم (نفس ترتيب headers)
// blocks: [{ title, headers, rows, footer }] — بديل لـ headers/rows لو عايز أكتر من جدول في نفس الورقة
export function exportXlsx({
  filename,
  sheetName = 'Report',
  headers = [],
  rows = [],
  blocks,
  title,
  meta = [],
  footer,
}) {
  const { aoa, headers: allHeaders } = sheetToAoa({ title, meta, headers, rows, blocks, footer })

  const ws = XLSX.utils.aoa_to_sheet(aoa)
  ws['!cols'] = widths(allHeaders)
  ws['!views'] = [{ RTL: true }]

  const wb = XLSX.utils.book_new()
  XLSX.utils.book_append_sheet(wb, ws, sheetName)
  XLSX.writeFile(wb, filename)
}

// يصدّر ملف Excel فيه أكتر من ورقة (sheet) في نفس الملف
// sheets: [{ sheetName, headers, rows, blocks, title, meta, footer }]
export function exportXlsxSheets({ filename, sheets = [] }) {
  const wb = XLSX.utils.book_new()
  for (const s of sheets) {
    const { aoa, headers: allHeaders } = sheetToAoa(s)

    const ws = XLSX.utils.aoa_to_sheet(aoa)
    ws['!cols'] = widths(allHeaders)
    ws['!views'] = [{ RTL: true }]
    XLSX.utils.book_append_sheet(wb, ws, (s.sheetName ?? 'Sheet').slice(0, 31))
  }
  XLSX.writeFile(wb, filename)
}
