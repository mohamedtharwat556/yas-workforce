import { useMemo, useRef, useState } from 'react'
import * as XLSX from 'xlsx'
import {
  Bar,
  BarChart,
  CartesianGrid,
  Cell,
  Legend,
  Line,
  LineChart,
  Pie,
  PieChart,
  ResponsiveContainer,
  Tooltip,
  XAxis,
  YAxis,
} from 'recharts'
import Layout from '../components/Layout'
import { supabase } from '../lib/supabase'
import { formatNumber } from '../lib/dates'
import { exportXlsxSheets } from '../lib/xlsx'

// أقصى عدد صفوف بتُرسل للتحليل (عشان الملفات الكبيرة ما تعلّقش الدالة)
const MAX_ROWS = 800
const PREVIEW_ROWS = 30

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

// تحويل قيمة الخانة لنص/رقم بسيط (التواريخ تتحوّل لتاريخ ISO)
function cellValue(v) {
  if (v === null || v === undefined) return ''
  if (v instanceof Date) return v.toISOString().slice(0, 10)
  return v
}

// كلمات بنستدل بيها على وظيفة العمود من اسمه
const COUNT_WORDS = ['عدد', 'العدد', 'كمية', 'الكمية', 'اجمالي', 'إجمالي', 'اجمالى', 'قيمة', 'total', 'count', 'qty', 'quantity']
const LAP_WORDS = ['لاب', 'لابات', 'laptop', 'laptops']
const GROUP_WORDS = ['اسم', 'موظف', 'مندوب', 'نوع', 'فرع', 'قسم', 'حالة', 'محل', 'صنف', 'ماركة', 'name', 'type', 'branch', 'status', 'category']
// كلمات بتدل على إن العمود فيه أسماء الأشخاص/الموظفين
const EMP_WORDS = ['اسم', 'موظف', 'مندوب', 'عامل', 'فني', 'مشغل', 'موظفين', 'employee', 'worker', 'staff', 'name', 'tech', 'operator']

function hasWord(label, words) {
  const s = String(label ?? '').toLowerCase()
  return words.some((w) => s.includes(w))
}

// بنحوّل قيمة الخانة لرقم لو كانت رقم فعلاً (بنتعامل مع الأرقام العربية والفواصل)
function toNumber(v) {
  if (typeof v === 'number') return Number.isFinite(v) ? v : null
  if (typeof v !== 'string') return null
  const s = v.trim().replace(/[,\s٬]/g, '').replace(/[٠-٩]/g, (d) => String('٠١٢٣٤٥٦٧٨٩'.indexOf(d)))
  if (!/^-?\d+(\.\d+)?$/.test(s)) return null
  const n = Number(s)
  return Number.isFinite(n) ? n : null
}

function colLabel(h, i) {
  return String(h ?? '').trim() || `عمود ${i + 1}`
}

const MONTHS_AR = ['يناير', 'فبراير', 'مارس', 'أبريل', 'مايو', 'يونيو', 'يوليو', 'أغسطس', 'سبتمبر', 'أكتوبر', 'نوفمبر', 'ديسمبر']
const PIE_COLORS = ['#1d4ed8', '#0891b2', '#059669', '#d97706', '#7c3aed', '#64748b']

function monthLabel(key) {
  const [y, m] = key.split('-')
  return `${MONTHS_AR[Number(m) - 1] ?? m} ${y}`
}

// بنعتبر الخانة تاريخ لو كانت تاريخ فعلي (نوع Date) أو نص بتنسيق تاريخ معروف
function toDate(v) {
  if (v instanceof Date && !Number.isNaN(v.getTime())) return v
  if (typeof v !== 'string') return null
  const s = v.trim()
  let m = s.match(/^(\d{4})[-/](\d{1,2})(?:[-/](\d{1,2}))?$/)
  if (m) return new Date(Number(m[1]), Number(m[2]) - 1, Number(m[3] ?? 1))
  m = s.match(/^(\d{1,2})[-/](\d{1,2})[-/](\d{4})$/)
  if (m) return new Date(Number(m[3]), Number(m[2]) - 1, Number(m[1]))
  return null
}

export default function SheetAnalysis() {
  const fileRef = useRef(null)
  const [workbook, setWorkbook] = useState(null)
  const [fileName, setFileName] = useState('')
  const [sheetNames, setSheetNames] = useState([])
  const [activeSheet, setActiveSheet] = useState('')
  const [headers, setHeaders] = useState([])
  const [bodyRows, setBodyRows] = useState([])
  const [parseError, setParseError] = useState('')
  const [aiBusy, setAiBusy] = useState(false)
  const [ai, setAi] = useState(null)
  const [aiError, setAiError] = useState('')
  const [countCol, setCountCol] = useState('')

  // نقرا ورقة معيّنة من الملف ونطلّع منها الأعمدة + الصفوف
  function pickSheet(wb, name) {
    const ws = wb.Sheets[name]
    const aoa = XLSX.utils.sheet_to_json(ws, { header: 1, blankrows: false, defval: '' })
    const rows = aoa.filter((r) => (r ?? []).some((c) => String(c ?? '').trim() !== ''))
    const [head = [], ...body] = rows
    // لو في صفوف أوسع من صف الرؤوس، بنكمّل الأعمدة الناقصة
    const width = body.reduce((w, r) => Math.max(w, (r ?? []).length), head.length)
    setHeaders(Array.from({ length: width }, (_, i) => String(head[i] ?? '').trim()))
    setBodyRows(body)
    setCountCol('')
  }

  function resetResult() {
    setAi(null)
    setAiError('')
  }

  async function onFile(e) {
    const file = e.target.files?.[0]
    if (!file) return
    setParseError('')
    resetResult()
    setFileName(file.name)
    try {
      const buf = await file.arrayBuffer()
      const wb = XLSX.read(buf, { type: 'array', cellDates: true })
      if (!wb.SheetNames.length) throw new Error('الملف مفيهوش أي ورقة.')
      setWorkbook(wb)
      setSheetNames(wb.SheetNames)
      setActiveSheet(wb.SheetNames[0])
      pickSheet(wb, wb.SheetNames[0])
    } catch (err) {
      setWorkbook(null)
      setSheetNames([])
      setActiveSheet('')
      setHeaders([])
      setBodyRows([])
      setParseError(err.message || 'تعذّر قراءة الملف. تأكد إنه ملف Excel صحيح.')
    }
  }

  function onSheetChange(name) {
    if (!workbook) return
    setActiveSheet(name)
    pickSheet(workbook, name)
    resetResult()
  }

  function clearFile() {
    setWorkbook(null)
    setFileName('')
    setSheetNames([])
    setActiveSheet('')
    setHeaders([])
    setBodyRows([])
    setParseError('')
    resetResult()
    if (fileRef.current) fileRef.current.value = ''
  }

  // كل الأرقام دي محسوبة من الشيت نفسه في المتصفح — مفيش أي تخمين ولا دور للـ AI فيها
  const stats = useMemo(() => {
    const cols = headers.map((h, i) => {
      const label = colLabel(h, i)
      let filled = 0
      let nums = 0
      let neg = 0
      let dates = 0
      let sum = 0
      let max = -Infinity
      let min = Infinity
      const counts = new Map()
      for (const r of bodyRows) {
        const raw = r?.[i]
        const text = String(raw ?? '').trim()
        if (!text) continue
        filled += 1
        const num = toNumber(raw)
        if (num !== null) {
          nums += 1
          sum += num
          if (num < 0) neg += 1
          if (num > max) max = num
          if (num < min) min = num
        }
        if (toDate(raw)) dates += 1
        const key = text.length > 40 ? text.slice(0, 40) : text
        counts.set(key, (counts.get(key) ?? 0) + 1)
      }
      return {
        index: i,
        label,
        isNum: filled > 0 && nums / filled >= 0.6,
        sum,
        avg: nums ? sum / nums : 0,
        max: nums ? max : 0,
        min: nums ? min : 0,
        card: counts.size,
        empty: bodyRows.length - filled,
        neg,
        dates,
      }
    })

    const numCols = cols.filter((c) => c.isNum)
    // الأعمدة التصنيفية اللي تنفع رسم بياني (عدد فئات معقول، مش عمود سيريالات مثلاً)
    const catCols = cols
      .filter((c) => !c.isNum && c.card > 1 && c.card <= 40 && c.card < bodyRows.length)
      .sort((a, b) => {
        const sa = hasWord(a.label, GROUP_WORDS) ? 1 : 0
        const sb = hasWord(b.label, GROUP_WORDS) ? 1 : 0
        return sa !== sb ? sb - sa : b.card - a.card
      })

    // عمود العدد الافتراضي: أول عمود رقمي اسمه بيشاور على لابات/عدد/كمية/إجمالي
    const auto =
      numCols.find((c) => hasWord(c.label, LAP_WORDS)) ??
      numCols.find((c) => hasWord(c.label, COUNT_WORDS)) ??
      numCols[0] ??
      null

    // عمود التاريخ (لو موجود) — بنستخدمه في خط الاتجاه الشهري
    const dateCols = cols.filter(
      (c) => !c.isNum && c.card > 1 && c.dates >= 2 && c.dates / Math.max(1, bodyRows.length - c.empty) >= 0.6,
    )
    const dateCol =
      dateCols.find((c) => hasWord(c.label, ['تاريخ', 'شهر', 'يوم', 'date', 'month', 'day'])) ??
      dateCols[0] ??
      null

    // فحص جودة البيانات — كله محسوب من الشيت نفسه، مفيش رأي من الموديل هنا
    const alerts = []
    const sigs = new Map()
    let emptyCells = 0
    for (const r of bodyRows) {
      const key = headers.map((_, i) => String(r?.[i] ?? '').trim()).join('\u0001')
      sigs.set(key, (sigs.get(key) ?? 0) + 1)
      for (let i = 0; i < headers.length; i += 1) if (!String(r?.[i] ?? '').trim()) emptyCells += 1
    }
    const dupRows = [...sigs.values()].reduce((n, c) => n + (c > 1 ? c - 1 : 0), 0)
    const cellsTotal = bodyRows.length * headers.length
    if (dupRows > 0) {
      alerts.push({ type: 'warn', text: `في ${formatNumber(dupRows)} صف مكرّر بنفس القيم بالكامل — راجعهم قبل الاعتماد.` })
    }
    if (cellsTotal && emptyCells) {
      const pct = Math.round((emptyCells / cellsTotal) * 100)
      alerts.push({
        type: pct > 20 ? 'warn' : 'info',
        text: `في ${formatNumber(emptyCells)} خانة فاضية من ${formatNumber(cellsTotal)} (${formatNumber(pct)}%).`,
      })
    }
    for (const c of cols) {
      if (c.neg > 0) {
        alerts.push({
          type: 'warn',
          text: `عمود «${c.label}» فيه ${formatNumber(c.neg)} قيمة سالبة — ممكن مرتجع أو خطأ إدخال.`,
        })
      }
      if (bodyRows.length && c.empty / bodyRows.length >= 0.3) {
        alerts.push({
          type: 'info',
          text: `عمود «${c.label}» فاضي في ${formatNumber(c.empty)} صف (${formatNumber(Math.round((c.empty / bodyRows.length) * 100))}%).`,
        })
      }
    }

    // عمود الأسماء (الموظف/العامل) — لو موجود بنرتّب بيه الإنتاجية
    const empCol = catCols.find((c) => hasWord(c.label, EMP_WORDS)) ?? catCols[0] ?? null

    return { numCols, catCols, auto, dateCol, empCol, alerts }
  }, [headers, bodyRows])

  // العمود المختار للتجميع (لو المستخدم غيّره) وإلا الافتراضي
  const activeCount = stats.numCols.find((c) => String(c.index) === countCol) ?? stats.auto
  const valueName = activeCount ? `إجمالي ${activeCount.label}` : 'عدد السجلات'

  // كل الرسوم دي محسوبة من الشيت نفسه: توزيع الأعمدة التصنيفية + النِسب + الاتجاه الشهري
  const visuals = useMemo(() => {
    const valueOf = (r) => (activeCount ? toNumber(r?.[activeCount.index]) ?? 0 : 1)

    const groupBy = (colIndex) => {
      const m = new Map()
      for (const r of bodyRows) {
        const key = String(r?.[colIndex] ?? '').trim() || '(فاضي)'
        m.set(key, (m.get(key) ?? 0) + valueOf(r))
      }
      return [...m.entries()].map(([name, value]) => ({ name, value })).sort((a, b) => b.value - a.value)
    }

    const bars = stats.catCols.slice(0, 2).map((c) => ({ col: c, data: groupBy(c.index).slice(0, 12) }))

    // النِسب: أعلى ٥ فئات + «أخرى»
    let donut = []
    const first = stats.catCols[0]
    if (first) {
      const all = groupBy(first.index)
      const rest = all.slice(5).reduce((s, x) => s + x.value, 0)
      donut = rest > 0 ? [...all.slice(0, 5), { name: 'أخرى', value: rest }] : all
    }

    // الاتجاه الشهري (بيظهر لو في عمود تاريخ)
    let trend = []
    if (stats.dateCol) {
      const m = new Map()
      for (const r of bodyRows) {
        const d = toDate(r?.[stats.dateCol.index])
        if (!d) continue
        const key = `${d.getFullYear()}-${String(d.getMonth() + 1).padStart(2, '0')}`
        m.set(key, (m.get(key) ?? 0) + valueOf(r))
      }
      trend = [...m.entries()]
        .sort((a, b) => (a[0] < b[0] ? -1 : 1))
        .map(([k, value]) => ({ name: monthLabel(k), value }))
    }

    // ترتيب الموظفين بالإنتاجية (إجمالي قيمة عمود العدد لكل شخص)
    let workers = []
    if (stats.empCol) {
      const m = new Map()
      for (const r of bodyRows) {
        const key = String(r?.[stats.empCol.index] ?? '').trim() || '(فاضي)'
        const cur = m.get(key) ?? { name: key, value: 0, rows: 0 }
        cur.value += valueOf(r)
        cur.rows += 1
        m.set(key, cur)
      }
      workers = [...m.values()].sort((a, b) => b.value - a.value)
    }

    return { bars, donut, trend, workers }
  }, [bodyRows, stats, activeCount])

  async function runAI() {
    setAiBusy(true)
    resetResult()
    try {
      const rows = bodyRows
        .slice(0, MAX_ROWS)
        .map((r) => headers.map((_, i) => cellValue(r[i])))
      const { data, error } = await supabase.functions.invoke('ai-analysis', {
        body: {
          mode: 'sheet',
          sheet: {
            filename: fileName,
            sheetName: activeSheet,
            totalRows: bodyRows.length,
            headers,
            rows,
          },
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

  // تنزيل التقرير كملف Excel بأكثر من ورقة (أرقام + جداول + ملاحظات + تحليل الـ AI)
  function exportReport() {
    const safeName = (s) => String(s ?? '').replace(/[[\]:*?/\\]/g, '-').slice(0, 31) || 'ورقة'
    const round2 = (n) => Number(Number(n).toFixed(2))
    const base = (fileName || 'report').replace(/\.[^.]+$/, '')

    const sheets = [
      {
        sheetName: 'الأرقام',
        headers: ['البند', 'القيمة'],
        rows: [
          ['الملف', fileName],
          ['الورقة', activeSheet],
          ['عدد السجلات', bodyRows.length],
          ['عدد الأعمدة', headers.length],
          ['عمود العدد', activeCount ? activeCount.label : '—'],
          [valueName, activeCount ? activeCount.sum : bodyRows.length],
        ],
      },
    ]

    if (stats.numCols.length) {
      sheets.push({
        sheetName: 'الأعمدة الرقمية',
        headers: ['العمود', 'الإجمالي', 'المتوسط', 'أعلى قيمة', 'أقل قيمة'],
        rows: stats.numCols.map((c) => [c.label, round2(c.sum), round2(c.avg), round2(c.max), round2(c.min)]),
      })
    }
    for (const b of visuals.bars) {
      sheets.push({
        sheetName: safeName(b.col.label),
        headers: [b.col.label, valueName],
        rows: b.data.map((d) => [d.name, round2(d.value)]),
      })
    }
    if (visuals.workers.length) {
      sheets.push({
        sheetName: 'ترتيب الإنتاجية',
        headers: ['#', stats.empCol ? stats.empCol.label : 'الاسم', activeCount ? valueName : 'عدد السجلات', 'عدد السجلات'],
        rows: visuals.workers.map((w, i) => [i + 1, w.name, round2(w.value), w.rows]),
      })
    }
    if (visuals.trend.length) {
      sheets.push({
        sheetName: 'الاتجاه الشهري',
        headers: ['الشهر', valueName],
        rows: visuals.trend.map((t) => [t.name, round2(t.value)]),
      })
    }
    if (stats.alerts.length) {
      sheets.push({
        sheetName: 'ملاحظات',
        headers: ['ملاحظة'],
        rows: stats.alerts.map((a) => [a.text]),
      })
    }
    sheets.push({
      sheetName: 'تحليل AI',
      headers: ['تحليل الذكاء الاصطناعي'],
      rows: String(ai?.summary ?? '').split('\n').map((line) => [line]),
    })

    exportXlsxSheets({ filename: `تحليل-شيت_${base}.xlsx`, sheets })
  }

  const sentRows = Math.min(bodyRows.length, MAX_ROWS)

  return (
    <Layout title="تحليل شيت AI">
      <div className="card mb-4">
        <h2 className="font-bold text-lg">تحليل شيت Excel بالذكاء الاصطناعي</h2>
        <p className="mt-1 text-xs text-slate-500">
          ارفع شيت Excel من جهازك، وبعدين دوس «تحليل الشيت بالـ AI» — التحليل بيتم على بيانات الشيت
          نفسه (مفيش أي أرقام تقديرية). بيتم تحليل أول {formatNumber(MAX_ROWS)} صف كحد أقصى.
        </p>

        <div className="mt-4 flex flex-wrap items-center gap-3">
          <input
            ref={fileRef}
            type="file"
            accept=".xlsx,.xls,.csv"
            onChange={onFile}
            className="input w-full sm:w-auto sm:flex-1"
          />
          {sheetNames.length > 1 && (
            <div className="w-full sm:w-auto">
              <label className="label">الورقة</label>
              <select className="input w-52" value={activeSheet} onChange={(e) => onSheetChange(e.target.value)}>
                {sheetNames.map((n) => (
                  <option key={n} value={n}>
                    {n}
                  </option>
                ))}
              </select>
            </div>
          )}
          {fileName && (
            <button type="button" onClick={clearFile} className="btn-ghost">
              إلغاء الملف
            </button>
          )}
        </div>

        {parseError && (
          <p className="mt-3 rounded-lg bg-red-50 p-3 text-sm text-red-700">{parseError}</p>
        )}
      </div>

      {fileName && !parseError && (
        <>
          <div className="card mb-4">
            <div className="mb-3 flex flex-wrap items-center justify-between gap-2">
              <div>
                <h2 className="font-bold text-lg">
                  معاينة الشيت <span className="text-sm font-normal text-slate-400">({activeSheet})</span>
                </h2>
                <p className="mt-0.5 text-xs text-slate-500">
                  {fileName} · {formatNumber(headers.length)} عمود · {formatNumber(bodyRows.length)} صف
                  {bodyRows.length > MAX_ROWS && ` (هيتم تحليل أول ${formatNumber(MAX_ROWS)} صف)`}
                </p>
              </div>
              <div className="flex flex-wrap items-center gap-2">
                <button
                  onClick={runAI}
                  disabled={aiBusy || !headers.length || !bodyRows.length}
                  className="btn-primary"
                >
                  {aiBusy ? 'جاري التحليل…' : 'تحليل الشيت بالـ AI'}
                </button>
                {ai && !aiError && (
                  <button onClick={exportReport} className="btn-ghost">
                    تنزيل التقرير (Excel)
                  </button>
                )}
              </div>
            </div>

            <div className="table-wrap">
              <table className="table">
                <thead>
                  <tr>
                    <th>#</th>
                    {headers.map((h, i) => (
                      <th key={i}>{h || `عمود ${i + 1}`}</th>
                    ))}
                  </tr>
                </thead>
                <tbody>
                  {bodyRows.slice(0, PREVIEW_ROWS).map((r, ri) => (
                    <tr key={ri}>
                      <td className="text-slate-400">{ri + 1}</td>
                      {headers.map((_, ci) => (
                        <td key={ci}>{String(cellValue(r[ci]) ?? '')}</td>
                      ))}
                    </tr>
                  ))}
                </tbody>
              </table>
            </div>
            {bodyRows.length > PREVIEW_ROWS && (
              <p className="mt-2 text-xs text-slate-400">
                بيتم عرض أول {formatNumber(PREVIEW_ROWS)} صف من {formatNumber(bodyRows.length)} — التحليل بيشمل{' '}
                {formatNumber(sentRows)} صف.
              </p>
            )}
          </div>

          {aiError && (
            <div className="card border-red-200 bg-red-50">
              <h2 className="mb-2 font-bold text-lg">نتيجة تحليل الذكاء الاصطناعي</h2>
              <p className="text-sm text-red-700">{aiError}</p>
            </div>
          )}

          {ai && !aiError && (
            <>
              {/* أرقام محسوبة من الشيت نفسه */}
              <div className="mb-4 grid gap-4 sm:grid-cols-2 lg:grid-cols-4">
                <Stat label="عدد السجلات في الشيت" value={bodyRows.length} />
                <Stat label="عدد الأعمدة" value={headers.length} />
                <Stat label="عمود العدد" text={activeCount ? activeCount.label : '—'} />
                <Stat label={valueName} value={activeCount ? activeCount.sum : bodyRows.length} />
              </div>

              {stats.alerts.length > 0 && (
                <div className="card mb-4 border-amber-200 bg-amber-50">
                  <h2 className="mb-2 font-bold text-lg">فحص جودة البيانات</h2>
                  <ul className="space-y-1 text-sm text-slate-700">
                    {stats.alerts.map((a, i) => (
                      <li key={i} className="flex gap-2">
                        <span
                          className={`mt-2 h-2 w-2 shrink-0 rounded-full ${
                            a.type === 'warn' ? 'bg-amber-500' : 'bg-slate-400'
                          }`}
                        />
                        <span>{a.text}</span>
                      </li>
                    ))}
                  </ul>
                </div>
              )}

              {visuals.workers.length > 1 && stats.empCol && (
                <div className="card mb-4">
                  <h2 className="mb-1 font-bold text-lg">
                    ترتيب الإنتاجية حسب «{stats.empCol.label}»
                  </h2>
                  <p className="mb-3 text-xs text-slate-500">
                    الأعلى إنتاجية: <span className="font-bold text-blue-700">{visuals.workers[0].name}</span>{' '}
                    بـ {formatNumber(visuals.workers[0].value)} {activeCount ? `من ${valueName}` : 'سجل'}
                    {' '}— من إجمالي {formatNumber(visuals.workers.length)} اسم.
                  </p>
                  <div style={{ width: '100%', height: Math.min(420, 60 + visuals.workers.slice(0, 10).length * 38) }}>
                    <ResponsiveContainer>
                      <BarChart
                        layout="vertical"
                        data={visuals.workers.slice(0, 10)}
                        margin={{ top: 10, right: 30, left: 10, bottom: 10 }}
                      >
                        <CartesianGrid strokeDasharray="3 3" horizontal={false} />
                        <XAxis type="number" tick={{ fontSize: 12 }} />
                        <YAxis type="category" dataKey="name" width={120} tick={{ fontSize: 12 }} />
                        <Tooltip />
                        <Bar dataKey="value" fill="#0891b2" radius={[0, 4, 4, 0]} name={valueName}>
                          {visuals.workers.slice(0, 10).map((w, i) => (
                            <Cell key={w.name} fill={i === 0 ? '#1d4ed8' : '#0891b2'} />
                          ))}
                        </Bar>
                      </BarChart>
                    </ResponsiveContainer>
                  </div>

                  <div className="table-wrap mt-4">
                    <table className="table">
                      <thead>
                        <tr>
                          <th>#</th>
                          <th>{stats.empCol.label}</th>
                          <th>{activeCount ? valueName : 'عدد السجلات'}</th>
                          <th>عدد السجلات</th>
                        </tr>
                      </thead>
                      <tbody>
                        {visuals.workers.map((w, i) => (
                          <tr key={w.name} className={i === 0 ? 'font-bold text-blue-700' : ''}>
                            <td>{formatNumber(i + 1)}</td>
                            <td>{w.name}</td>
                            <td>{formatNumber(w.value)}</td>
                            <td>{formatNumber(w.rows)}</td>
                          </tr>
                        ))}
                      </tbody>
                    </table>
                  </div>
                </div>
              )}

              {visuals.trend.length > 1 && (
                <div className="card mb-4">
                  <h2 className="mb-3 font-bold text-lg">{valueName} شهريًا</h2>
                  <div style={{ width: '100%', height: 300 }}>
                    <ResponsiveContainer>
                      <LineChart data={visuals.trend} margin={{ top: 10, right: 20, left: 0, bottom: 10 }}>
                        <CartesianGrid strokeDasharray="3 3" vertical={false} />
                        <XAxis dataKey="name" tick={{ fontSize: 12 }} />
                        <YAxis tick={{ fontSize: 12 }} />
                        <Tooltip />
                        <Line type="monotone" dataKey="value" stroke="#1d4ed8" strokeWidth={2} name={valueName} />
                      </LineChart>
                    </ResponsiveContainer>
                  </div>
                </div>
              )}

              {(visuals.bars.length > 0 || visuals.donut.length > 1) && (
                <div className="mb-4 grid gap-6 lg:grid-cols-2">
                  {visuals.bars.map((b) => (
                    <div key={b.col.index} className="card min-w-0">
                      <h2 className="mb-3 font-bold text-lg">
                        {b.col.label}{' '}
                        <span className="text-xs font-normal text-slate-400">
                          (أعلى ١٢ من {formatNumber(b.col.card)})
                        </span>
                      </h2>
                      <div style={{ width: '100%', height: 300 }}>
                        <ResponsiveContainer>
                          <BarChart data={b.data} margin={{ top: 10, right: 10, left: 0, bottom: 60 }}>
                            <CartesianGrid strokeDasharray="3 3" vertical={false} />
                            <XAxis
                              dataKey="name"
                              angle={-30}
                              textAnchor="end"
                              interval="preserveStartEnd"
                              height={80}
                              tick={{ fontSize: 11 }}
                            />
                            <YAxis tick={{ fontSize: 12 }} />
                            <Tooltip />
                            <Bar dataKey="value" fill="#1d4ed8" radius={[4, 4, 0, 0]} name={valueName} />
                          </BarChart>
                        </ResponsiveContainer>
                      </div>
                    </div>
                  ))}

                  {visuals.donut.length > 1 && (
                    <div className="card min-w-0">
                      <h2 className="mb-3 font-bold text-lg">النِسب حسب «{stats.catCols[0].label}»</h2>
                      <div style={{ width: '100%', height: 300 }}>
                        <ResponsiveContainer>
                          <PieChart>
                            <Pie
                              data={visuals.donut}
                              dataKey="value"
                              nameKey="name"
                              innerRadius={60}
                              outerRadius={105}
                              paddingAngle={2}
                            >
                              {visuals.donut.map((d, i) => (
                                <Cell key={d.name} fill={PIE_COLORS[i % PIE_COLORS.length]} />
                              ))}
                            </Pie>
                            <Tooltip />
                            <Legend wrapperStyle={{ fontSize: 12 }} />
                          </PieChart>
                        </ResponsiveContainer>
                      </div>
                    </div>
                  )}
                </div>
              )}

              <div className="card mb-4">
                <h2 className="mb-2 font-bold text-lg">نتيجة تحليل الذكاء الاصطناعي</h2>
                <div className="whitespace-pre-wrap text-sm leading-7 text-slate-700">{ai.summary}</div>
              </div>

              {stats.numCols.length > 0 && (
                <div className="card mb-4">
                  <h2 className="mb-3 font-bold text-lg">ملخّص الأعمدة الرقمية</h2>
                  <div className="table-wrap">
                    <table className="table">
                      <thead>
                        <tr>
                          <th>العمود</th>
                          <th>الإجمالي</th>
                          <th>المتوسط</th>
                          <th>أعلى قيمة</th>
                          <th>أقل قيمة</th>
                        </tr>
                      </thead>
                      <tbody>
                        {stats.numCols.map((c) => (
                          <tr key={c.index} className={c.index === activeCount?.index ? 'font-bold' : ''}>
                            <td>{c.label}</td>
                            <td>{formatNumber(c.sum)}</td>
                            <td>{formatNumber(c.avg)}</td>
                            <td>{formatNumber(c.max)}</td>
                            <td>{formatNumber(c.min)}</td>
                          </tr>
                        ))}
                      </tbody>
                    </table>
                  </div>
                </div>
              )}

              {/* عدّاد الإجمالي في نهاية الصفحة */}
              <div className="card mb-4 border-2 border-blue-200 bg-blue-50 text-center">
                <p className="text-sm text-slate-600">{valueName}</p>
                <p className="mt-1 text-5xl font-extrabold text-blue-700">
                  {formatNumber(activeCount ? activeCount.sum : bodyRows.length)}
                </p>
                <p className="mt-1 text-xs text-slate-500">
                  من إجمالي {formatNumber(bodyRows.length)} سجل في ورقة «{activeSheet}»
                </p>
                {stats.numCols.length > 1 && (
                  <div className="mt-4 flex flex-wrap items-center justify-center gap-2">
                    <label className="label mb-0">العمود اللي بيتجمّع</label>
                    <select
                      className="input w-52"
                      value={activeCount ? String(activeCount.index) : ''}
                      onChange={(e) => setCountCol(e.target.value)}
                    >
                      {stats.numCols.map((c) => (
                        <option key={c.index} value={c.index}>
                          {c.label}
                        </option>
                      ))}
                    </select>
                  </div>
                )}
              </div>
            </>
          )}
        </>
      )}
    </Layout>
  )
}

function Stat({ label, value, text }) {
  return (
    <div className="card">
      <p className="text-sm text-slate-500">{label}</p>
      <p className={`mt-1 font-bold ${text ? 'text-xl' : 'text-3xl'}`}>{text ?? formatNumber(value)}</p>
    </div>
  )
}
