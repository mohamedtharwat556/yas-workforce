import { useCallback, useEffect, useMemo, useState } from 'react'
import Layout from '../components/Layout'
import { useAuth } from '../context/AuthContext'
import { supabase } from '../lib/supabase'
import { formatDate, formatNumber, toISODate } from '../lib/dates'
import { printReport } from '../lib/report'
import { exportXlsx } from '../lib/xlsx'

function currentMonth() {
  const d = new Date()
  return `${d.getFullYear()}-${String(d.getMonth() + 1).padStart(2, '0')}`
}

function monthRange(ym) {
  const [y, m] = ym.split('-').map(Number)
  return { start: toISODate(new Date(y, m - 1, 1)), end: toISODate(new Date(y, m, 0)) }
}

export default function IncentiveLocks() {
  const { profile } = useAuth()
  const [ym, setYm] = useState(currentMonth())
  const [report, setReport] = useState([])
  const [snapshots, setSnapshots] = useState([])
  const [period, setPeriod] = useState(null)
  const [adjustments, setAdjustments] = useState([])
  const [rule, setRule] = useState(null)
  const [loading, setLoading] = useState(false)
  const [busy, setBusy] = useState(false)
  const [msg, setMsg] = useState(null)
  const [adjustFor, setAdjustFor] = useState(null)

  const range = useMemo(() => monthRange(ym), [ym])
  const currency = rule?.currency ?? 'EGP'
  const canManage = profile?.role === 'accountant'

  const load = useCallback(async () => {
    setLoading(true)
    const [rep, per, r, snap] = await Promise.all([
      supabase.rpc('fn_period_report', { p_start: range.start, p_end: range.end }),
      supabase
        .from('incentive_periods')
        .select('*')
        .eq('period_start', range.start)
        .eq('period_end', range.end)
        .maybeSingle(),
      supabase.from('incentive_rules').select('*').limit(1).maybeSingle(),
      supabase
        .from('incentive_snapshots')
        .select('*')
        .eq('period_start', range.start)
        .eq('period_end', range.end),
    ])
    setReport(rep.data ?? [])
    setPeriod(per.data ?? null)
    setRule(r.data ?? null)
    setSnapshots(snap.data ?? [])

    if (per.data?.id) {
      const { data } = await supabase
        .from('incentive_adjustments')
        .select('*')
        .eq('period_id', per.data.id)
        .order('created_at', { ascending: false })
      setAdjustments(data ?? [])
    } else {
      setAdjustments([])
    }
    setLoading(false)
  }, [range.start, range.end])

  useEffect(() => {
    load()
  }, [load])

  const isLocked = period?.status === 'closed'

  // دمج تقرير الفترة الحيّ مع الكشوف المعتمدة (يشمل عمال اتعتمدوا بس مفيش لهم إدخال حالي)
  const rows = useMemo(() => {
    const list = report.map((r) => ({
      worker_id: r.worker_id,
      worker_name: r.worker_name,
      laps: Number(r.laps),
      units: Number(r.units),
      incentive: Number(r.incentive),
      adjustment: Number(r.adjustment),
      total: Number(r.total),
      locked: r.locked_incentive == null ? null : Number(r.locked_incentive),
      snapOnly: false,
    }))
    const seen = new Set(list.map((r) => r.worker_id))
    for (const s of snapshots) {
      if (seen.has(s.worker_id)) continue
      list.push({
        worker_id: s.worker_id,
        worker_name: s.worker_name,
        laps: 0,
        units: 0,
        incentive: 0,
        adjustment: 0,
        total: 0,
        locked: Number(s.incentive),
        snapOnly: true,
      })
    }
    return list.sort((a, b) => (b.total || b.locked || 0) - (a.total || a.locked || 0))
  }, [report, snapshots])

  const totals = useMemo(
    () =>
      rows.reduce(
        (a, r) => ({
          laps: a.laps + r.laps,
          units: a.units + r.units,
          incentive: a.incentive + r.incentive,
          adjustment: a.adjustment + r.adjustment,
          total: a.total + r.total,
          locked: a.locked + (r.locked ?? 0),
        }),
        { laps: 0, units: 0, incentive: 0, adjustment: 0, total: 0, locked: 0 }
      ),
    [rows]
  )

  const changedCount = useMemo(
    () => (isLocked ? rows.filter((r) => r.locked != null && r.incentive !== r.locked).length : 0),
    [isLocked, rows]
  )

  async function closeMonth() {
    setBusy(true)
    setMsg(null)
    const [y, m] = ym.split('-').map(Number)
    const { error } = await supabase.rpc('fn_close_month', { p_year: y, p_month: m })
    setBusy(false)
    if (error) return setMsg({ type: 'error', text: error.message })
    setMsg({ type: 'ok', text: isLocked ? 'تم إعادة اعتماد الشهر وتحديث الكشف.' : 'تم اعتماد الشهر وإغلاق الفترة.' })
    load()
  }

  async function reopenMonth() {
    setBusy(true)
    setMsg(null)
    const [y, m] = ym.split('-').map(Number)
    const { error } = await supabase.rpc('fn_reopen_month', { p_year: y, p_month: m })
    setBusy(false)
    if (error) return setMsg({ type: 'error', text: error.message })
    setMsg({ type: 'ok', text: 'تم إعادة فتح الفترة — الأرقام بقت حيّة تاني.' })
    load()
  }

  async function submitAdjustment(workerId, amount, reason) {
    if (!period?.id) {
      setMsg({ type: 'error', text: 'لازم تعتمد الشهر الأول قبل إضافة تسوية.' })
      return false
    }
    setBusy(true)
    setMsg(null)
    const { error } = await supabase.rpc('fn_add_adjustment', {
      p_period_id: period.id,
      p_worker_id: workerId,
      p_amount: Number(amount),
      p_reason: reason,
    })
    setBusy(false)
    if (error) {
      setMsg({ type: 'error', text: error.message })
      return false
    }
    setMsg({ type: 'ok', text: 'تم تسجيل التسوية.' })
    setAdjustFor(null)
    load()
    return true
  }

  function exportExcel() {
    const body = rows.map((r, i) => [
      i + 1,
      r.worker_name,
      r.laps,
      r.units,
      r.incentive,
      r.adjustment,
      r.total,
      r.locked ?? '',
    ])
    exportXlsx({
      filename: `yas-incentives_${range.start}_${range.end}.xlsx`,
      sheetName: 'الحوافز',
      title: isLocked ? 'كشف الحوافز المعتمد' : 'كشف الحوافز (مسودّة)',
      meta: [
        [`الفترة: ${range.start} ← ${range.end}`],
        [`العملة: ${currency}`],
        [`إجمالي الإجمالي: ${formatNumber(totals.total)}`],
      ],
      headers: ['#', 'العامل', 'لابات', 'وحدات', 'الحافز', 'التسوية', 'الإجمالي', 'المعتمد'],
      rows: body,
      footer: ['', 'الإجمالي', totals.laps, totals.units, totals.incentive, totals.adjustment, totals.total, totals.locked],
    })
  }

  function exportPDF() {
    printReport({
      title: isLocked ? 'كشف الحوافز المعتمد' : 'كشف الحوافز (مسودّة)',
      period: range,
      currency,
      totals: { laps: totals.laps, units: totals.units, incentive: totals.total },
      rows: rows.map((r) => ({
        name: r.worker_name,
        laps: r.laps,
        units: r.units,
        incentive: r.total,
      })),
      byOperation: [],
    })
  }

  return (
    <Layout title="اعتماد كشوف الحوافز">
      <div className="card mb-6 flex flex-wrap items-end gap-3">
        <div className="w-full sm:w-auto">
          <label className="label">الشهر</label>
          <input type="month" className="input w-44" value={ym} onChange={(e) => setYm(e.target.value)} />
        </div>
        <div className="text-sm text-slate-500 mb-2">
          {range.start} ← {range.end}
        </div>
        <div className="flex-1" />
        <button onClick={exportExcel} disabled={rows.length === 0} className="btn-ghost">
          تصدير Excel
        </button>
        <button onClick={exportPDF} disabled={rows.length === 0} className="btn-ghost">
          تصدير PDF
        </button>
        {canManage && isLocked && (
          <button onClick={reopenMonth} disabled={busy} className="btn-ghost">
            إعادة فتح الشهر
          </button>
        )}
        {canManage && (
          <button onClick={closeMonth} disabled={busy || rows.length === 0} className="btn-accent">
            {busy ? 'جاري الاعتماد…' : isLocked ? 'إعادة اعتماد الشهر' : 'اعتماد وإغلاق الشهر'}
          </button>
        )}
      </div>

      {!canManage && (
        <div className="card mb-4 border-blue-200 bg-blue-50">
          <p className="text-sm text-blue-800">اعتماد وإغلاق الفترات والتسويات متاح لدور «الحسابات» فقط.</p>
        </div>
      )}

      {msg && (
        <div
          className={`text-sm rounded-lg p-3 mb-4 ${msg.type === 'error' ? 'bg-red-50 text-red-700' : 'bg-emerald-50 text-emerald-700'}`}
        >
          {msg.text}
        </div>
      )}

      {isLocked && (
        <div className="card mb-4 border-emerald-200 bg-emerald-50">
          <p className="text-sm text-emerald-800">
            ✅ الشهر ده <b>معتمد ومقفول</b>
            {period?.closed_at ? ` بتاريخ ${formatDate(period.closed_at)}` : ''} — الحوافز محفوظة وثابتة على سعر الوحدة
            وقت الاعتماد ({formatNumber(rule?.unit_rate ?? 0)} {currency}).
          </p>
        </div>
      )}

      {changedCount > 0 && (
        <div className="card mb-4 border-amber-200 bg-amber-50">
          <p className="text-sm text-amber-800">
            ⚠️ فيه <b>{changedCount}</b> عامل اتغيّرت أرقامهم بعد الاعتماد (زي إصدار إدخال قديم أو تغيير سعر الوحدة).
            اضغط "إعادة اعتماد الشهر" لتحديث الكشف.
          </p>
        </div>
      )}

      <div className="grid gap-4 md:grid-cols-4 mb-6">
        <Stat label="إجمالي اللابات" value={totals.laps} />
        <Stat label="الوحدات المرجّحة" value={totals.units} />
        <Stat label="إجمالي الحافز" value={totals.incentive} />
        <Stat label={`الإجمالي + التسويات (${currency})`} value={totals.total} />
      </div>

      <div className="card">
        <h2 className="font-bold text-lg mb-3">
          حوافز الشهر لكل عامل{' '}
          {isLocked && <span className="text-sm font-normal text-slate-400">— مقارنة بالمعتمد</span>}
        </h2>
        <div className="table-wrap">
          <table className="table table-cards">
            <thead>
              <tr>
                <th>#</th>
                <th>العامل</th>
                <th>لابات</th>
                <th>وحدات</th>
                <th>الحافز</th>
                <th>التسوية</th>
                <th>الإجمالي</th>
                <th>الحالة</th>
                <th></th>
              </tr>
            </thead>
            <tbody>
              {loading && (
                <tr>
                  <td colSpan={9} className="text-center text-slate-400 py-6">جاري التحميل…</td>
                </tr>
              )}
              {!loading && rows.length === 0 && (
                <tr>
                  <td colSpan={9} className="text-center text-slate-400 py-6">
                    مفيش إدخالات مُصدرة في الشهر ده
                  </td>
                </tr>
              )}
              {rows.map((r, i) => {
                const drift = isLocked && !r.snapOnly && r.locked != null && r.incentive !== r.locked
                return (
                  <tr key={r.worker_id} className={r.snapOnly ? 'opacity-70' : ''}>
                    <td data-label="#" className="text-slate-400">{r.snapOnly ? '—' : i + 1}</td>
                    <td data-label="العامل">{r.worker_name}</td>
                    <td data-label="لابات">{formatNumber(r.laps)}</td>
                    <td data-label="وحدات">{formatNumber(r.units)}</td>
                    <td data-label="الحافز">{formatNumber(r.incentive)}</td>
                    <td data-label="التسوية">{r.adjustment ? formatNumber(r.adjustment) : '—'}</td>
                    <td data-label="الإجمالي" className="font-medium">{formatNumber(r.total)}</td>
                    <td data-label="الحالة">
                      {!isLocked ? (
                        <span className="badge bg-slate-100 text-slate-600">جاري</span>
                      ) : r.snapOnly ? (
                        <span className="badge bg-red-100 text-red-700">في المعتمد فقط</span>
                      ) : drift ? (
                        <span className="badge bg-amber-100 text-amber-800">متغيّر</span>
                      ) : (
                        <span className="badge bg-emerald-100 text-emerald-800">مطابق</span>
                      )}
                    </td>
                    <td data-label="إجراء">
                      {canManage && isLocked && !r.snapOnly && (
                        <button
                          onClick={() => setAdjustFor(r)}
                          className="btn-ghost !px-2 !py-1 text-xs"
                          title="إضافة تسوية"
                        >
                          + تسوية
                        </button>
                      )}
                    </td>
                  </tr>
                )
              })}
            </tbody>
          </table>
        </div>
      </div>

      {isLocked && adjustments.length > 0 && (
        <div className="card mt-6">
          <h2 className="font-bold text-lg mb-3">التسويات المسجّلة ({adjustments.length})</h2>
          <div className="table-wrap">
            <table className="table table-cards">
              <thead>
                <tr>
                  <th>العامل</th>
                  <th>المبلغ</th>
                  <th>السبب</th>
                  <th>التاريخ</th>
                </tr>
              </thead>
              <tbody>
                {adjustments.map((a) => {
                  const name = rows.find((r) => r.worker_id === a.worker_id)?.worker_name ?? a.worker_id.slice(0, 8)
                  return (
                    <tr key={a.id}>
                      <td data-label="العامل">{name}</td>
                      <td data-label="المبلغ" className="font-medium">{formatNumber(a.amount)}</td>
                      <td data-label="السبب">{a.reason}</td>
                      <td data-label="التاريخ">{formatDate(a.created_at)}</td>
                    </tr>
                  )
                })}
              </tbody>
            </table>
          </div>
        </div>
      )}

      {adjustFor && (
        <AdjustmentModal
          worker={adjustFor}
          currency={currency}
          busy={busy}
          onClose={() => setAdjustFor(null)}
          onSubmit={submitAdjustment}
        />
      )}
    </Layout>
  )
}

function AdjustmentModal({ worker, currency, busy, onClose, onSubmit }) {
  const [amount, setAmount] = useState('')
  const [reason, setReason] = useState('')
  const [err, setErr] = useState('')

  async function handleSubmit(e) {
    e.preventDefault()
    const value = Number(amount)
    if (!value) return setErr('اكتب مبلغ التسوية (موجب أو سالب).')
    if (!reason.trim()) return setErr('سبب التسوية مطلوب.')
    setErr('')
    const ok = await onSubmit(worker.worker_id, value, reason.trim())
    if (!ok) setErr('تعذّر حفظ التسوية.')
  }

  return (
    <div
      className="fixed inset-0 z-40 flex items-end justify-center bg-black/50 md:items-center md:p-4"
      onClick={onClose}
      role="dialog"
      aria-modal="true"
    >
      <form
        onSubmit={handleSubmit}
        className="card max-h-[92vh] w-full overflow-y-auto rounded-b-none rounded-t-2xl md:my-8 md:max-w-md md:rounded-xl"
        onClick={(e) => e.stopPropagation()}
      >
        <h2 className="text-lg font-bold mb-1">تسوية حافز — {worker.worker_name}</h2>
        <p className="text-sm text-slate-500 mb-4">
          الإجمالي الحالي: {formatNumber(worker.total)} {currency}
        </p>

        <label className="label">المبلغ ({currency}) — موجب يزيد، سالب يخصم</label>
        <input
          type="number"
          step="0.01"
          className="input mb-3"
          value={amount}
          onChange={(e) => setAmount(e.target.value)}
          autoFocus
        />

        <label className="label">السبب</label>
        <textarea
          className="input mb-3"
          rows={3}
          value={reason}
          onChange={(e) => setReason(e.target.value)}
          placeholder="مثال: مكافأة، خصم تأخير، تصحيح إدخال…"
        />

        {err && <p className="text-sm text-red-600 mb-3">{err}</p>}

        <div className="flex justify-end gap-2">
          <button type="button" onClick={onClose} className="btn-ghost">
            إلغاء
          </button>
          <button type="submit" disabled={busy} className="btn-accent">
            {busy ? 'جاري الحفظ…' : 'حفظ التسوية'}
          </button>
        </div>
      </form>
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
