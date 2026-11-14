import { useEffect, useMemo, useState } from 'react'
import Layout from '../components/Layout'
import { supabase } from '../lib/supabase'
import { formatDate, formatNumber, toISODate, entryOperationNames, entryTotalQty } from '../lib/dates'
import { exportXlsxSheets } from '../lib/xlsx'

// صفحة الإنتاجية (للمشرف فقط): إنتاجية كل موظف على الإدخالات المعتمدة —
// الاسم + عدد اللابات + نوع اللاب + نوع التست + السيريال، مع تصدير Excel.
const APPROVED_STATUSES = ['approved', 'released', 'archived']

export default function Productivity() {
  const [entries, setEntries] = useState([])
  const [loading, setLoading] = useState(true)

  useEffect(() => {
    let active = true
    async function load() {
      setLoading(true)
      const { data } = await supabase
        .from('production_entries')
        .select(
          'id, entry_date, status, operation_id, quantity, employees!production_entries_worker_id_fkey(full_name), operations(name_ar), entry_operations(operation_id, quantity, operations(name_ar)), lap_serials(serial, laptop_type, operation_id, operations(name_ar))'
        )
        .in('status', APPROVED_STATUSES)
        .order('entry_date', { ascending: false })
      if (!active) return
      setEntries(data ?? [])
      setLoading(false)
    }
    load()
    return () => {
      active = false
    }
  }, [])

  // صف لكل لاب: الاسم + نوع اللاب + نوع التست + السيريال
  const rows = useMemo(() => {
    const out = []
    for (const e of entries) {
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
  }, [entries])

  // عدد اللابات لكل موظف
  const summary = useMemo(() => {
    const m = new Map()
    for (const e of entries) {
      const name = e.employees?.full_name ?? '-'
      const n = (e.lap_serials ?? []).length || entryTotalQty(e)
      m.set(name, (m.get(name) ?? 0) + n)
    }
    return [...m.entries()]
      .map(([name, count]) => ({ name, count }))
      .sort((a, b) => b.count - a.count || a.name.localeCompare(b.name, 'ar'))
  }, [entries])

  const totalLaptops = summary.reduce((s, r) => s + r.count, 0)

  function exportAll() {
    exportXlsxSheets({
      filename: `yas-productivity_${toISODate(new Date())}.xlsx`,
      sheets: [
        {
          sheetName: 'إحصائية الموظفين',
          headers: ['الموظف', 'عدد اللابات'],
          rows: summary.map((r) => [r.name, r.count]),
        },
        {
          sheetName: 'تفصيل الإنتاجية',
          headers: ['الموظف', 'التاريخ', 'نوع اللاب', 'نوع التست', 'السيريال'],
          rows: rows.map((r) => [r.name, r.date, r.laptop_type, r.test, r.serial]),
        },
      ],
    })
  }

  return (
    <Layout title="الإنتاجية">
      <div className="card">
        <div className="mb-3 flex flex-wrap items-center justify-between gap-2">
          <div>
            <h2 className="font-bold text-lg">إنتاجية الموظفين</h2>
            <p className="text-xs text-slate-500 mt-0.5">
              {loading
                ? 'جاري التحميل…'
                : `${formatNumber(totalLaptops)} لاب لـ ${formatNumber(summary.length)} موظف — الإدخالات المعتمدة`}
            </p>
          </div>
          <button onClick={exportAll} disabled={!rows.length} className="btn-ghost !py-1.5 text-sm">
            تصدير Excel
          </button>
        </div>

        <div className="table-wrap">
          <table className="table table-cards">
            <thead>
              <tr>
                <th>الموظف</th>
                <th>عدد اللابات</th>
              </tr>
            </thead>
            <tbody>
              {summary.length === 0 && (
                <tr>
                  <td colSpan={2} className="text-center text-slate-400 py-6">
                    {loading ? 'جاري التحميل…' : 'مفيش إدخالات معتمدة لسه'}
                  </td>
                </tr>
              )}
              {summary.map((r) => (
                <tr key={r.name}>
                  <td data-label="الموظف">{r.name}</td>
                  <td data-label="عدد اللابات">{formatNumber(r.count)}</td>
                </tr>
              ))}
            </tbody>
          </table>
        </div>
      </div>

      <div className="card mt-4">
        <h2 className="font-bold text-lg mb-3">تفصيل اللابات</h2>
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
