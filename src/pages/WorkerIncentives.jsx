import { useEffect, useMemo, useState } from 'react'
import Layout from '../components/Layout'
import StatusBadge from '../components/StatusBadge'
import { useAuth } from '../context/AuthContext'
import { supabase } from '../lib/supabase'
import { formatDate, formatNumber, startOfMonth, startOfWeek, toISODate, entryLines, entryUnits, entryOperationNames } from '../lib/dates'
import { exportXlsx } from '../lib/xlsx'
import { printReport } from '../lib/report'

export default function WorkerIncentives() {
  const { user, profile } = useAuth()
  const [entries, setEntries] = useState([])
  const [loading, setLoading] = useState(true)

  useEffect(() => {
    if (!user) return
    let active = true
    async function load() {
      setLoading(true)
      const { data } = await supabase
        .from('production_entries')
        .select('*, operations(name_ar, weight), entry_operations(operation_id, quantity, operations(name_ar, weight))')
        .eq('worker_id', user.id)
        .in('status', ['approved', 'released'])
        .order('entry_date', { ascending: false })
      if (!active) return
      setEntries(data ?? [])
      setLoading(false)
    }
    load()
    return () => {
      active = false
    }
  }, [user])

  const stats = useMemo(() => {
    const today = toISODate(new Date())
    const weekStart = toISODate(startOfWeek())
    const monthStart = toISODate(startOfMonth())
    const calc = (rows) => ({
      laps: rows.reduce((s, e) => s + entryLines(e).reduce((a, l) => a + l.quantity, 0), 0),
      units: rows.reduce((s, e) => s + entryUnits(e), 0),
    })
    return {
      today: calc(entries.filter((e) => e.entry_date === today)),
      week: calc(entries.filter((e) => e.entry_date >= weekStart)),
      month: calc(entries.filter((e) => e.entry_date >= monthStart)),
      all: calc(entries),
    }
  }, [entries])

  // تفصيل الشهر الحالي حسب نوع العملية
  const byOperation = useMemo(() => {
    const monthStart = toISODate(startOfMonth())
    const map = new Map()
    for (const e of entries) {
      if (e.entry_date < monthStart) continue
      for (const l of entryLines(e)) {
        const name = l.name
        if (!map.has(name)) map.set(name, { name, laps: 0, units: 0 })
        const row = map.get(name)
        row.laps += l.quantity
        row.units += l.quantity * l.weight
      }
    }
    return Array.from(map.values()).sort((a, b) => b.units - a.units)
  }, [entries])

  const monthTotals = useMemo(
    () =>
      byOperation.reduce((a, r) => ({ laps: a.laps + r.laps, units: a.units + r.units }), { laps: 0, units: 0 }),
    [byOperation]
  )

  function exportExcel() {
    exportXlsx({
      filename: `yas-my-production_${toISODate(new Date())}.xlsx`,
      sheetName: 'إنتاجي',
      meta: [
        [`العامل: ${profile?.full_name ?? ''}`],
        [`إجمالي تراكمي: ${formatNumber(stats.all.laps)} لاب · ${formatNumber(stats.all.units)} وحدة مرجّحة`],
      ],
      headers: ['التاريخ', 'العملية', 'العدد', 'وحدات مرجّحة', 'الحالة'],
      rows: entries.map((e) => {
        const qty = entryLines(e).reduce((s, l) => s + l.quantity, 0)
        return [e.entry_date, entryOperationNames(e), qty, entryUnits(e), e.status]
      }),
      footer: ['', 'الإجمالي', stats.all.laps, stats.all.units, ''],
    })
  }

  function exportPDF() {
    printReport({
      title: 'كشف إنتاجي',
      period: { start: toISODate(startOfMonth()), end: toISODate(new Date()) },
      totals: { laps: monthTotals.laps, units: monthTotals.units },
      rows: byOperation.map((o) => ({ name: o.name, laps: o.laps, units: o.units })),
      rowsTitle: 'تفصيل الشهر حسب نوع العملية',
      rowsLabel: 'العملية',
    })
  }

  return (
    <Layout title="تفاصيل إنتاجي">
      <div className="card mb-6">
        <div className="flex flex-wrap items-start justify-between gap-3">
          <div>
            <h2 className="font-bold text-lg">إنتاجك المعتمد</h2>
            <p className="text-xs text-slate-500 mt-1">
              أهلاً {profile?.full_name}، ده سجل إنتاجك على الإدخالات <b>المعتمدة</b> من المشرف بس.
            </p>
          </div>
          <div className="flex shrink-0 gap-2">
            <button onClick={exportExcel} disabled={entries.length === 0} className="btn-ghost !py-2">
              تصدير Excel
            </button>
            <button onClick={exportPDF} disabled={entries.length === 0} className="btn-accent !py-2">
              تصدير PDF
            </button>
          </div>
        </div>
      </div>

      <div className="grid gap-4 md:grid-cols-3 mb-6">
        <StatCard label="النهاردة" data={stats.today} />
        <StatCard label="الأسبوع" data={stats.week} />
        <StatCard label="الشهر" data={stats.month} />
      </div>

      <div className="grid gap-6 lg:grid-cols-2">
        <div className="card">
          <h2 className="font-bold text-lg mb-3">تفصيل الشهر حسب نوع العملية</h2>
          <div className="table-wrap">
            <table className="table table-cards">
              <thead>
                <tr>
                  <th>العملية</th>
                  <th>لابات</th>
                  <th>وحدات</th>
                  <th>النسبة</th>
                </tr>
              </thead>
              <tbody>
                {byOperation.length === 0 && (
                  <tr>
                    <td colSpan={4} className="text-center text-slate-400 py-6">مفيش إدخالات معتمدة الشهر ده</td>
                  </tr>
                )}
                {byOperation.map((o) => (
                  <tr key={o.name}>
                    <td data-label="العملية">{o.name}</td>
                    <td data-label="لابات">{formatNumber(o.laps)}</td>
                    <td data-label="وحدات">{formatNumber(o.units)}</td>
                    <td data-label="النسبة">{monthTotals.units ? Math.round((o.units / monthTotals.units) * 100) : 0}%</td>
                  </tr>
                ))}
              </tbody>
            </table>
          </div>
        </div>

        <div className="card">
          <h2 className="font-bold text-lg mb-3">
            آخر الإدخالات المعتمدة{' '}
            <span className="text-sm font-normal text-slate-400">
              (إجمالي تراكمي: {formatNumber(stats.all.laps)} لاب · {formatNumber(stats.all.units)} وحدة)
            </span>
          </h2>
          <div className="table-wrap">
            <table className="table table-cards">
              <thead>
                <tr>
                  <th>التاريخ</th>
                  <th>العملية</th>
                  <th>العدد</th>
                  <th>وحدات</th>
                  <th>الحالة</th>
                </tr>
              </thead>
              <tbody>
                {loading && (
                  <tr>
                    <td colSpan={5} className="text-center text-slate-400 py-6">جاري التحميل…</td>
                  </tr>
                )}
                {!loading && entries.length === 0 && (
                  <tr>
                    <td colSpan={5} className="text-center text-slate-400 py-6">مفيش إدخالات معتمدة لسه</td>
                  </tr>
                )}
                {entries.slice(0, 30).map((e) => (
                  <tr key={e.id}>
                    <td data-label="التاريخ">{formatDate(e.entry_date)}</td>
                    <td data-label="العملية">{entryOperationNames(e)}</td>
                    <td data-label="العدد">{formatNumber(entryLines(e).reduce((s, l) => s + l.quantity, 0))}</td>
                    <td data-label="وحدات">{formatNumber(entryUnits(e))}</td>
                    <td data-label="الحالة">
                      <StatusBadge status={e.status} />
                    </td>
                  </tr>
                ))}
              </tbody>
            </table>
          </div>
        </div>
      </div>
    </Layout>
  )
}

function StatCard({ label, data }) {
  return (
    <div className="card">
      <p className="text-sm text-slate-500">{label}</p>
      <p className="text-3xl font-bold mt-1">{formatNumber(data.laps)}</p>
      <p className="text-xs text-slate-400 mt-1">{formatNumber(data.units)} وحدة مرجّحة</p>
    </div>
  )
}
