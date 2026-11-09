import * as XLSX from 'xlsx'

// يصدّر ملف Excel حقيقي (.xlsx) من رؤوس أعمدة + صفوف
// rows: مصفوفة صفوف، كل صف مصفوفة قيم (نفس ترتيب headers)
export function exportXlsx({
  filename,
  sheetName = 'Report',
  headers = [],
  rows = [],
  title,
  meta = [],
  footer,
}) {
  const aoa = []
  if (title) aoa.push([title])
  for (const line of meta) aoa.push(line)
  if (title || meta.length) aoa.push([])
  aoa.push(headers)
  for (const row of rows) aoa.push(row)
  if (footer) aoa.push(footer)

  const ws = XLSX.utils.aoa_to_sheet(aoa)
  ws['!cols'] = headers.map((h) => ({ wch: Math.min(28, Math.max(12, String(h).length + 6)) }))
  ws['!views'] = [{ RTL: true }]

  const wb = XLSX.utils.book_new()
  XLSX.utils.book_append_sheet(wb, ws, sheetName)
  XLSX.writeFile(wb, filename)
}

// يصدّر ملف Excel فيه أكتر من ورقة (sheet) في نفس الملف
// sheets: [{ sheetName, headers, rows, title, meta, footer }]
export function exportXlsxSheets({ filename, sheets = [] }) {
  const wb = XLSX.utils.book_new()
  for (const s of sheets) {
    const aoa = []
    if (s.title) aoa.push([s.title])
    for (const line of s.meta ?? []) aoa.push(line)
    if (s.title || (s.meta ?? []).length) aoa.push([])
    aoa.push(s.headers ?? [])
    for (const row of s.rows ?? []) aoa.push(row)
    if (s.footer) aoa.push(s.footer)

    const ws = XLSX.utils.aoa_to_sheet(aoa)
    ws['!cols'] = (s.headers ?? []).map((h) => ({ wch: Math.min(28, Math.max(12, String(h).length + 6)) }))
    ws['!views'] = [{ RTL: true }]
    XLSX.utils.book_append_sheet(wb, ws, (s.sheetName ?? 'Sheet').slice(0, 31))
  }
  XLSX.writeFile(wb, filename)
}
