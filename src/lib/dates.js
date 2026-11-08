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
  return new Date(value).toLocaleDateString('ar-EG', { year: 'numeric', month: '2-digit', day: '2-digit' })
}

// الوحدات المرجّحة = مجموع (العدد × وزن العملية)
export function weightedUnits(entries, operationsById) {
  return entries.reduce((sum, e) => {
    const w = operationsById[e.operation_id]?.weight ?? 0
    return sum + Number(e.quantity) * Number(w)
  }, 0)
}

export function formatNumber(n) {
  return new Intl.NumberFormat('ar-EG', { maximumFractionDigits: 2 }).format(Number(n) || 0)
}
