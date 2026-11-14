import { useEffect, useMemo, useState } from 'react'
import {
  Bar,
  BarChart,
  CartesianGrid,
  Line,
  LineChart,
  ResponsiveContainer,
  Tooltip,
  XAxis,
  YAxis,
} from 'recharts'
import Layout from '../components/Layout'
import StatusBadge from '../components/StatusBadge'
import { supabase } from '../lib/supabase'
import { formatDate, formatNumber, startOfMonth, toISODate, entryTotalQty } from '../lib/dates'
import { exportXlsx } from '../lib/xlsx'
import { printReport } from '../lib/report'

// استخراج رسالة الخطأ الحقيقية من دالة Edge لما ترجع حالة غير 2xx
async function edgeErrorMessage(error) {
  try {
    const res = error?.context
    if (res && typeof res.clone === 'function') {
      const body = await res.clone().json()
      if (body?.error) return body.error
    }
  } catch {
    /* نتجاهل ونجرّب الرسالة الافتراضية */
  }
  return error?.message || 'تعذّر تشغيل التحليل.'
}

const STATUS_ORDER = [
  'received',
  'in_progress',
  'awaiting_release',
  'released',
  'on_hold',
  'rejected',
  'returned',
]

const STATUS_LABELS = {
  draft: 'مسودّة',
  submitted: 'بانتظار المراجعة',
  approved: 'معتمد',
  released: 'مُصدر',
  returned: 'مُرتجَع',
}

function addDays(dateStr, delta) {
  const d = new Date(dateStr)
  d.setDate(d.getDate() + delta)
  return toISODate(d)
}

function daysBetween(a, b) {
  return Math.round((new Date(b).getTime() - new Date(a).getTime()) / 86400000)
}

function pct(current, previous) {
  if (!previous) return null
  return ((current - previous) / previous) * 100
}

export default function ManagementDashboard() {
  const [laptops, setLaptops] = useState([])
  const [movements, setMovements] = useState([])
  const [entries, setEntries] = useState([])
  const [loadingAnalytics, setLoadingAnalytics] = useState(true)

  const [from, setFrom] = useState(() => toISODate(startOfMonth()))
  const [to, setTo] = useState(() => toISODate(new Date()))

  const [ai, setAi] = useState(null)
  const [aiBusy, setAiBusy] = useState(false)
  const [aiError, setAiError] = useState('')

  // الفترة السابقة (نفس طول الفترة المختارة) للمقارنة
  const prevRange = useMemo(() => {
    const days = Math.max(0, daysBetween(from, to))
    const end = addDays(from, -1)
    const start = addDays(end, -days)
    return { start, end }
  }, [from, to])

  async function loadAll() {
    const [l, mv] = await Promise.all([
      supabase.from('laptops').select('*'),
      supabase
        .from('laptop_movements')
        .select('*, profiles(full_name), laptops(serial)')
        .order('created_at', { ascending: false })
        .limit(20),
    ])
    setLaptops(l.data ?? [])
    setMovements(mv.data ?? [])
  }

  // إدخالات الفترة الحالية + السابقة (مرّة واحدة)
  async function loadAnalytics() {
    setLoadingAnalytics(true)
    const { data } = await supabase
      .from('production_entries')
      .select(
        'entry_date, quantity, status, laptop_id, worker_id, employees!production_entries_worker_id_fkey(full_name), operations(name_ar), entry_operations(quantity, operations(name_ar))'
      )
      .gte('entry_date', prevRange.start)
      .lte('entry_date', to)
      .limit(5000)
    setEntries(data ?? [])
    setLoadingAnalytics(false)
  }

  useEffect(() => {
    loadAll()
  }, [])

  useEffect(() => {
    loadAnalytics()
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [from, to])

  // ===== إحصائيات اللابات على الفترة المختارة =====
  const periodLaptops = useMemo(
    () =>
      laptops.filter((l) => {
        const d = (l.created_at ?? '').slice(0, 10)
        return d >= from && d <= to
      }),
    [laptops, from, to]
  )

  const periodCounts = useMemo(() => {
    const m = {}
    for (const l of periodLaptops) m[l.current_status] = (m[l.current_status] ?? 0) + 1
    return m
  }, [periodLaptops])

  // اللابات اللي اتصدرت فعليًا خلال الفترة (حسب تاريخ الإصدار)
  const releasedInPeriod = useMemo(
    () =>
      laptops.filter((l) => {
        const d = (l.released_at ?? '').slice(0, 10)
        return Boolean(d) && d >= from && d <= to
      }).length,
    [laptops, from, to]
  )

  const aggregate = useMemo(() => {
    const build = (list) => {
      const byDay = new Map()
      const byWorker = new Map()
      const status = {}
      const laptopsSet = new Set()
      let qty = 0
      for (const e of list) {
        const u = entryTotalQty(e)
        qty += u
        status[e.status] = (status[e.status] ?? 0) + 1
        if (e.laptop_id) laptopsSet.add(e.laptop_id)

        const d = byDay.get(e.entry_date) ?? { date: e.entry_date, qty: 0, entries: 0 }
        d.qty += u
        d.entries += 1
        byDay.set(e.entry_date, d)

        const name = e.employees?.full_name ?? 'غير معروف'
        const w = byWorker.get(name) ?? { name, qty: 0, entries: 0, laptops: new Set() }
        w.qty += u
        w.entries += 1
        if (e.laptop_id) w.laptops.add(e.laptop_id)
        byWorker.set(name, w)
      }
      return {
        qty,
        laps: laptopsSet.size,
        status,
        daily: Array.from(byDay.values()).sort((a, b) => a.date.localeCompare(b.date)),
        workers: Array.from(byWorker.values())
          .map((w) => ({ name: w.name, qty: w.qty, entries: w.entries, laps: w.laptops.size }))
          .sort((a, b) => b.qty - a.qty),
        total: list.length,
      }
    }

    const current = entries.filter((e) => e.entry_date >= from && e.entry_date <= to)
    const previous = entries.filter((e) => e.entry_date >= prevRange.start && e.entry_date <= prevRange.end)
    return { current: build(current), previous: build(previous) }
  }, [entries, from, to, prevRange])

  const cur = aggregate.current
  const pc = aggregate.previous

  const rejected = cur.status.returned ?? 0
  const rejectionRate = cur.total ? (rejected / cur.total) * 100 : 0
  const unitsDelta = pct(cur.qty, pc.qty)

  function exportExcel() {
    exportXlsx({
      filename: `yas-management_${from}_${to}.xlsx`,
      sheetName: 'الإدارة',
      title: 'تقرير الإدارة — الإنتاجية',
      meta: [
        [`الفترة: ${from} ← ${to}`],
        [`إجمالي اللابات: ${formatNumber(cur.laps)}`],
        [`إجمالي العدد: ${formatNumber(cur.qty)}`],
        [`معدّل الرفض: ${formatNumber(rejectionRate)}%`],
      ],
      headers: ['#', 'الموظف', 'عدد اللابات', 'إجمالي العدد'],
      rows: cur.workers.map((r, i) => [i + 1, r.name, r.laps, r.qty]),
      footer: ['', 'الإجمالي', cur.laps, cur.qty],
    })
  }

  function exportPDF() {
    printReport({
      title: 'تقرير الإدارة — الإنتاجية',
      period: { start: from, end: to },
      totals: { laps: cur.laps },
      rows: cur.workers.map((r) => ({ name: r.name, laps: r.laps })),
    })
  }

  async function runAI() {
    setAiBusy(true)
    setAiError('')
    setAi(null)
    try {
      const { data, error } = await supabase.functions.invoke('ai-analysis', {
        body: {
          period: { start: from, end: to },
          totals: { laps: cur.laps, units: cur.qty },
          workers: cur.workers.map((w) => ({ name: w.name, laps: w.laps, units: w.qty })),
          entries: [],
        },
      })
      if (error) throw new Error(await edgeErrorMessage(error))
      if (data?.error) throw new Error(data.error)
      setAi(data)
    } catch (err) {
      setAiError(err.message || 'تعذّر تشغيل التحليل. تأكد من نشر دالة ai-analysis.')
    } finally {
      setAiBusy(false)
    }
  }

  return (
    <Layout title="لوحة الإدارة">
      <div className="mb-4 flex items-center justify-between">
        <h1 className="text-xl font-bold">لوحة الإدارة</h1>
        <span className="badge bg-slate-100 text-slate-600">قراءة فقط</span>
      </div>

      {/* فلتر الفترة + الإجراءات */}
      <div className="mb-4 card flex flex-wrap items-end gap-3">
        <div>
          <label className="label">من</label>
          <input type="date" className="input !w-auto" value={from} onChange={(e) => setFrom(e.target.value)} />
        </div>
        <div>
          <label className="label">إلى</label>
          <input type="date" className="input !w-auto" value={to} onChange={(e) => setTo(e.target.value)} />
        </div>
        <div className="text-xs text-slate-500 mb-2">
          الفترة السابقة للمقارنة: {prevRange.start} ← {prevRange.end}
        </div>
        <div className="flex-1" />
        <button onClick={exportExcel} disabled={cur.workers.length === 0} className="btn-ghost">
          تصدير Excel
        </button>
        <button onClick={exportPDF} disabled={cur.workers.length === 0} className="btn-accent">
          تصدير PDF
        </button>
        <button onClick={runAI} disabled={aiBusy || cur.workers.length === 0} className="btn-primary">
          {aiBusy ? 'جاري التحليل…' : 'تقرير AI'}
        </button>
      </div>

      {/* نظرة عامة على اللابات في الفترة */}
      <div className="mb-4 grid grid-cols-2 gap-3 sm:grid-cols-4">
        <Stat label="لابات الفترة" value={periodLaptops.length} />
        <Stat label="اتصدرت في الفترة" value={releasedInPeriod} tone="emerald" />
        <Stat label="تحت التنفيذ" value={periodCounts.in_progress ?? 0} tone="amber" />
        <Stat label="بانتظار الإصدار" value={periodCounts.awaiting_release ?? 0} tone="violet" />
      </div>

      {/* المؤشرات المتقدمة */}
      <div className="mb-4 grid grid-cols-2 gap-3 sm:grid-cols-4">
        <Stat label="إجمالي اللابات" value={formatNumber(cur.laps)} />
        <Stat label="إجمالي العدد" value={formatNumber(cur.qty)} />
        <Stat
          label="التغيّر عن الفترة السابقة"
          value={unitsDelta === null ? '—' : `${unitsDelta >= 0 ? '+' : ''}${formatNumber(unitsDelta)}%`}
          tone={unitsDelta === null ? undefined : unitsDelta >= 0 ? 'emerald' : 'red'}
        />
        <Stat label="معدّل الرفض" value={`${formatNumber(rejectionRate)}%`} tone={rejectionRate > 15 ? 'red' : 'emerald'} />
      </div>

      {/* تحليل الذكاء الاصطناعي */}
      {(ai || aiError) && (
        <div className={`card mb-4 ${aiError ? 'border-red-200 bg-red-50' : ''}`}>
          <h2 className="mb-2 font-bold text-lg">تحليل الذكاء الاصطناعي</h2>
          {aiError ? (
            <p className="text-sm text-red-700">{aiError}</p>
          ) : (
            <div className="text-sm leading-7 whitespace-pre-wrap text-slate-700">{ai.summary}</div>
          )}
        </div>
      )}

      {/* توزيع حالات اللابات في الفترة */}
      <div className="mb-4 card">
        <h2 className="mb-3 font-bold">توزيع حالات لابات الفترة</h2>
        <div className="flex flex-wrap gap-2">
          {STATUS_ORDER.map((s) => (
            <span key={s} className="flex items-center gap-1">
              <StatusBadge status={s} />
              <span className="text-sm font-semibold text-slate-600">{periodCounts[s] ?? 0}</span>
            </span>
          ))}
        </div>
      </div>

      {/* اتجاه يومي + ترتيب الموظفين */}
      <div className="mb-4 grid gap-4 lg:grid-cols-2">
        <div className="card">
          <h2 className="mb-3 font-bold">الاتجاه اليومي (العدد)</h2>
          {cur.daily.length === 0 ? (
            <p className="py-10 text-center text-sm text-slate-400">
              {loadingAnalytics ? 'جاري التحميل…' : 'مفيش بيانات في الفترة دي'}
            </p>
          ) : (
            <ResponsiveContainer width="100%" height={260}>
              <LineChart data={cur.daily} margin={{ top: 5, right: 8, left: -18, bottom: 0 }}>
                <CartesianGrid strokeDasharray="3 3" stroke="#e2e8f0" />
                <XAxis dataKey="date" tick={{ fontSize: 11 }} />
                <YAxis tick={{ fontSize: 11 }} />
                <Tooltip />
                <Line type="monotone" dataKey="qty" name="عدد" stroke="#1d4ed8" strokeWidth={2} dot={false} />
              </LineChart>
            </ResponsiveContainer>
          )}
        </div>

        <div className="card">
          <h2 className="mb-3 font-bold">ترتيب الموظفين (أعلى 7 بالعدد)</h2>
          {cur.workers.length === 0 ? (
            <p className="py-10 text-center text-sm text-slate-400">
              {loadingAnalytics ? 'جاري التحميل…' : 'مفيش بيانات في الفترة دي'}
            </p>
          ) : (
            <ResponsiveContainer width="100%" height={260}>
              <BarChart data={cur.workers.slice(0, 7)} margin={{ top: 5, right: 8, left: -18, bottom: 0 }}>
                <CartesianGrid strokeDasharray="3 3" stroke="#e2e8f0" />
                <XAxis dataKey="name" tick={{ fontSize: 10 }} interval={0} />
                <YAxis tick={{ fontSize: 11 }} />
                <Tooltip />
                <Bar dataKey="qty" name="عدد" fill="#1d4ed8" radius={[4, 4, 0, 0]} />
              </BarChart>
            </ResponsiveContainer>
          )}
        </div>
      </div>

      {/* مقارنة الفترتين */}
      <div className="mb-4 card">
        <h2 className="mb-3 font-bold">مقارنة الفترات</h2>
        <div className="table-wrap">
          <table className="table table-cards">
            <thead>
              <tr>
                <th>المؤشر</th>
                <th>الفترة الحالية</th>
                <th>الفترة السابقة</th>
                <th>الفرق</th>
              </tr>
            </thead>
            <tbody>
              <CompareRow label="عدد اللابات" current={cur.laps} previous={pc.laps} />
              <CompareRow label="إجمالي العدد" current={cur.qty} previous={pc.qty} />
              <CompareRow label="عدد الإدخالات" current={cur.total} previous={pc.total} />
              <tr>
                <td data-label="المؤشر">حالات الإدخال</td>
                <td data-label="الفترة الحالية" className="text-xs">
                  {Object.entries(cur.status).map(([k, v]) => `${STATUS_LABELS[k] ?? k}: ${v}`).join(' · ') || '—'}
                </td>
                <td data-label="الفترة السابقة" className="text-xs">
                  {Object.entries(pc.status).map(([k, v]) => `${STATUS_LABELS[k] ?? k}: ${v}`).join(' · ') || '—'}
                </td>
                <td data-label="الفرق">—</td>
              </tr>
            </tbody>
          </table>
        </div>
      </div>

      {/* آخر الحركات */}
      <div className="card">
        <h2 className="mb-3 font-bold">آخر حركات اللابات</h2>
        <div className="table-wrap">
          <table className="table table-cards">
            <thead>
              <tr>
                <th>السيريال</th>
                <th>الحركة</th>
                <th>الفاعل</th>
                <th>التاريخ</th>
              </tr>
            </thead>
            <tbody>
              {movements.length === 0 && (
                <tr>
                  <td colSpan={4} className="py-6 text-center text-slate-400">
                    مفيش حركات
                  </td>
                </tr>
              )}
              {movements.map((m) => (
                <tr key={m.id}>
                  <td data-label="السيريال" dir="ltr" className="text-left font-mono">
                    {m.laptops?.serial ?? '-'}
                  </td>
                  <td data-label="الحركة">{m.stage_code ?? m.action}</td>
                  <td data-label="الفاعل">{m.profiles?.full_name ?? '-'}</td>
                  <td data-label="التاريخ">{formatDate(m.created_at)}</td>
                </tr>
              ))}
            </tbody>
          </table>
        </div>
      </div>
    </Layout>
  )
}

function CompareRow({ label, current, previous }) {
  const delta = pct(current, previous)
  const tone = delta === null ? 'text-slate-400' : delta >= 0 ? 'text-emerald-700' : 'text-red-600'
  return (
    <tr>
      <td data-label="المؤشر">{label}</td>
      <td data-label="الفترة الحالية" className="font-medium">{formatNumber(current)}</td>
      <td data-label="الفترة السابقة">{formatNumber(previous)}</td>
      <td data-label="الفرق" className={`font-medium ${tone}`}>
        {delta === null ? '—' : `${delta >= 0 ? '+' : ''}${formatNumber(delta)}%`}
      </td>
    </tr>
  )
}

function Stat({ label, value, tone }) {
  const tones = {
    emerald: 'text-emerald-700',
    amber: 'text-amber-700',
    violet: 'text-violet-700',
    red: 'text-red-600',
    default: 'text-slate-900',
  }
  return (
    <div className="card">
      <div className="text-xs text-slate-500">{label}</div>
      <div className={`text-2xl font-bold ${tones[tone] ?? tones.default}`}>{value}</div>
    </div>
  )
}
