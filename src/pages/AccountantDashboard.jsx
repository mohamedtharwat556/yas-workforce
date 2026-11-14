import { useEffect, useMemo, useState } from 'react'
import {
  Bar,
  BarChart,
  CartesianGrid,
  Legend,
  Line,
  LineChart,
  ResponsiveContainer,
  Tooltip,
  XAxis,
  YAxis,
} from 'recharts'
import Layout from '../components/Layout'
import EntryDetails from '../components/EntryDetails'
import StatusBadge from '../components/StatusBadge'
import { supabase } from '../lib/supabase'
import { formatDate, formatNumber, startOfMonth, startOfWeek, toISODate, entryLines, entryOperationNames, entryTotalQty } from '../lib/dates'
import { printReport } from '../lib/report'
import { exportXlsx, exportXlsxSheets } from '../lib/xlsx'

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

// ألوان ثابتة لأنواع التست على الشارت (كل نوع لون)
const CHART_COLORS = ['#1d4ed8', '#0891b2', '#059669', '#d97706', '#7c3aed', '#64748b', '#dc2626', '#0f766e']

export default function AccountantDashboard() {
  const [period, setPeriod] = useState('month')
  const [customStart, setCustomStart] = useState(toISODate(startOfMonth()))
  const [customEnd, setCustomEnd] = useState(toISODate(new Date()))
  const [entries, setEntries] = useState([])
  const [archivedEntries, setArchivedEntries] = useState([])
  const [showArchive, setShowArchive] = useState(false)
  const [archiveBusy, setArchiveBusy] = useState(null)
  const [loading, setLoading] = useState(false)
  const [ai, setAi] = useState(null)
  const [aiBusy, setAiBusy] = useState(false)
  const [aiError, setAiError] = useState('')
  const [openWorkerId, setOpenWorkerId] = useState(null)
  const [detailId, setDetailId] = useState(null)

  // فلاتر
  const [operations, setOperations] = useState([])
  const [opFilter, setOpFilter] = useState('')
  const [workerFilter, setWorkerFilter] = useState('')

  // نظرة عامة
  const [overview, setOverview] = useState(null)
  const [activeWorkers, setActiveWorkers] = useState(0)
  const [stageMap, setStageMap] = useState({})

  const range = useMemo(() => {
    if (period === 'week') return { start: toISODate(startOfWeek()), end: toISODate(new Date()) }
    if (period === 'month') return { start: toISODate(startOfMonth()), end: toISODate(new Date()) }
    return { start: customStart, end: customEnd }
  }, [period, customStart, customEnd])

  // أدوات الفلتر + النظرة العامة (تُحمّل مرة واحدة)
  useEffect(() => {
    let active = true
    async function loadMeta() {
      const weekStart = startOfWeek()
      const monthStart = startOfMonth()
      const from = weekStart < monthStart ? weekStart : monthStart
      const [o, cnt, e, st] = await Promise.all([
        supabase.from('operations').select('*').order('sort_order'),
        supabase.from('employees').select('id', { count: 'exact', head: true }).eq('active', true),
        supabase
          .from('production_entries')
          .select('entry_date, quantity, operations(name_ar), entry_operations(quantity, operations(name_ar))')
          .in('status', ['approved', 'released'])
          .gte('entry_date', toISODate(from)),
        supabase.from('stages').select('code, name_ar'),
      ])
      if (!active) return
      setOperations(o.data ?? [])
      setActiveWorkers(cnt.count ?? 0)
      setStageMap(Object.fromEntries((st.data ?? []).map((s) => [s.code, s.name_ar])))

      const list = e.data ?? []
      const today = toISODate(new Date())
      const wsI = toISODate(weekStart)
      const msI = toISODate(monthStart)
      const calc = (pred) => {
        const r = list.filter(pred)
        return {
          laps: r.reduce((s, x) => s + entryLines(x).reduce((a, l) => a + l.quantity, 0), 0),
        }
      }
      setOverview({
        today: calc((x) => x.entry_date === today),
        week: calc((x) => x.entry_date >= wsI),
        month: calc((x) => x.entry_date >= msI),
      })
    }
    loadMeta()
    return () => {
      active = false
    }
  }, [])

  useEffect(() => {
    let active = true
    const ENTRY_SELECT =
      '*, employees!production_entries_worker_id_fkey(full_name), operations(name_ar), entry_operations(operation_id, quantity, operations(name_ar)), lap_serials(serial, laptop_type, model, stage_code, operation_id, operations(name_ar))'
    async function load() {
      setLoading(true)
      const [e, ar] = await Promise.all([
        supabase
          .from('production_entries')
          .select(ENTRY_SELECT)
          .in('status', ['approved', 'released'])
          .gte('entry_date', range.start)
          .lte('entry_date', range.end),
        supabase
          .from('production_entries')
          .select(ENTRY_SELECT)
          .eq('status', 'archived')
          .gte('entry_date', range.start)
          .lte('entry_date', range.end),
      ])
      if (!active) return
      setEntries(e.data ?? [])
      setArchivedEntries(ar.data ?? [])
      setLoading(false)
    }
    load()
    return () => {
      active = false
    }
  }, [range.start, range.end])

  // إدخالات بعد تطبيق فلاتر الموظف ونوع العملية
  const filtered = useMemo(
    () =>
      entries.filter(
        (e) =>
          (!opFilter || entryLines(e).some((l) => String(l.operation_id) === String(opFilter))) &&
          (!workerFilter || e.worker_id === workerFilter)
      ),
    [entries, opFilter, workerFilter]
  )

  const workerOptions = useMemo(() => {
    const map = new Map()
    for (const e of entries) {
      if (!map.has(e.worker_id)) map.set(e.worker_id, e.employees?.full_name ?? 'غير معروف')
    }
    return Array.from(map, ([id, name]) => ({ id, name })).sort((a, b) => a.name.localeCompare(b.name, 'ar'))
  }, [entries])

  const rows = useMemo(() => {
    const map = new Map()
    for (const e of filtered) {
      const id = e.worker_id
      const name = e.employees?.full_name ?? 'غير معروف'
      const lines = entryLines(e)
      const qty = lines.reduce((s, l) => s + l.quantity, 0)
      if (!map.has(id)) map.set(id, { id, name, laps: 0 })
      const row = map.get(id)
      row.laps += qty
    }
    return Array.from(map.values()).sort((a, b) => b.laps - a.laps)
  }, [filtered])

  const totals = useMemo(
    () => rows.reduce((acc, r) => ({ laps: acc.laps + r.laps }), { laps: 0 }),
    [rows]
  )

  // الإدخالات المعتمدة من المشرف (قبل الأرشفة) + الأرشيف
  const approvedList = useMemo(
    () => filtered.slice().sort((a, b) => b.entry_date.localeCompare(a.entry_date)),
    [filtered]
  )

  const archivedList = useMemo(
    () =>
      archivedEntries
        .filter(
          (e) =>
            (!opFilter || entryLines(e).some((l) => String(l.operation_id) === String(opFilter))) &&
            (!workerFilter || e.worker_id === workerFilter)
        )
        .slice()
        .sort((a, b) => b.entry_date.localeCompare(a.entry_date)),
    [archivedEntries, opFilter, workerFilter]
  )

  // تفصيل حسب نوع العملية
  const byOperation = useMemo(() => {
    const map = new Map()
    for (const e of filtered) {
      for (const l of entryLines(e)) {
        const name = l.name
        if (!map.has(name)) map.set(name, { name, laps: 0 })
        const row = map.get(name)
        row.laps += l.quantity
      }
    }
    return Array.from(map.values()).sort((a, b) => b.laps - a.laps)
  }, [filtered])

  // الأساس اللي بُنت عليه كل التقارير: كل موظف × نوع التاست (العملية) × عدد اللابات
  const byWorkerOperation = useMemo(() => {
    const map = new Map()
    for (const e of filtered) {
      const name = e.employees?.full_name ?? 'غير معروف'
      for (const l of entryLines(e)) {
        const key = `${name}||${l.name}`
        if (!map.has(key)) map.set(key, { name, operation: l.name, laps: 0 })
        map.get(key).laps += l.quantity
      }
    }
    return Array.from(map.values()).sort(
      (a, b) => a.name.localeCompare(b.name, 'ar') || b.laps - a.laps
    )
  }, [filtered])

  // نفس التفصيل بس مجمّع لكل موظف: «سهير: تاست خفيف 2 · تجميع 2» بدل رقم واحد
  const workerBreakdown = useMemo(() => {
    const m = new Map()
    for (const r of byWorkerOperation) {
      const arr = m.get(r.name) ?? []
      arr.push({ operation: r.operation, laps: r.laps })
      m.set(r.name, arr)
    }
    return m
  }, [byWorkerOperation])

  // بيانات الشارت: كل موظف مقسوم لأنواع التست (بار مركّب لكل نوع بلون مختلف)
  const chartOps = useMemo(
    () => Array.from(new Set(byWorkerOperation.map((r) => r.operation))),
    [byWorkerOperation]
  )

  const chartRows = useMemo(() => {
    const m = new Map()
    for (const r of byWorkerOperation) {
      const row = m.get(r.name) ?? { name: r.name, total: 0 }
      row[r.operation] = (row[r.operation] ?? 0) + r.laps
      row.total += r.laps
      m.set(r.name, row)
    }
    return Array.from(m.values()).sort((a, b) => b.total - a.total)
  }, [byWorkerOperation])

  // الأساس بتاع شيت الـ Excel: كل لاب على حدة (الموظف × نوع اللاب × نوع التاست × العدد).
  // بنقرا من سطور اللابات نفسها — سطر اللاب بيتحدّث في مكانه في دورة الصيانة
  // فمفيش أي احتمال إن اللاب يتحسب مرتين.
  const laptopRows = useMemo(() => {
    const map = new Map()
    for (const e of filtered) {
      const name = e.employees?.full_name ?? 'غير معروف'
      const serials = e.lap_serials ?? []
      if (!serials.length) {
        // إدخال قديم من غير سطور لابات مسجّلة
        for (const l of entryLines(e)) {
          const key = `${name}||—||${l.name}`
          if (!map.has(key)) map.set(key, { name, laptop_type: '—', test: l.name, count: 0 })
          map.get(key).count += l.quantity
        }
        continue
      }
      for (const s of serials) {
        const laptopType = s.laptop_type || '—'
        const test = s.operations?.name_ar ?? e.operations?.name_ar ?? '—'
        const key = `${name}||${laptopType}||${test}`
        if (!map.has(key)) map.set(key, { name, laptop_type: laptopType, test, count: 0 })
        map.get(key).count += 1
      }
    }
    return Array.from(map.values()).sort(
      (a, b) => a.name.localeCompare(b.name, 'ar') || b.count - a.count
    )
  }, [filtered])

  // الاتجاه اليومي
  const byDay = useMemo(() => {
    const map = new Map()
    for (const e of filtered) {
      const day = e.entry_date
      if (!map.has(day)) map.set(day, { date: day, label: formatDate(day), laps: 0 })
      const row = map.get(day)
      const lines = entryLines(e)
      row.laps += lines.reduce((s, l) => s + l.quantity, 0)
    }
    return Array.from(map.values()).sort((a, b) => a.date.localeCompare(b.date))
  }, [filtered])

  const openWorker = rows.find((r) => r.id === openWorkerId) ?? null
  const workerEntries = useMemo(
    () => filtered.filter((e) => e.worker_id === openWorkerId),
    [filtered, openWorkerId]
  )

  function exportCSV() {
    const head = ['#', 'اسم الموظف', 'نوع التاست', 'عدد اللابات']
    const body = byWorkerOperation.map((r, i) => [i + 1, r.name, r.operation, r.laps])
    const csv =
      '\uFEFF' +
      [head, ...body]
        .map((line) => line.map((cell) => `"${String(cell).replace(/"/g, '""')}"`).join(','))
        .join('\r\n')
    const blob = new Blob([csv], { type: 'text/csv;charset=utf-8;' })
    const url = URL.createObjectURL(blob)
    const link = document.createElement('a')
    link.href = url
    link.download = `yas-report_${range.start}_${range.end}.csv`
    document.body.appendChild(link)
    link.click()
    document.body.removeChild(link)
    URL.revokeObjectURL(url)
  }

  // شيت Excel: بيانات خالص من غير أي إجمالي أو عناوين — الموظف + نوع اللاب + نوع التاست + العدد
  function exportExcel() {
    exportXlsx({
      filename: `yas-report_${range.start}_${range.end}.xlsx`,
      sheetName: 'التقرير',
      headers: ['الموظف', 'نوع اللاب', 'نوع التاست', 'العدد'],
      rows: laptopRows.map((r) => [r.name, r.laptop_type, r.test, r.count]),
    })
  }

  function exportPDF() {
    printReport({
      title: 'تقرير الإنتاجية',
      period: range,
      totals,
      rows,
      byOperation,
    })
  }

  // شيت Excel: جدول بيانات خالص — الأساس موظف × نوع التاست × عدد اللابات،
  // + تفصيل الإدخالات، + تفصيل كل لاب. من غير أي عناوين أو نص زيادة.
  function exportAiExcel() {
    exportXlsxSheets({
      filename: `yas-ai-report_${range.start}_${range.end}.xlsx`,
      sheets: [
        {
          sheetName: 'ملخّص الموظفين',
          headers: ['الموظف', 'نوع اللاب', 'نوع التاست', 'العدد'],
          rows: laptopRows.map((r) => [r.name, r.laptop_type, r.test, r.count]),
        },
        {
          sheetName: 'تفصيل الإدخالات',
          headers: ['اسم الموظف', 'التاريخ', 'نوع التاست', 'عدد اللابات', 'ملاحظات'],
          rows: filtered.flatMap((e) =>
            entryLines(e).map((l) => [
              e.employees?.full_name ?? 'غير معروف',
              e.entry_date,
              l.name,
              l.quantity,
              e.notes ?? '',
            ])
          ),
        },
        {
          sheetName: 'تفصيل اللابات',
          headers: ['اسم الموظف', 'التاريخ', 'نوع اللاب', 'الموديل', 'السيريال', 'الحالة', 'نوع التاست'],
          rows: filtered.flatMap((e) =>
            (e.lap_serials ?? []).map((s) => [
              e.employees?.full_name ?? 'غير معروف',
              e.entry_date,
              s.laptop_type ?? '—',
              s.model ?? '—',
              s.serial,
              s.stage_code ? (stageMap[s.stage_code] ?? s.stage_code) : 'سليم',
              s.operations?.name_ar ?? '—',
            ])
          ),
        },
      ],
    })
  }

  async function archiveEntry(entry) {
    if (!window.confirm('تأرشف الإدخال ده؟ هيتشال من القوايم ويروح الأرشيف.')) return
    setArchiveBusy(entry.id)
    const { error } = await supabase.rpc('fn_archive_entry', { p_entry_id: entry.id })
    setArchiveBusy(null)
    if (error) return window.alert(error.message)
    setEntries((prev) => prev.filter((e) => e.id !== entry.id))
    setArchivedEntries((prev) => [entry, ...prev])
  }

  // إصدار الإدخال: approved → released (القفل النهائي اللي بيحسب الإنتاج)
  async function releaseEntry(entry) {
    if (!window.confirm('تأكيد إصدار الإدخال ده؟ هيتقفل نهائيًا ويتحسب في التقارير.')) return
    setArchiveBusy(entry.id)
    const { error } = await supabase.rpc('fn_release_entry', { p_entry_id: entry.id })
    setArchiveBusy(null)
    if (error) return window.alert(error.message)
    setEntries((prev) => prev.map((e) => (e.id === entry.id ? { ...e, status: 'released' } : e)))
    window.alert('تم إصدار الإدخال.')
  }

  async function restoreEntry(entry) {
    setArchiveBusy(entry.id)
    const { error } = await supabase.rpc('fn_restore_entry', { p_entry_id: entry.id })
    setArchiveBusy(null)
    if (error) return window.alert(error.message)
    setArchivedEntries((prev) => prev.filter((e) => e.id !== entry.id))
    setEntries((prev) => [{ ...entry, status: 'approved' }, ...prev])
  }

  async function runAI() {
    setAiBusy(true)
    setAiError('')
    setAi(null)
    try {
      // بيانات كل موظف: إجمالي لاباته + تفصيل كل نوع تاست عمله (الأساس)
      const workerStats = rows.map((r) => {
        const ops = byWorkerOperation
          .filter((w) => w.name === r.name)
          .map((w) => ({ operation: w.operation, laps: w.laps }))
        return { name: r.name, laps: r.laps, operations: ops }
      })
      const { data, error } = await supabase.functions.invoke('ai-analysis', {
        body: {
          period: range,
          totals,
          workers: workerStats,
          entries: filtered.map((e) => ({
            worker: e.employees?.full_name,
            operation: entryLines(e)
              .map((l) => `${l.name} × ${l.quantity}`)
              .join(' + '),
            quantity: entryLines(e).reduce((s, l) => s + l.quantity, 0),
            date: e.entry_date,
            notes: e.notes,
          })),
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

  async function deleteAllEntries() {
    if (
      !window.confirm(
        'تحذير: هيتم حذف كل إدخالات الإنتاج في النظام نهائيًا (كل الموظفين وكل الفترات). تكمل؟'
      )
    )
      return
    if (!window.confirm('تأكيد أخير: مفيش رجوع بعد الحذف. متأكد؟')) return
    setLoading(true)
    const { error } = await supabase.rpc('fn_delete_all_entries')
    if (error) {
      setLoading(false)
      return window.alert(error.message)
    }
    setEntries([])
    setArchivedEntries([])
    setAi(null)
    setAiError('')
    setOverview({ today: { laps: 0 }, week: { laps: 0 }, month: { laps: 0 } })
    setLoading(false)
    window.alert('تم حذف كل الإدخالات.')
  }

  return (
    <Layout title="التقارير">
      <div className="card mb-6 flex flex-wrap items-end gap-3">
        <div className="w-full sm:w-auto">
          <label className="label">الفترة</label>
          <select className="input w-40" value={period} onChange={(e) => setPeriod(e.target.value)}>
            <option value="week">هذا الأسبوع</option>
            <option value="month">هذا الشهر</option>
            <option value="custom">مخصّص</option>
          </select>
        </div>
        {period === 'custom' && (
          <>
            <div className="w-full sm:w-auto">
              <label className="label">من</label>
              <input type="date" className="input" value={customStart} onChange={(e) => setCustomStart(e.target.value)} />
            </div>
            <div className="w-full sm:w-auto">
              <label className="label">إلى</label>
              <input type="date" className="input" value={customEnd} onChange={(e) => setCustomEnd(e.target.value)} />
            </div>
          </>
        )}
        <div className="w-full sm:w-auto">
          <label className="label">الموظف</label>
          <select className="input w-44" value={workerFilter} onChange={(e) => setWorkerFilter(e.target.value)}>
            <option value="">كل الموظفين</option>
            {workerOptions.map((w) => (
              <option key={w.id} value={w.id}>{w.name}</option>
            ))}
          </select>
        </div>
        <div className="w-full sm:w-auto">
          <label className="label">نوع العملية</label>
          <select className="input w-44" value={opFilter} onChange={(e) => setOpFilter(e.target.value)}>
            <option value="">كل العمليات</option>
            {operations.map((o) => (
              <option key={o.id} value={o.id}>{o.name_ar}</option>
            ))}
          </select>
        </div>
        <div className="text-sm text-slate-500 mb-2">
          {range.start} ← {range.end}
        </div>
        <div className="flex-1" />
        <button onClick={exportExcel} disabled={laptopRows.length === 0} className="btn-ghost">
          تصدير Excel
        </button>
        <button onClick={exportPDF} disabled={rows.length === 0} className="btn-accent">
          تصدير PDF
        </button>
        <button onClick={exportCSV} disabled={rows.length === 0} className="btn-ghost">
          تصدير CSV
        </button>
        <button onClick={exportAiExcel} disabled={filtered.length === 0} className="btn-ghost">
          تصدير شيت الموظفين (Excel)
        </button>
        <button onClick={runAI} disabled={aiBusy || rows.length === 0} className="btn-primary">
          {aiBusy ? 'جاري التحليل…' : 'تقرير AI'}
        </button>
        <button onClick={deleteAllEntries} disabled={loading} className="btn-danger">
          حذف الكل
        </button>
      </div>

      <p className="mb-3 text-xs text-slate-500">
        التقرير بيحسب كل الإدخالات <b>المعتمدة</b> من المشرف (+ المُصدرة) في الفترة المختارة.
      </p>

      <div className="grid gap-4 md:grid-cols-4 mb-6">
        <Stat label="لابات النهاردة" value={overview?.today.laps ?? 0} />
        <Stat label="لابات الأسبوع" value={overview?.week.laps ?? 0} />
        <Stat label="لابات الشهر" value={overview?.month.laps ?? 0} />
        <Stat label="الموظفين النشطين" value={activeWorkers} />
      </div>

      <div className="grid gap-4 md:grid-cols-2 mb-6">
        <Stat label="إجمالي اللابات (الفترة)" value={totals.laps} />
      </div>

      {/* الإدخالات المعتمدة من المشرف — بتوصل هنا أوتوماتيك بعد اعتماد المشرف */}
      <div className="card mb-6">
        <div className="mb-3 flex flex-wrap items-center justify-between gap-2">
          <div>
            <h2 className="font-bold text-lg">
              {showArchive ? 'الأرشيف' : 'إدخالات جاهزة للإصدار'}{' '}
              <span className="text-sm font-normal text-slate-400">
                ({(showArchive ? archivedList : approvedList).length})
              </span>
            </h2>
            <p className="text-xs text-slate-500 mt-0.5">
              {showArchive
                ? 'الإدخالات المؤرشفة (مش بتتحسب في التقارير).'
                : 'دي الإدخالات اللي المشرف اعتمدها — دوس «إصدار» عشان تتقفل وتتحسب نهائيًا، أو «أرشفة» لو مش محتاجها.'}
            </p>
          </div>
          <button onClick={() => setShowArchive((v) => !v)} className="btn-ghost !py-1.5 text-sm">
            {showArchive ? 'رجوع للإدخالات المعتمدة' : `عرض الأرشيف (${archivedEntries.length})`}
          </button>
        </div>
        <div className="table-wrap">
          <table className="table table-cards">
            <thead>
              <tr>
                <th>التاريخ</th>
                <th>الموظف</th>
                <th>العملية</th>
                <th>العدد</th>
                <th>الحالة</th>
                <th>إجراء</th>
              </tr>
            </thead>
            <tbody>
              {(() => {
                const list = showArchive ? archivedList : approvedList
                if (loading)
                  return (
                    <tr>
                      <td colSpan={6} className="text-center text-slate-400 py-6">جاري التحميل…</td>
                    </tr>
                  )
                if (list.length === 0)
                  return (
                    <tr>
                      <td colSpan={6} className="text-center text-slate-400 py-6">
                        {showArchive ? 'مفيش إدخالات في الأرشيف' : 'مفيش إدخالات معتمدة في الفترة دي'}
                      </td>
                    </tr>
                  )
                return list.map((e) => (
                  <tr key={e.id}>
                    <td data-label="التاريخ">{formatDate(e.entry_date)}</td>
                    <td data-label="الموظف">{e.employees?.full_name ?? '-'}</td>
                    <td data-label="العملية">{entryOperationNames(e)}</td>
                    <td data-label="العدد">{formatNumber(entryTotalQty(e))}</td>
                    <td data-label="الحالة"><StatusBadge status={e.status} /></td>
                    <td data-label="إجراء" className="whitespace-nowrap">
                      {showArchive ? (
                        <button
                          disabled={archiveBusy === e.id}
                          onClick={() => restoreEntry(e)}
                          className="btn-ghost !py-1 !px-2 text-xs"
                        >
                          استرجاع
                        </button>
                      ) : (
                        <div className="flex gap-2">
                          {e.status === 'approved' && (
                            <button
                              disabled={archiveBusy === e.id}
                              onClick={() => releaseEntry(e)}
                              className="btn-accent !py-1 !px-3 text-xs"
                            >
                              إصدار
                            </button>
                          )}
                          <button
                            disabled={archiveBusy === e.id}
                            onClick={() => archiveEntry(e)}
                            className="btn-danger !py-1 !px-2 text-xs"
                          >
                            أرشفة
                          </button>
                        </div>
                      )}
                    </td>
                  </tr>
                ))
              })()}
            </tbody>
          </table>
        </div>
      </div>

      {(ai || aiError) && (
        <div className={`card mb-6 ${aiError ? 'border-red-200 bg-red-50' : 'border-slate-200'}`}>
          <div className="mb-2 flex flex-wrap items-center justify-between gap-2">
            <h2 className="font-bold text-lg">تحليل الذكاء الاصطناعي</h2>
          </div>
          {aiError ? (
            <p className="text-red-700 text-sm">{aiError}</p>
          ) : (
            <div className="text-sm leading-7 whitespace-pre-wrap text-slate-700">{ai.summary}</div>
          )}
        </div>
      )}

      <div className="grid gap-6 lg:grid-cols-2 mb-6">
        <div className="card min-w-0">
          <h2 className="font-bold text-lg mb-3">العدد لكل موظف (مقسّم على أنواع التست)</h2>
          <div style={{ width: '100%', height: 280 }}>
            <ResponsiveContainer>
              <BarChart data={chartRows} margin={{ top: 10, right: 10, left: 0, bottom: 40 }}>
                <CartesianGrid strokeDasharray="3 3" vertical={false} />
                <XAxis dataKey="name" angle={-30} textAnchor="end" interval="preserveStartEnd" height={60} tick={{ fontSize: 12 }} />
                <YAxis tick={{ fontSize: 12 }} />
                <Tooltip />
                <Legend wrapperStyle={{ fontSize: 12 }} />
                {chartOps.map((op, i) => (
                  <Bar
                    key={op}
                    dataKey={op}
                    stackId="laps"
                    fill={CHART_COLORS[i % CHART_COLORS.length]}
                    name={op}
                    radius={i === chartOps.length - 1 ? [4, 4, 0, 0] : 0}
                  />
                ))}
              </BarChart>
            </ResponsiveContainer>
          </div>
        </div>

        <div className="card">
          <h2 className="font-bold text-lg mb-3">الترتيب والتفاصيل</h2>
          <div className="table-wrap">
            <table className="table table-cards">
              <thead>
                <tr>
                  <th>#</th>
                  <th>الموظف</th>
                  <th>لابات</th>
                  <th>التفصيل حسب نوع التست</th>
                </tr>
              </thead>
              <tbody>
                {loading && (
                  <tr>
                    <td colSpan={4} className="text-center text-slate-400 py-6">جاري التحميل…</td>
                  </tr>
                )}
                {!loading && rows.length === 0 && (
                  <tr>
                    <td colSpan={4} className="text-center text-slate-400 py-6">مفيش بيانات في الفترة دي</td>
                  </tr>
                )}
                {rows.map((r, i) => (
                  <tr key={r.id}>
                    <td data-label="#" className="text-slate-400">{i + 1}</td>
                    <td data-label="الموظف">
                      <button
                        onClick={() => setOpenWorkerId(r.id)}
                        className="font-medium text-slate-900 underline decoration-dotted"
                      >
                        {r.name}
                      </button>
                    </td>
                    <td data-label="لابات">{formatNumber(r.laps)}</td>
                    <td data-label="التفصيل حسب نوع التست" className="text-xs text-slate-600">
                      {(workerBreakdown.get(r.name) ?? [])
                        .map((b) => `${b.operation} ${formatNumber(b.laps)}`)
                        .join(' · ') || '—'}
                    </td>
                  </tr>
                ))}
              </tbody>
            </table>
          </div>
        </div>
      </div>

      <div className="grid gap-6 lg:grid-cols-2">
        <div className="card">
          <h2 className="font-bold text-lg mb-3">التفصيل حسب نوع العملية</h2>
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
                    <td colSpan={3} className="text-center text-slate-400 py-6">مفيش بيانات في الفترة دي</td>
                  </tr>
                )}
                {byOperation.map((o) => (
                  <tr key={o.name}>
                    <td data-label="العملية">{o.name}</td>
                    <td data-label="لابات">{formatNumber(o.laps)}</td>
                    <td data-label="النسبة">{totals.laps ? Math.round((o.laps / totals.laps) * 100) : 0}%</td>
                  </tr>
                ))}
              </tbody>
            </table>
          </div>
        </div>

        <div className="card min-w-0">
          <h2 className="font-bold text-lg mb-3">الاتجاه اليومي (العدد)</h2>
          <div style={{ width: '100%', height: 280 }}>
            <ResponsiveContainer>
              <LineChart data={byDay} margin={{ top: 10, right: 10, left: 0, bottom: 40 }}>
                <CartesianGrid strokeDasharray="3 3" vertical={false} />
                <XAxis dataKey="label" angle={-30} textAnchor="end" interval="preserveStartEnd" height={60} tick={{ fontSize: 11 }} />
                <YAxis tick={{ fontSize: 12 }} />
                <Tooltip />
                <Line type="monotone" dataKey="laps" stroke="#1d4ed8" strokeWidth={2} name="عدد" dot={{ r: 3 }} />
              </LineChart>
            </ResponsiveContainer>
          </div>
        </div>
      </div>

      {openWorker && (
        <WorkerEntriesModal
          worker={openWorker}
          entries={workerEntries}
          onClose={() => setOpenWorkerId(null)}
          onOpenEntry={setDetailId}
        />
      )}

      {detailId && <EntryDetails entryId={detailId} onClose={() => setDetailId(null)} />}
    </Layout>
  )
}

function WorkerEntriesModal({ worker, entries, onClose, onOpenEntry }) {
  return (
    <div className="fixed inset-0 z-40 flex items-end justify-center bg-black/50 md:items-center md:p-4" onClick={onClose} role="dialog" aria-modal="true">
      <div className="card max-h-[92vh] w-full overflow-y-auto rounded-b-none rounded-t-2xl md:my-8 md:max-w-3xl md:rounded-xl" onClick={(e) => e.stopPropagation()}>
        <div className="mb-4 flex items-center justify-between">
          <h2 className="text-lg font-bold">
            إدخالات {worker.name} <span className="text-sm font-normal text-slate-400">({entries.length})</span>
          </h2>
          <button onClick={onClose} className="btn-ghost !px-3 !py-1 text-sm">
            إغلاق
          </button>
        </div>
        <div className="table-wrap">
          <table className="table table-cards">
            <thead>
              <tr>
                <th>التاريخ</th>
                <th>العملية</th>
                <th>العدد</th>
                <th>الملاحظة</th>
                <th></th>
              </tr>
            </thead>
            <tbody>
              {entries.length === 0 && (
                <tr>
                  <td colSpan={5} className="text-center text-slate-400 py-6">مفيش إدخالات في الفترة دي</td>
                </tr>
              )}
              {entries.map((e) => (
                <tr key={e.id}>
                  <td data-label="التاريخ">{formatDate(e.entry_date)}</td>
                  <td data-label="العملية">
                    {entryLines(e)
                      .map((l) => `${l.name} × ${l.quantity}`)
                      .join(' + ')}
                  </td>
                  <td data-label="العدد">{formatNumber(entryLines(e).reduce((s, l) => s + l.quantity, 0))}</td>
                  <td data-label="الملاحظة" className="max-w-[200px] truncate" title={e.notes ?? ''}>{e.notes || '-'}</td>
                  <td data-label="إجراء">
                    <button onClick={() => onOpenEntry(e.id)} className="btn-ghost !py-1 !px-2 text-xs">
                      تفاصيل
                    </button>
                  </td>
                </tr>
              ))}
            </tbody>
          </table>
        </div>
      </div>
    </div>
  )
}

function Stat({ label, value }) {
  return (
    <div className="card">
      <p className="text-sm text-slate-500">{label}</p>
      <p className="text-3xl font-bold mt-1">{formatNumber(value)}</p>
    </div>
  )
}
