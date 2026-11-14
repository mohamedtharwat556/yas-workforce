import { useMemo, useRef, useState } from 'react'
import * as XLSX from 'xlsx'
import {
  Bar,
  BarChart,
  CartesianGrid,
  ResponsiveContainer,
  Tooltip,
  XAxis,
  YAxis,
} from 'recharts'
import Layout from '../components/Layout'
import { supabase } from '../lib/supabase'
import { formatNumber } from '../lib/dates'

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
          if (num > max) max = num
          if (num < min) min = num
        }
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

    return { numCols, catCols, auto }
  }, [headers, bodyRows])

  // العمود المختار للتجميع (لو المستخدم غيّره) وإلا الافتراضي
  const activeCount = stats.numCols.find((c) => String(c.index) === countCol) ?? stats.auto
  const valueName = activeCount ? `إجمالي ${activeCount.label}` : 'عدد السجلات'

  // توزيع عمود تصنيفي على قيمة العمود الرقمي (أو عدد السجلات لو مفيش عمود رقمي)
  function chartOf(col) {
    const m = new Map()
    for (const r of bodyRows) {
      const key = String(r?.[col.index] ?? '').trim() || '(فاضي)'
      const add = activeCount ? toNumber(r?.[activeCount.index]) ?? 0 : 1
      m.set(key, (m.get(key) ?? 0) + add)
    }
    return [...m.entries()].map(([name, value]) => ({ name, value })).sort((a, b) => b.value - a.value)
  }

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
              <button
                onClick={runAI}
                disabled={aiBusy || !headers.length || !bodyRows.length}
                className="btn-primary"
              >
                {aiBusy ? 'جاري التحليل…' : 'تحليل الشيت بالـ AI'}
              </button>
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

              {stats.catCols.length > 0 && (
                <div className="mb-4 grid gap-6 lg:grid-cols-2">
                  {stats.catCols.slice(0, 2).map((c) => {
                    const data = chartOf(c).slice(0, 12)
                    return (
                      <div key={c.index} className="card min-w-0">
                        <h2 className="mb-3 font-bold text-lg">
                          {c.label}{' '}
                          <span className="text-xs font-normal text-slate-400">
                            (أعلى ١٢ من {formatNumber(c.card)})
                          </span>
                        </h2>
                        <div style={{ width: '100%', height: 300 }}>
                          <ResponsiveContainer>
                            <BarChart data={data} margin={{ top: 10, right: 10, left: 0, bottom: 60 }}>
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
                    )
                  })}
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
