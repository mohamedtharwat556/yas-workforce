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
  const [rule, setRule] = useState(null)
  const [loading, setLoading] = useState(true)

  useEffect(() => {
    if (!user) return
    let active = true
    async function load() {
      setLoading(true)
      const [e, r] = await Promise.all([
        supabase
          .from('production_entries')
          .select('*, operations(name_ar, weight), entry_operations(operation_id, quantity, operations(name_ar, weight))')
          .eq('worker_id', user.id)
          .eq('status', 'released')
          .order('entry_date', { ascending: false }),
        supabase.from('incentive_rules').select('*').limit(1).maybeSingle(),
      ])
      if (!active) return
      setEntries(e.data ?? [])
      setRule(r.data ?? null)
      setLoading(false)
    }
    load()
    return () => {
      active = false
    }
  }, [user])

  const rate = Number(rule?.unit_rate ?? 0)
  const currency = rule?.currency ?? 'EGP'

  const stats = useMemo(() => {
    const today = toISODate(new Date())
    const weekStart = toISODate(startOfWeek())
    const monthStart = toISODate(startOfMonth())
    const calc = (rows) => {
      const laps = rows.reduce((s, e) => s + entryLines(e).reduce((a, l) => a + l.quantity, 0), 0)
      const units = rows.reduce((s, e) => s + entryUnits(e), 0)
      return { laps, units, incentive: units * rate }
    }
    return {
      today: calc(entries.filter((e) => e.entry_date === today)),
      week: calc(entries.filter((e) => e.entry_date >= weekStart)),
      month: calc(entries.filter((e) => e.entry_date >= monthStart)),
      all: calc(entries),
    }
  }, [entries, rate])

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
    return Array.from(map.values())
      .map((r) => ({ ...r, incentive: r.units * rate }))
      .sort((a, b) => b.units - a.units)
  }, [entries, rate])

  function exportExcel() {
    exportXlsx({
      filename: `yas-my-incentive_${toISODate(new Date())}.xlsx`,
      sheetName: 'حوافزي',
      title: 'كشف حوافزي',
      meta: [
        [`العامل: ${profile?.full_name ?? ''}`],
        [`سعر الوحدة: ${formatNumber(rate)} ${currency}`],
        [`إجمالي تراكمي: ${formatNumber(stats.all.incentive)} ${currency}`],
      ],
      headers: ['التاريخ', 'العملية', 'العدد', 'وحدات مرجّحة', `الحافز (${currency})`, 'الحالة'],
      rows: entries.map((e) => {
        const units = entryUnits(e)
        const qty = entryLines(e).reduce((s, l) => s + l.quantity, 0)
        return [e.entry_date, entryOperationNames(e), qty, units, units * rate, e.status]
      }),
      footer: ['', '', '', '', stats.all.incentive, ''],
    })
  }

  function exportPDF() {
    printReport({
      title: 'كشف حوافزي',
      period: { start: toISODate(startOfMonth()), end: toISODate(new Date()) },
      currency,
      totals: { laps: stats.month.laps, units: stats.month.units, incentive: stats.month.incentive },
      rows: byOperation.map((o) => ({ name: o.name, laps: o.laps, units: o.units, incentive: o.incentive })),
      rowsTitle: 'تفصيل الشهر حسب نوع العملية',
      rowsLabel: 'العملية',
    })
  }

  return (
    <Layout title="حوافزي">
      <div className="card mb-6">
        <div className="flex flex-wrap items-start justify-between gap-3">
          <div>
            <h2 className="font-bold text-lg">حافزك المتوقّع</h2>
            <p className="text-xs text-slate-500 mt-1">
              أهلاً {profile?.full_name}، ده حساب حافزك على الإدخالات <b>المُصدرة</b> من المشرف بس.
            </p>
            <p className="text-xs text-slate-500 mt-1">
              المعادلة: (مجموع عدد اللابات × وزن العملية) × سعر الوحدة ={' '}
              <span className="font-medium text-slate-700">{formatNumber(rate)} {currency}</span>
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
        <IncentiveCard label="حافز النهاردة" value={stats.today.incentive} currency={currency} laps={stats.today.laps} units={stats.today.units} />
        <IncentiveCard label="حافز الأسبوع" value={stats.week.incentive} currency={currency} laps={stats.week.laps} units={stats.week.units} />
        <IncentiveCard label="حافز الشهر" value={stats.month.incentive} currency={currency} laps={stats.month.laps} units={stats.month.units} />
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
                  <th>الحافز</th>
                </tr>
              </thead>
              <tbody>
                {byOperation.length === 0 && (
                  <tr>
                    <td colSpan={4} className="text-center text-slate-400 py-6">مفيش إدخالات مُصدرة الشهر ده</td>
                  </tr>
                )}
                {byOperation.map((o) => (
                  <tr key={o.name}>
                    <td data-label="العملية">{o.name}</td>
                    <td data-label="لابات">{formatNumber(o.laps)}</td>
                    <td data-label="وحدات">{formatNumber(o.units)}</td>
                    <td data-label="الحافز" className="font-medium">{formatNumber(o.incentive)}</td>
                  </tr>
                ))}
              </tbody>
            </table>
          </div>
        </div>

        <div className="card">
          <h2 className="font-bold text-lg mb-3">
            آخر الإدخالات المُصدرة{' '}
            <span className="text-sm font-normal text-slate-400">(إجمالي تراكمي: {formatNumber(stats.all.incentive)} {currency})</span>
          </h2>
          <div className="table-wrap">
            <table className="table table-cards">
              <thead>
                <tr>
                  <th>التاريخ</th>
                  <th>العملية</th>
                  <th>العدد</th>
                  <th>وحدات</th>
                  <th>الحافز</th>
                  <th>الحالة</th>
                </tr>
              </thead>
              <tbody>
                {loading && (
                  <tr>
                    <td colSpan={6} className="text-center text-slate-400 py-6">جاري التحميل…</td>
                  </tr>
                )}
                {!loading && entries.length === 0 && (
                  <tr>
                    <td colSpan={6} className="text-center text-slate-400 py-6">مفيش إدخالات مُصدرة لسه</td>
                  </tr>
                )}
                {entries.slice(0, 30).map((e) => {
                  const units = entryUnits(e)
                  const qty = entryLines(e).reduce((s, l) => s + l.quantity, 0)
                  return (
                    <tr key={e.id}>
                      <td data-label="التاريخ">{formatDate(e.entry_date)}</td>
                      <td data-label="العملية">{entryOperationNames(e)}</td>
                      <td data-label="العدد">{formatNumber(qty)}</td>
                      <td data-label="وحدات">{formatNumber(units)}</td>
                      <td data-label="الحافز" className="font-medium">{formatNumber(units * rate)}</td>
                      <td data-label="الحالة">
                        <StatusBadge status={e.status} />
                      </td>
                    </tr>
                  )
                })}
              </tbody>
            </table>
          </div>
        </div>
      </div>
    </Layout>
  )
}

function IncentiveCard({ label, value, currency, laps, units }) {
  return (
    <div className="card">
      <p className="text-sm text-slate-500">{label}</p>
      <p className="text-3xl font-bold mt-1">
        {formatNumber(value)} <span className="text-base font-normal text-slate-400">{currency}</span>
      </p>
      <p className="text-xs text-slate-400 mt-1">
        {formatNumber(laps)} لاب · {formatNumber(units)} وحدة مرجّحة
      </p>
    </div>
  )
}
