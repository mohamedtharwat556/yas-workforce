// دوال مساعدة للتواريخ والحسابات

// أول يوم في الأسبوع (السبت كبداية الأسبوع)
export function startOfWeek(date = new Date()) {
  const d = new Date(date)
  const day = d.getDay() // 0 = الأحد ... 6 = السبت
  const diff = (day + 1) % 7 // إزاحة للسبت
  d.setDate(d.getDate() - diff)
  d.setHours(0, 0, 0, 0)
  return d
}

export function startOfMonth(date = new Date()) {
  const d = new Date(date)
  return new Date(d.getFullYear(), d.getMonth(), 1)
}

export function toISODate(date) {
  const d = new Date(date)
  const m = String(d.getMonth() + 1).padStart(2, '0')
  const day = String(d.getDate()).padStart(2, '0')
  return `${d.getFullYear()}-${m}-${day}`
}

export function formatDate(value) {
  if (!value) return '-'
  return new Date(value).toLocaleDateString('ar-EG-u-nu-latn', { year: 'numeric', month: '2-digit', day: '2-digit' })
}

// بنود الإدخال: كل بند = عملية + عدد.
// الإدخال الواحد يقدر يجمع أكتر من عملية (entry_operations).
// لو الإدخال مالوش بنود (بيانات قديمة)، بترجع العملية المفردة كبند واحد.
export function entryLines(entry) {
  const lines = Array.isArray(entry?.entry_operations) ? entry.entry_operations : null
  if (lines && lines.length) {
    return lines.map((l) => ({
      operation_id: l.operation_id,
      name: l.operations?.name_ar ?? '-',
      quantity: Number(l.quantity ?? 0),
    }))
  }
  return [
    {
      operation_id: entry?.operation_id,
      name: entry?.operations?.name_ar ?? '-',
      quantity: Number(entry?.quantity ?? 0),
    },
  ]
}

// إجمالي العدد في الإدخال (مجموع كل البنود)
export function entryTotalQty(entry) {
  return entryLines(entry).reduce((s, l) => s + l.quantity, 0)
}

// أسماء العمليات في الإدخال مفصولة بـ +
export function entryOperationNames(entry) {
  return entryLines(entry).map((l) => l.name).join(' + ')
}

// الأرقام كلها بالأرقام الإنجليزية (0-9) في كل الموقع
export function formatNumber(n) {
  return new Intl.NumberFormat('ar-EG-u-nu-latn', { maximumFractionDigits: 2 }).format(Number(n) || 0)
}
