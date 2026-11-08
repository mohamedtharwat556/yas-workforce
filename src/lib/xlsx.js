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
