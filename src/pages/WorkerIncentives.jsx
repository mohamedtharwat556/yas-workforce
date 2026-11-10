import { useEffect, useMemo, useState } from 'react'
import Layout from '../components/Layout'
import StatusBadge from '../components/StatusBadge'
import { useAuth } from '../context/AuthContext'
import { supabase, fetchAll } from '../lib/supabase'
import { formatDate, formatNumber, startOfMonth, startOfWeek, toISODate, entryLines, entryOperationNames } from '../lib/dates'
import { exportXlsx } from '../lib/xlsx'
import { printReport } from '../lib/report'

export default function WorkerIncentives() {
  const { user, profile } = useAuth()
  const [entries, setEntries] = useState([])
  const [loading, setLoading] = useState(true)
  const [error, setError] = useState('')

  useEffect(() => {
    if (!user) return
    let active = true
    async function load() {
      setLoading(true)
      setError('')
      try {
        // بنسحب على دفعات عشان سجل الموظف الطويل مايتقطعش عند 1000 صف
        const rows = await fetchAll(() =>
          supabase
            .from('production_entries')
            .select('*, operations(name_ar), entry_operations(operation_id, quantity, operations(name_ar))')
            .eq('worker_id', user.id)
            .in('status', ['approved', 'released'])
            .order('entry_date', { ascending: false })
            .order('id')
        )
        if (!active) return
        setEntries(rows)
      } catch (err) {
        if (active) setError(err.message || 'حصل خطأ أثناء تحميل إنتاجك.')
      } finally {
        if (active) setLoading(false)
      }
    }
    load()
    return () => {
      active = false
    }
  }, [user])

  // الإدخالات اللي الموظف حذفها من أرشيفه (worker_hidden_at) بتتشال من الأرقام كمان.
  // المؤرشفة بس (من غير حذف) بتفضل محسوبة.
  const countedEntries = useMemo(() => entries.filter((e) => !e.worker_hidden_at), [entries])

  const stats = useMemo(() => {
    const today = toISODate(new Date())
    const weekStart = toISODate(startOfWeek())
    const monthStart = toISODate(startOfMonth())
    const calc = (rows) => ({
      laps: rows.reduce((s, e) => s + entryLines(e).reduce((a, l) => a + l.quantity, 0), 0),
    })
    return {
      today: calc(countedEntries.filter((e) => e.entry_date === today)),
      week: calc(countedEntries.filter((e) => e.entry_date >= weekStart)),
      month: calc(countedEntries.filter((e) => e.entry_date >= monthStart)),
      all: calc(countedEntries),
    }
  }, [countedEntries])

  // تفصيل الشهر الحالي حسب نوع العملية
  const byOperation = useMemo(() => {
    const monthStart = toISODate(startOfMonth())
    const map = new Map()
    for (const e of countedEntries) {
      if (e.entry_date < monthStart) continue
      for (const l of entryLines(e)) {
        const name = l.name
        if (!map.has(name)) map.set(name, { name, laps: 0 })
        const row = map.get(name)
        row.laps += l.quantity
      }
    }
    return Array.from(map.values()).sort((a, b) => b.laps - a.laps)
  }, [countedEntries])

  const monthTotals = useMemo(
    () => byOperation.reduce((a, r) => ({ laps: a.laps + r.laps }), { laps: 0 }),
    [byOperation]
  )

  // القائمة بتعرض كل الإدخالات المحسوبة في الإجمالي (بما فيها اللي الموظف نقلها لأرشيفه)
  // عشان الإجمالي التراكمي والقائمة يبقوا متطابقين.
  const visibleEntries = countedEntries

  function exportExcel() {
    exportXlsx({
      filename: `yas-my-production_${toISODate(new Date())}.xlsx`,
      sheetName: 'إنتاجي',
      meta: [
        [`الموظف: ${profile?.full_name ?? ''}`],
        [`إجمالي تراكمي: ${formatNumber(stats.all.laps)} لاب`],
      ],
      headers: ['التاريخ', 'العملية', 'العدد', 'الحالة'],
      rows: countedEntries.map((e) => {
        const qty = entryLines(e).reduce((s, l) => s + l.quantity, 0)
        return [e.entry_date, entryOperationNames(e), qty, e.status]
      }),
      footer: ['', 'الإجمالي', stats.all.laps, ''],
    })
  }

  function exportPDF() {
    printReport({
      title: 'كشف إنتاجي',
      period: { start: toISODate(startOfMonth()), end: toISODate(new Date()) },
      totals: { laps: monthTotals.laps },
      rows: byOperation.map((o) => ({ name: o.name, laps: o.laps })),
      rowsTitle: 'تفصيل الشهر حسب نوع العملية',
      rowsLabel: 'العملية',
    })
  }

  return (
    <Layout title="تفاصيل إنتاجي">
      {error && <div className="mb-4 rounded-lg bg-red-50 p-3 text-sm text-red-700">{error}</div>}
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
                  <th>النسبة</th>
                </tr>
              </thead>
              <tbody>
                {byOperation.length === 0 && (
                  <tr>
                    <td colSpan={3} className="text-center text-slate-400 py-6">مفيش إدخالات معتمدة الشهر ده</td>
                  </tr>
                )}
                {byOperation.map((o) => (
                  <tr key={o.name}>
                    <td data-label="العملية">{o.name}</td>
                    <td data-label="لابات">{formatNumber(o.laps)}</td>
                    <td data-label="النسبة">{monthTotals.laps ? Math.round((o.laps / monthTotals.laps) * 100) : 0}%</td>
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
              (إجمالي تراكمي: {formatNumber(stats.all.laps)} لاب)
            </span>
          </h2>
          <div className="table-wrap">
            <table className="table table-cards">
              <thead>
                <tr>
                  <th>التاريخ</th>
                  <th>العملية</th>
                  <th>العدد</th>
                  <th>الحالة</th>
                </tr>
              </thead>
              <tbody>
                {loading && (
                  <tr>
                    <td colSpan={4} className="text-center text-slate-400 py-6">جاري التحميل…</td>
                  </tr>
                )}
                {!loading && visibleEntries.length === 0 && (
                  <tr>
                    <td colSpan={4} className="text-center text-slate-400 py-6">مفيش إدخالات معتمدة لسه</td>
                  </tr>
                )}
                {visibleEntries.slice(0, 30).map((e) => (
                  <tr key={e.id}>
                    <td data-label="التاريخ">{formatDate(e.entry_date)}</td>
                    <td data-label="العملية">{entryOperationNames(e)}</td>
                    <td data-label="العدد">{formatNumber(entryLines(e).reduce((s, l) => s + l.quantity, 0))}</td>
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
    </div>
  )
}
