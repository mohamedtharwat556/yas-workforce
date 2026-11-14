import { useEffect, useMemo, useState } from 'react'
import Layout from '../components/Layout'
import EntryDetails from '../components/EntryDetails'
import ProductionEntryForm from '../components/ProductionEntryForm'
import { supabase } from '../lib/supabase'
import { formatDate, formatNumber, toISODate, entryOperationNames, entryTotalQty } from '../lib/dates'
import { exportXlsxSheets } from '../lib/xlsx'

const TABS = [
  { key: 'entry', label: 'تسجيل إنتاج' },
  { key: 'release', label: 'إدخالات للمراجعة' },
  { key: 'maintenance', label: 'طلبات تحت الصيانة' },
  { key: 'retest', label: 'إعادة الاختبار' },
]

export default function SupervisorDashboard() {
  const [tab, setTab] = useState('entry')
  const [entries, setEntries] = useState([])
  const [maintenance, setMaintenance] = useState([])
  const [retest, setRetest] = useState([])
  const [stageMap, setStageMap] = useState({})
  const [busyId, setBusyId] = useState(null)
  const [finishingId, setFinishingId] = useState(null)
  const [msg, setMsg] = useState(null)
  const [detailId, setDetailId] = useState(null)
  const [returning, setReturning] = useState(null)
  const [reason, setReason] = useState('')

  async function loadAll() {
    const [e, st, mq, rq] = await Promise.all([
      supabase
        .from('production_entries')
        .select('*, employees!production_entries_worker_id_fkey(full_name), operations(name_ar), entry_operations(operation_id, quantity, operations(name_ar)), lap_serials(serial, laptop_type, model, stage_code, operation_id, operations(name_ar))')
        .in('status', ['draft', 'submitted'])
        .order('created_at', { ascending: false }),
      supabase.from('stages').select('code, name_ar'),
      supabase.rpc('fn_maintenance_queue'),
      supabase.rpc('fn_worker_retest_queue'),
    ])
    setEntries(e.data ?? [])
    setStageMap(Object.fromEntries((st.data ?? []).map((s) => [s.code, s.name_ar])))
    setMaintenance(mq.data ?? [])
    setRetest(rq.data ?? [])
  }

  useEffect(() => {
    loadAll()
  }, [])

  // عدد اللابات السليمة في الإدخال (اللي مش تحت الصيانة) — دي اللي بتتعرض للمشرف.
  // الإدخال القديم اللي مفيش فيه لابات مسجّلة بنحسب عليه عدد العمليات.
  function healthyCount(entry) {
    const serials = entry.lap_serials ?? []
    if (!serials.length) return entryTotalQty(entry)
    return serials.filter((s) => !s.stage_code).length
  }

  // «صفحة الاعتماد» بيوصلها اللابات السليمة بس:
  // الإدخال يظهر لو فيه لاب واحد على الأقل سليم (وجهته فاضية)، أو إدخال قديم بلا لابات مسجّلة.
  const pendingEntries = useMemo(
    () =>
      entries.filter(
        (e) => (e.lap_serials ?? []).length === 0 || (e.lap_serials ?? []).some((s) => !s.stage_code)
      ),
    [entries]
  )

  // إنهاء صيانة لاب (المشرف) → يرجّعه لطابور إعادة الاختبار
  async function finishMaintenance(row) {
    setMsg(null)
    setFinishingId(row.serial_id)
    const { error } = await supabase.rpc('fn_finish_maintenance', { p_serial_id: row.serial_id })
    setFinishingId(null)
    if (error) {
      setMsg({ type: 'error', text: error.message })
      return
    }
    setMsg({ type: 'ok', text: `تم إنهاء صيانة «${row.serial}» — رجع لطابور إعادة الاختبار.` })
    loadAll()
  }

  async function approveEntry(entry) {
    setBusyId(entry.id)
    const { error } = await supabase.rpc('fn_review_entry', {
      p_entry_id: entry.id,
      p_decision: 'approved',
      p_reason: null,
    })
    setBusyId(null)
    if (error) setMsg({ type: 'error', text: error.message })
    else setMsg({ type: 'ok', text: 'تم اعتماد الإدخال — بانتظار إصدار الحسابات.' })
    loadAll()
  }

  async function submitReturn(e) {
    e.preventDefault()
    if (!returning) return
    setBusyId(returning.id)
    const { error } = await supabase.rpc('fn_review_entry', {
      p_entry_id: returning.id,
      p_decision: 'rejected',
      p_reason: reason.trim() || null,
    })
    setBusyId(null)
    if (error) setMsg({ type: 'error', text: error.message })
    else setMsg({ type: 'ok', text: 'تم إرجاع الإدخال عشان يعدّله.' })
    setReturning(null)
    setReason('')
    loadAll()
  }

  // اللاب خلص إعادة اختبار وطلع سليم → يتبعت للاعتماد على طول (من غير تسجيل إدخال يدوي)
  async function sendRetest(row) {
    setMsg(null)
    setBusyId(row.serial_id)
    const { error } = await supabase.rpc('fn_worker_send_retest', { p_serial_id: row.serial_id })
    setBusyId(null)
    if (error) {
      setMsg({ type: 'error', text: error.message })
      return
    }
    setMsg({ type: 'ok', text: `تم إرسال اللاب «${row.serial}» — اللاب سليم وجاهز للاعتماد.` })
    loadAll()
  }

  // اللاب لسه فيه مشكلة بعد الصيانة → يرجع للصيانة تاني ويتشال من طابور إعادة الاختبار
  async function sendProblem(row) {
    if (!window.confirm(`اللاب «${row.serial}» لسه فيه مشكلة؟ هيرجع للصيانة تاني.`)) return
    setMsg(null)
    setBusyId(row.serial_id)
    const { error } = await supabase.rpc('fn_worker_retest_problem', { p_serial_id: row.serial_id })
    setBusyId(null)
    if (error) {
      setMsg({ type: 'error', text: error.message })
      return
    }
    setMsg({ type: 'ok', text: `تم إرجاع اللاب «${row.serial}» للصيانة تاني.` })
    loadAll()
  }

  function exportPendingEntries() {
    // ورقة الإدخالات (لكل إدخال) + ورقة تفصيل اللابات (لكل لاب: النوع/الموديل/السيريال/الحالة/نوع التست)
    const laptopRows = pendingEntries.flatMap((e) =>
      (e.lap_serials ?? []).map((s) => [
        e.employees?.full_name ?? '-',
        e.entry_date,
        entryOperationNames(e),
        s.laptop_type ?? '—',
        s.model ?? '—',
        s.serial,
        s.stage_code ? (stageMap[s.stage_code] ?? s.stage_code) : 'سليم',
        s.operations?.name_ar ?? '—',
      ])
    )
    exportXlsxSheets({
      filename: `yas-pending-entries_${toISODate(new Date())}.xlsx`,
      sheets: [
        {
          sheetName: 'إدخالات للمراجعة',
          headers: ['الموظف', 'التاريخ', 'العملية', 'العدد', 'الملاحظة', 'الحالة'],
          rows: pendingEntries.map((e) => [
            e.employees?.full_name ?? '-',
            e.entry_date,
            entryOperationNames(e),
            healthyCount(e),
            e.notes ?? '',
            e.status,
          ]),
        },
        {
          sheetName: 'تفصيل اللابات',
          headers: ['الموظف', 'التاريخ', 'العملية', 'نوع اللاب', 'الموديل', 'السيريال', 'الحالة', 'نوع التست'],
          rows: laptopRows,
        },
      ],
    })
  }

  return (
    <Layout title="لوحة المشرف">
      <div className="flex gap-2 mb-4 overflow-x-auto -mx-1 px-1">
        {TABS.map((t) => (
          <button
            key={t.key}
            onClick={() => {
              setTab(t.key)
              setMsg(null)
            }}
            className={`${tab === t.key ? 'btn-primary' : 'btn-ghost'} shrink-0 whitespace-nowrap`}
          >
            {t.label}
            {t.key === 'release' && pendingEntries.length > 0 && (
              <span className="badge bg-white/20 text-inherit">{pendingEntries.length}</span>
            )}
            {t.key === 'maintenance' && maintenance.length > 0 && (
              <span className="badge bg-white/20 text-inherit">{maintenance.length}</span>
            )}
            {t.key === 'retest' && retest.length > 0 && (
              <span className="badge bg-white/20 text-inherit">{retest.length}</span>
            )}
          </button>
        ))}
      </div>

      {msg && (
        <div className={`text-sm rounded-lg p-3 mb-4 ${msg.type === 'error' ? 'bg-red-50 text-red-700' : 'bg-emerald-50 text-emerald-700'}`}>
          {msg.text}
        </div>
      )}

      {tab === 'entry' && <ProductionEntryForm onSaved={loadAll} />}

      {tab === 'release' && (
        <div className="card">
          <div className="mb-3 flex flex-wrap items-center justify-between gap-2">
            <div>
              <h2 className="font-bold text-lg">إدخالات في انتظار المراجعة</h2>
              <p className="text-xs text-slate-500 mt-0.5">
                {pendingEntries.length === 0
                  ? 'مفيش إدخالات فيها لابات سليمة معلّقة'
                  : `${pendingEntries.length} إدخال فيه لابات سليمة في انتظار الاعتماد`}
              </p>
            </div>
            <button onClick={exportPendingEntries} disabled={pendingEntries.length === 0} className="btn-ghost !py-1.5 text-sm">
              تصدير Excel
            </button>
          </div>
          <div className="table-wrap">
            <table className="table table-cards">
              <thead>
                <tr>
                  <th>الموظف</th>
                  <th>التاريخ</th>
                  <th>العملية</th>
                  <th>العدد</th>
                  <th>الملاحظة</th>
                  <th>إجراء</th>
                </tr>
              </thead>
              <tbody>
                {pendingEntries.length === 0 && (
                  <tr>
                    <td colSpan={6} className="text-center text-slate-400 py-6">
                      مفيش إدخالات معلّقة
                    </td>
                  </tr>
                )}
                {pendingEntries.map((e) => (
                  <tr key={e.id} className="cursor-pointer hover:bg-slate-50" onClick={() => setDetailId(e.id)}>
                    <td data-label="الموظف">{e.employees?.full_name ?? '-'}</td>
                    <td data-label="التاريخ">{formatDate(e.entry_date)}</td>
                    <td data-label="العملية">{entryOperationNames(e)}</td>
                    <td data-label="العدد">{formatNumber(healthyCount(e))}</td>
                    <td data-label="الملاحظة" className="max-w-[220px] truncate" title={e.notes ?? ''}>{e.notes || '-'}</td>
                    <td data-label="إجراء" onClick={(ev) => ev.stopPropagation()}>
                      <div className="flex gap-2">
                        <button onClick={() => setDetailId(e.id)} className="btn-ghost !py-1 !px-2 text-xs">
                          تفاصيل
                        </button>
                        <button disabled={busyId === e.id} onClick={() => approveEntry(e)} className="btn-primary !py-1 !px-3 text-sm">
                          اعتماد
                        </button>
                        <button
                          disabled={busyId === e.id}
                          onClick={() => setReturning(e)}
                          className="btn-danger !py-1 !px-3 text-sm"
                        >
                          إرجاع
                        </button>
                      </div>
                    </td>
                  </tr>
                ))}
              </tbody>
            </table>
          </div>
        </div>
      )}

      {tab === 'maintenance' && (
        <div className="card">
          <div className="mb-3 flex flex-wrap items-center justify-between gap-2">
            <div>
              <h2 className="font-bold text-lg">طلبات تحت الصيانة</h2>
              <p className="text-xs text-slate-500 mt-0.5">
                {maintenance.length === 0
                  ? 'مفيش لابات تحت الصيانة'
                  : `${maintenance.length} لاب في انتظار انتهاء الصيانة`}
              </p>
            </div>
          </div>
          <p className="mb-3 rounded-lg bg-slate-50 p-3 text-xs text-slate-500">
            اللابات اللي اتحدّد إن فيها مشكلة بتظهر هنا تلقائيًا. لما الصيانة تخلص دوس «تمّت الصيانة» ويرجع
            لطابور إعادة الاختبار — ومش بيرجع لصفحة الاعتماد غير لما يبقى سليم.
          </p>
          <div className="table-wrap">
            <table className="table table-cards">
              <thead>
                <tr>
                  <th>السيريال</th>
                  <th>نوع اللاب</th>
                  <th>الموديل</th>
                  <th>نوع التست</th>
                  <th>الوجهة</th>
                  <th>الموظف</th>
                  <th>التاريخ</th>
                  <th>إجراء</th>
                </tr>
              </thead>
              <tbody>
                {maintenance.length === 0 && (
                  <tr>
                    <td colSpan={8} className="text-center text-slate-400 py-6">
                      مفيش لابات تحت الصيانة
                    </td>
                  </tr>
                )}
                {maintenance.map((m) => (
                  <tr key={m.serial_id}>
                    <td data-label="السيريال" dir="ltr" className="text-left font-mono text-sm">{m.serial}</td>
                    <td data-label="نوع اللاب">{m.laptop_type || '—'}</td>
                    <td data-label="الموديل">{m.model || '—'}</td>
                    <td data-label="نوع التست">{m.operation_name || '—'}</td>
                    <td data-label="الوجهة">
                      <span className="badge bg-amber-100 text-amber-800">
                        {m.dest_code ? (stageMap[m.dest_code] ?? m.dest_code) : '—'}
                      </span>
                    </td>
                    <td data-label="الموظف">{m.worker_name || '-'}</td>
                    <td data-label="التاريخ">{formatDate(m.entry_date)}</td>
                    <td data-label="إجراء">
                      <button
                        disabled={finishingId === m.serial_id}
                        onClick={() => finishMaintenance(m)}
                        className="btn-primary !py-1 !px-3 text-sm"
                      >
                        {finishingId === m.serial_id ? '…' : 'تمّت الصيانة'}
                      </button>
                    </td>
                  </tr>
                ))}
              </tbody>
            </table>
          </div>
        </div>
      )}

      {tab === 'retest' && (
        <div className="card">
          <div className="mb-3">
            <h2 className="font-bold text-lg">في انتظار إعادة الاختبار</h2>
            <p className="text-xs text-slate-500 mt-0.5">
              {retest.length === 0
                ? 'مفيش لابات راجعة من الصيانة'
                : `${retest.length} لاب رجع من الصيانة — اعمله تست من جديد.`}
            </p>
          </div>
          <p className="mb-3 rounded-lg bg-slate-50 p-3 text-xs text-slate-500">
            اللابات اللي خلّصنا صيانتها بتظهر هنا تلقائيًا. لما تتعمل لها إعادة اختبار وتبقى سليمة دوس
            «إرسال للاعتماد (سليم)» وترجع لصفحة الاعتماد على طول، ولو لسه فيها مشكلة دوس «لسه فيه مشكلة» وترجع
            للصيانة تاني.
          </p>
          <div className="table-wrap">
            <table className="table table-cards">
              <thead>
                <tr>
                  <th>السيريال</th>
                  <th>نوع اللاب</th>
                  <th>الموديل</th>
                  <th>آخر مشكلة</th>
                  <th>اتخلّصت الصيانة</th>
                  <th>اللي خلّصها</th>
                  <th>إجراء</th>
                </tr>
              </thead>
              <tbody>
                {retest.length === 0 && (
                  <tr>
                    <td colSpan={7} className="text-center text-slate-400 py-6">
                      مفيش لابات في انتظار إعادة الاختبار
                    </td>
                  </tr>
                )}
                {retest.map((r) => (
                  <tr key={r.serial_id}>
                    <td data-label="السيريال" dir="ltr" className="text-left font-mono text-sm">{r.serial}</td>
                    <td data-label="نوع اللاب">{r.laptop_type || '—'}</td>
                    <td data-label="الموديل">{r.model || '—'}</td>
                    <td data-label="آخر مشكلة">
                      <span className="badge bg-amber-100 text-amber-800">
                        {r.dest_code ? (stageMap[r.dest_code] ?? r.dest_code) : '—'}
                      </span>
                    </td>
                    <td data-label="اتخلّصت الصيانة">{r.done_at ? formatDate(r.done_at) : '-'}</td>
                    <td data-label="اللي خلّصها">{r.done_by_name || '—'}</td>
                    <td data-label="إجراء">
                      <div className="flex flex-wrap gap-2">
                        <button
                          disabled={busyId === r.serial_id}
                          onClick={() => sendRetest(r)}
                          className="btn-accent !py-1 !px-3 text-sm"
                        >
                          {busyId === r.serial_id ? '…' : 'إرسال للاعتماد (سليم)'}
                        </button>
                        <button
                          disabled={busyId === r.serial_id}
                          onClick={() => sendProblem(r)}
                          className="btn-danger !py-1 !px-3 text-sm"
                        >
                          لسه فيه مشكلة
                        </button>
                      </div>
                    </td>
                  </tr>
                ))}
              </tbody>
            </table>
          </div>
        </div>
      )}

      {returning && (
        <div
          className="fixed inset-0 z-50 flex items-end justify-center bg-black/50 md:items-center md:p-4"
          onClick={() => setReturning(null)}
          role="dialog"
          aria-modal="true"
        >
          <form onSubmit={submitReturn} className="card max-h-[92vh] w-full overflow-y-auto rounded-b-none rounded-t-2xl md:my-8 md:max-w-lg md:rounded-xl" onClick={(ev) => ev.stopPropagation()}>
            <h2 className="text-lg font-bold">إرجاع الإدخال</h2>
            <p className="text-xs text-slate-500 mt-1 mb-4">
              {returning.employees?.full_name ?? 'الموظف'} — {entryOperationNames(returning)} · العدد {formatNumber(entryTotalQty(returning))}
            </p>
            <label className="label">سبب الإرجاع (اختياري)</label>
            <textarea
              className="input"
              rows={3}
              autoFocus
              value={reason}
              onChange={(ev) => setReason(ev.target.value)}
              placeholder="مثال: عدد اللابات غير مطابق للسيريالات…"
            />
            <div className="mt-4 flex justify-end gap-2">
              <button type="button" onClick={() => setReturning(null)} className="btn-ghost">
                إلغاء
              </button>
              <button type="submit" disabled={busyId === returning.id} className="btn-danger">
                {busyId === returning.id ? 'جاري الإرجاع…' : 'تأكيد الإرجاع'}
              </button>
            </div>
          </form>
        </div>
      )}

      {detailId && (
        <EntryDetails
          entryId={detailId}
          onClose={() => setDetailId(null)}
          onApprove={async (entry) => {
            await approveEntry(entry)
            setDetailId(null)
          }}
        />
      )}
    </Layout>
  )
}
