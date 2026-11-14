import { useEffect, useMemo, useState } from 'react'
import Layout from '../components/Layout'
import { supabase } from '../lib/supabase'
import { formatDate, formatNumber, toISODate, entryOperationNames } from '../lib/dates'
import { exportXlsx } from '../lib/xlsx'

// صفحة الإنتاجية (للمشرف فقط): إنتاجية كل موظف على الإدخالات المعتمدة —
// الاسم + نوع التست + عدد اللابات، وتفصيل كل لاب (نوع اللاب + السيريال)،
// مع فلتر بالموظف وبحث شامل وتصدير Excel.
const APPROVED_STATUSES = ['approved', 'released', 'archived']

export default function Productivity() {
  const [entries, setEntries] = useState([])
  const [employees, setEmployees] = useState([])
  const [loading, setLoading] = useState(true)
  const [empFilter, setEmpFilter] = useState('')
  const [search, setSearch] = useState('')
  const [busyDelete, setBusyDelete] = useState(false)

  async function loadEntries() {
    setLoading(true)
    const { data } = await supabase
      .from('production_entries')
      .select(
        'id, entry_date, status, worker_id, operation_id, quantity, employees!production_entries_worker_id_fkey(full_name), operations(name_ar), entry_operations(operation_id, quantity, operations(name_ar)), lap_serials(serial, laptop_type, operation_id, operations(name_ar))'
      )
      .in('status', APPROVED_STATUSES)
      .order('entry_date', { ascending: false })
    setEntries(data ?? [])
    setLoading(false)
  }

  async function loadEmployees() {
    const { data } = await supabase
      .from('employees')
      .select('id, full_name')
      .eq('active', true)
      .order('sort_order')
      .order('full_name')
    setEmployees(data ?? [])
  }

  useEffect(() => {
    loadEntries()
    loadEmployees()
  }, [])

  // الإدخالات بعد فلتر الموظف
  const filteredEntries = useMemo(
    () => entries.filter((e) => !empFilter || e.worker_id === empFilter),
    [entries, empFilter]
  )

  // صف لكل لاب: الاسم + نوع التست + نوع اللاب + السيريال
  const allRows = useMemo(() => {
    const out = []
    for (const e of filteredEntries) {
      const name = e.employees?.full_name ?? '-'
      const serials = e.lap_serials ?? []
      if (!serials.length) {
        // إدخال قديم من غير لابات مسجّلة
        out.push({
          name,
          date: e.entry_date,
          laptop_type: '—',
          test: entryOperationNames(e),
          serial: '—',
        })
        continue
      }
      for (const s of serials) {
        out.push({
          name,
          date: e.entry_date,
          laptop_type: s.laptop_type || '—',
          test: s.operations?.name_ar ?? e.operations?.name_ar ?? '—',
          serial: s.serial,
        })
      }
    }
    return out
  }, [filteredEntries])

  // البحث الشامل: الاسم / نوع اللاب / السيريال
  const rows = useMemo(() => {
    const q = search.trim().toLowerCase()
    if (!q) return allRows
    return allRows.filter(
      (r) =>
        r.name.toLowerCase().includes(q) ||
        String(r.laptop_type).toLowerCase().includes(q) ||
        String(r.serial).toLowerCase().includes(q)
    )
  }, [allRows, search])

  // إحصائية الموظفين: الموظف × نوع التست × عدد اللابات
  const summary = useMemo(() => {
    const m = new Map()
    for (const r of rows) {
      const key = `${r.name}||${r.test}`
      if (!m.has(key)) m.set(key, { name: r.name, test: r.test, count: 0 })
      m.get(key).count += 1
    }
    return [...m.values()].sort(
      (a, b) => a.name.localeCompare(b.name, 'ar') || b.count - a.count
    )
  }, [rows])

  const totalLaptops = rows.length

  // تصدير جدول إنتاجية الموظفين (الإحصائية)
  function exportSummary() {
    exportXlsx({
      filename: `yas-productivity-summary_${toISODate(new Date())}.xlsx`,
      sheetName: 'إنتاجية الموظفين',
      headers: ['الموظف', 'نوع التست', 'عدد اللابات'],
      rows: summary.map((r) => [r.name, r.test, r.count]),
    })
  }

  // تصدير جدول تفصيل اللابات
  function exportDetails() {
    exportXlsx({
      filename: `yas-productivity-laptops_${toISODate(new Date())}.xlsx`,
      sheetName: 'تفصيل اللابات',
      headers: ['الموظف', 'التاريخ', 'نوع اللاب', 'نوع التست', 'السيريال'],
      rows: rows.map((r) => [r.name, r.date, r.laptop_type, r.test, r.serial]),
    })
  }

  async function deleteAll() {
    if (
      !window.confirm(
        'تحذير: هيتم حذف كل إدخالات الإنتاج في النظام نهائيًا (كل الموظفين وكل الفترات). تكمل؟'
      )
    )
      return
    if (!window.confirm('تأكيد أخير: مفيش رجوع بعد الحذف. متأكد؟')) return
    setBusyDelete(true)
    const { error } = await supabase.rpc('fn_delete_all_entries')
    setBusyDelete(false)
    if (error) return window.alert(error.message)
    setEntries([])
    window.alert('تم حذف كل الإدخالات.')
  }

  return (
    <Layout title="الإنتاجية">
      <div className="card mb-4 flex flex-wrap items-end gap-3">
        <div className="w-full sm:w-auto">
          <label className="label">الموظف</label>
          <select className="input w-48" value={empFilter} onChange={(e) => setEmpFilter(e.target.value)}>
            <option value="">كل الموظفين</option>
            {employees.map((emp) => (
              <option key={emp.id} value={emp.id}>
                {emp.full_name}
              </option>
            ))}
          </select>
        </div>
        <div className="w-full flex-1 sm:w-auto">
          <label className="label">بحث شامل</label>
          <input
            className="input"
            placeholder="ابحث بالاسم أو نوع اللاب أو السيريال…"
            value={search}
            onChange={(e) => setSearch(e.target.value)}
          />
        </div>
        <div className="flex gap-2">
          <button onClick={deleteAll} disabled={busyDelete || !entries.length} className="btn-danger">
            {busyDelete ? '…' : 'حذف الكل'}
          </button>
        </div>
      </div>

      <div className="card">
        <div className="mb-3 flex flex-wrap items-center justify-between gap-2">
          <div>
            <h2 className="font-bold text-lg">إنتاجية الموظفين</h2>
            <p className="text-xs text-slate-500 mt-0.5">
              {loading
                ? 'جاري التحميل…'
                : `${formatNumber(totalLaptops)} لاب — الإدخالات المعتمدة`}
            </p>
          </div>
          <button onClick={exportSummary} disabled={!summary.length} className="btn-ghost !py-1.5 text-sm">
            تصدير Excel
          </button>
        </div>

        <div className="table-wrap">
          <table className="table table-cards">
            <thead>
              <tr>
                <th>الموظف</th>
                <th>نوع التست</th>
                <th>عدد اللابات</th>
              </tr>
            </thead>
            <tbody>
              {summary.length === 0 && (
                <tr>
                  <td colSpan={3} className="text-center text-slate-400 py-6">
                    {loading ? 'جاري التحميل…' : 'مفيش إدخالات معتمدة لسه'}
                  </td>
                </tr>
              )}
              {summary.map((r) => (
                <tr key={`${r.name}-${r.test}`}>
                  <td data-label="الموظف">{r.name}</td>
                  <td data-label="نوع التست">{r.test}</td>
                  <td data-label="عدد اللابات">{formatNumber(r.count)}</td>
                </tr>
              ))}
            </tbody>
          </table>
        </div>
      </div>

      <div className="card mt-4">
        <div className="mb-3 flex flex-wrap items-center justify-between gap-2">
          <h2 className="font-bold text-lg">تفصيل اللابات</h2>
          <button onClick={exportDetails} disabled={!rows.length} className="btn-ghost !py-1.5 text-sm">
            تصدير Excel
          </button>
        </div>
        <div className="table-wrap">
          <table className="table table-cards">
            <thead>
              <tr>
                <th>الاسم</th>
                <th>نوع اللاب</th>
                <th>نوع التست</th>
                <th>السيريال</th>
                <th>التاريخ</th>
              </tr>
            </thead>
            <tbody>
              {rows.length === 0 && (
                <tr>
                  <td colSpan={5} className="text-center text-slate-400 py-6">
                    {loading ? 'جاري التحميل…' : 'مفيش لابات معتمدة لسه'}
                  </td>
                </tr>
              )}
              {rows.map((r, i) => (
                <tr key={`${r.serial}-${i}`}>
                  <td data-label="الاسم">{r.name}</td>
                  <td data-label="نوع اللاب">{r.laptop_type}</td>
                  <td data-label="نوع التست">{r.test}</td>
                  <td data-label="السيريال" dir="ltr" className="text-left font-mono text-sm">{r.serial}</td>
                  <td data-label="التاريخ">{formatDate(r.date)}</td>
                </tr>
              ))}
            </tbody>
          </table>
        </div>
      </div>
    </Layout>
  )
}
