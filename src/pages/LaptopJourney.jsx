import { useCallback, useEffect, useMemo, useState } from 'react'
import { Link, useNavigate, useSearchParams } from 'react-router-dom'
import Layout from '../components/Layout'
import StatusBadge from '../components/StatusBadge'
import QRScannerModal from '../components/QRScannerModal'
import { useAuth } from '../context/AuthContext'
import { supabase } from '../lib/supabase'
import { formatDate } from '../lib/dates'

// أدوار مسموح لها تضيف لاب
const CAN_CREATE = ['worker', 'supervisor', 'accountant']

export default function LaptopJourney() {
  const { user, profile } = useAuth()
  const role = profile?.role
  const navigate = useNavigate()
  const [searchParams] = useSearchParams()

  const [stages, setStages] = useState([])
  const [operations, setOperations] = useState([])
  const [laptops, setLaptops] = useState([])
  const [selectedId, setSelectedId] = useState(null)
  const [movements, setMovements] = useState([])
  const [entries, setEntries] = useState([])
  const [busy, setBusy] = useState(false)
  const [msg, setMsg] = useState(null)

  // نموذج إضافة لاب
  const [showNew, setShowNew] = useState(false)
  const [newSerial, setNewSerial] = useState('')
  const [newNotes, setNewNotes] = useState('')

  // مسح QR
  const [scanning, setScanning] = useState(false)

  // البحث اليدوي بالسيريال
  const [serialQuery, setSerialQuery] = useState('')

  // نموذج تسجيل مرحلة
  const [stageCode, setStageCode] = useState('')
  const [stageNotes, setStageNotes] = useState('')

  // نموذج تسجيل عملية
  const [opId, setOpId] = useState('')
  const [opQty, setOpQty] = useState(1)

  const selected = useMemo(
    () => laptops.find((l) => l.id === selectedId) ?? null,
    [laptops, selectedId]
  )

  const stageByCode = useMemo(() => {
    const m = {}
    for (const s of stages) m[s.code] = s
    return m
  }, [stages])

  const mandatoryStages = useMemo(() => stages.filter((s) => s.is_mandatory), [stages])

  const doneStages = useMemo(() => new Set(movements.map((m) => m.stage_code).filter(Boolean)), [movements])

  async function loadBase() {
    const [s, o, l] = await Promise.all([
      supabase.from('stages').select('*').eq('active', true).order('sort_order'),
      supabase.from('operations').select('*').eq('active', true).order('sort_order'),
      supabase.from('laptops').select('*').order('created_at', { ascending: false }).limit(200),
    ])
    setStages(s.data ?? [])
    setOperations(o.data ?? [])
    setLaptops(l.data ?? [])
  }

  async function loadDetail(id) {
    if (!id) {
      setMovements([])
      setEntries([])
      return
    }
    const [m, e] = await Promise.all([
      supabase
        .from('laptop_movements')
        .select('*, profiles(full_name)')
        .eq('laptop_id', id)
        .order('created_at'),
      supabase
        .from('production_entries')
        .select('*, operations(name_ar)')
        .eq('laptop_id', id)
        .order('created_at'),
    ])
    setMovements(m.data ?? [])
    setEntries(e.data ?? [])
  }

  useEffect(() => {
    loadBase()
  }, [])

  useEffect(() => {
    loadDetail(selectedId)
  }, [selectedId])

  // فتح لاب مباشرة لما نيجي من مسح QR (?laptop=id)
  const qrLaptopId = searchParams.get('laptop')
  useEffect(() => {
    if (qrLaptopId && laptops.some((l) => l.id === qrLaptopId)) setSelectedId(qrLaptopId)
  }, [qrLaptopId, laptops])

  // نتيجة مسح الـ QR: نستخرج الـ token ونروح لصفحة الوصول
  const handleScan = useCallback(
    (text) => {
      setScanning(false)
      const m = String(text).match(/\/l\/([0-9a-fA-F-]{36})/)
      const token = (m ? m[1] : String(text)).trim()
      navigate(`/l/${token}`)
    },
    [navigate]
  )

  function flash(type, text) {
    setMsg({ type, text })
  }

  // فتح لاب بإدخال السيريال يدويًا (بديل عن مسح الـ QR)
  async function openBySerial(e) {
    e.preventDefault()
    const q = serialQuery.trim()
    if (!q) return
    const local = laptops.find((l) => String(l.serial).toLowerCase() === q.toLowerCase())
    if (local) {
      setSelectedId(local.id)
      setSerialQuery('')
      flash('ok', `تم فتح اللاب ${local.serial}`)
      return
    }
    setBusy(true)
    setMsg(null)
    const { data, error } = await supabase.from('laptops').select('*').ilike('serial', q).limit(1).maybeSingle()
    setBusy(false)
    if (error || !data) {
      flash('error', `مفيش لاب بالسيريال «${q}»`)
      return
    }
    await loadBase()
    setSelectedId(data.id)
    setSerialQuery('')
    flash('ok', `تم فتح اللاب ${data.serial}`)
  }

  async function createLaptop(e) {
    e.preventDefault()
    setBusy(true)
    setMsg(null)
    const { data, error } = await supabase.rpc('fn_create_laptop', {
      p_serial: newSerial.trim() || null,
      p_notes: newNotes.trim() || null,
    })
    setBusy(false)
    if (error) {
      flash('error', error.message)
      return
    }
    setNewSerial('')
    setNewNotes('')
    setShowNew(false)
    flash('ok', `تم إنشاء اللاب ${data.serial}`)
    await loadBase()
    setSelectedId(data.id)
  }

  async function advanceStage(e) {
    e.preventDefault()
    if (!stageCode) return
    setBusy(true)
    setMsg(null)
    const { error } = await supabase.rpc('fn_advance_stage', {
      p_laptop_id: selectedId,
      p_stage_code: stageCode,
      p_notes: stageNotes.trim() || null,
    })
    setBusy(false)
    if (error) {
      flash('error', error.message)
      return
    }
    setStageCode('')
    setStageNotes('')
    flash('ok', 'تم تسجيل المرحلة.')
    await loadBase()
    await loadDetail(selectedId)
  }

  async function approveLaptop() {
    setBusy(true)
    setMsg(null)
    const { error } = await supabase.rpc('fn_approve_laptop', { p_laptop_id: selectedId })
    setBusy(false)
    if (error) {
      flash('error', error.message)
      return
    }
    flash('ok', 'تم اعتماد اللاب — بانتظار إصدار الحسابات.')
    await loadBase()
    await loadDetail(selectedId)
  }

  async function releaseLaptop(decision) {
    let reason = null
    if (decision === 'returned') {
      reason = window.prompt('سبب الإرجاع؟') ?? null
      if (reason === null) return
    }
    setBusy(true)
    setMsg(null)
    const { error } = await supabase.rpc('fn_release_laptop', {
      p_laptop_id: selectedId,
      p_decision: decision,
      p_reason: reason,
    })
    setBusy(false)
    if (error) {
      flash('error', error.message)
      return
    }
    flash('ok', decision === 'released' ? 'تم إصدار اللاب واحتساب الإنتاجية.' : 'تم إرجاع اللاب.')
    await loadBase()
    await loadDetail(selectedId)
  }

  async function addEntry(e) {
    e.preventDefault()
    const op = operations.find((o) => String(o.id) === String(opId))
    if (!op) return
    setBusy(true)
    setMsg(null)
    const { error } = await supabase.from('production_entries').insert({
      worker_id: user.id,
      operation_id: op.id,
      laptop_id: selectedId,
      stage_code: selected?.current_stage ?? null,
      quantity: Number(opQty) || 1,
      status: 'draft',
    })
    setBusy(false)
    if (error) {
      flash('error', error.message)
      return
    }
    setOpQty(1)
    flash('ok', 'تم تسجيل العملية على اللاب (مسودّة).')
    await loadDetail(selectedId)
  }

  async function submitEntry(entryId) {
    setBusy(true)
    setMsg(null)
    const { error } = await supabase.rpc('fn_submit_entry', { p_entry_id: entryId })
    setBusy(false)
    if (error) {
      flash('error', error.message)
      return
    }
    flash('ok', 'تم تقديم الإدخال للمراجعة.')
    await loadDetail(selectedId)
  }

  return (
    <Layout title="مسار اللاب">
      <div className="mb-4 flex flex-wrap items-center justify-between gap-3">
        <h1 className="text-xl font-bold">مسار اللاب (Laptop Journey)</h1>
        <div className="flex flex-wrap gap-2">
          <form onSubmit={openBySerial} className="flex gap-2">
            <input
              className="input !w-44 !py-2"
              dir="ltr"
              value={serialQuery}
              onChange={(e) => setSerialQuery(e.target.value)}
              placeholder="ابحث بالسيريال…"
              aria-label="بحث بالسيريال"
            />
            <button type="submit" disabled={busy || !serialQuery.trim()} className="btn-ghost !py-2">
              فتح
            </button>
          </form>
          <button onClick={() => setScanning(true)} className="btn-ghost !py-2">
            مسح QR
          </button>
          <Link to="/laptops/labels" className="btn-ghost !py-2">
            ملصقات QR
          </Link>
          {CAN_CREATE.includes(role) && (
            <button onClick={() => setShowNew((v) => !v)} className="btn-primary !py-2">
              + لاب جديد
            </button>
          )}
        </div>
      </div>

      {msg && (
        <div
          className={`mb-4 rounded-lg p-3 text-sm ${
            msg.type === 'error' ? 'bg-red-50 text-red-700' : 'bg-emerald-50 text-emerald-700'
          }`}
        >
          {msg.text}
        </div>
      )}

      {showNew && (
        <form onSubmit={createLaptop} className="card mb-4 space-y-3">
          <h2 className="font-bold">إضافة لاب</h2>
          <div className="grid gap-3 sm:grid-cols-2">
            <div>
              <label className="label">السيريال (سيبها فاضية لتوليده تلقائيًا)</label>
              <input
                className="input"
                dir="ltr"
                value={newSerial}
                onChange={(e) => setNewSerial(e.target.value)}
                placeholder="مثال: LAP-000123"
              />
            </div>
            <div>
              <label className="label">ملاحظات (اختياري)</label>
              <input className="input" value={newNotes} onChange={(e) => setNewNotes(e.target.value)} />
            </div>
          </div>
          <div className="flex justify-end gap-2">
            <button type="button" onClick={() => setShowNew(false)} className="btn-ghost">
              إلغاء
            </button>
            <button type="submit" disabled={busy} className="btn-accent">
              {busy ? 'جاري الإنشاء…' : 'إنشاء اللاب'}
            </button>
          </div>
        </form>
      )}

      <div className="grid gap-4 lg:grid-cols-5">
        {/* قائمة اللابات */}
        <div className="card lg:col-span-2">
          <h2 className="mb-3 font-bold">اللابات ({laptops.length})</h2>
          <div className="table-wrap">
            <table className="table table-cards">
              <thead>
                <tr>
                  <th>السيريال</th>
                  <th>الحالة</th>
                  <th>المرحلة</th>
                </tr>
              </thead>
              <tbody>
                {laptops.length === 0 && (
                  <tr>
                    <td colSpan={3} className="py-6 text-center text-slate-400">
                      مفيش لابات مسجّلة
                    </td>
                  </tr>
                )}
                {laptops.map((l) => (
                  <tr
                    key={l.id}
                    onClick={() => setSelectedId(l.id)}
                    className={`cursor-pointer hover:bg-slate-50 ${
                      selectedId === l.id ? 'bg-slate-100' : ''
                    }`}
                  >
                    <td data-label="السيريال" dir="ltr" className="text-left font-mono">
                      {l.serial}
                    </td>
                    <td data-label="الحالة">
                      <StatusBadge status={l.current_status} />
                    </td>
                    <td data-label="المرحلة">
                      {l.current_stage ? stageByCode[l.current_stage]?.name_ar ?? l.current_stage : '-'}
                    </td>
                  </tr>
                ))}
              </tbody>
            </table>
          </div>
        </div>

        {/* تفاصيل اللاب */}
        <div className="space-y-4 lg:col-span-3">
          {!selected && (
            <div className="card text-center text-slate-400">اختار لاب من القائمة لعرض مساره.</div>
          )}

          {selected && (
            <>
              <div className="card">
                <div className="flex flex-wrap items-center justify-between gap-2">
                  <div>
                    <h2 className="font-bold" dir="ltr">
                      {selected.serial}
                    </h2>
                    <p className="text-xs text-slate-500">
                      أُنشئ: {formatDate(selected.created_at)}
                      {selected.approved_at ? ` · اعتُمد: ${formatDate(selected.approved_at)}` : ''}
                      {selected.released_at ? ` · أُصدر: ${formatDate(selected.released_at)}` : ''}
                    </p>
                  </div>
                  <StatusBadge status={selected.current_status} />
                </div>

                {/* تقدّم المراحل الإلزامية */}
                <div className="mt-3 flex flex-wrap gap-2">
                  {mandatoryStages.map((s) => {
                    const done = doneStages.has(s.code)
                    return (
                      <span
                        key={s.code}
                        className={`badge ${
                          done ? 'bg-emerald-100 text-emerald-800' : 'bg-slate-100 text-slate-500'
                        }`}
                      >
                        {done ? '✓ ' : '• '}
                        {s.name_ar}
                      </span>
                    )
                  })}
                </div>

                {/* الإجراءات حسب الدور */}
                <div className="mt-4 flex flex-wrap gap-2">
                  {['worker', 'supervisor'].includes(role) &&
                    !['released', 'rejected'].includes(selected.current_status) && (
                      <form onSubmit={advanceStage} className="flex flex-wrap items-center gap-2">
                        <select
                          className="input !w-auto"
                          value={stageCode}
                          onChange={(e) => setStageCode(e.target.value)}
                          required
                        >
                          <option value="">اختر مرحلة…</option>
                          {stages.map((s) => (
                            <option key={s.code} value={s.code}>
                              {s.name_ar}
                            </option>
                          ))}
                        </select>
                        <input
                          className="input !w-48"
                          placeholder="ملاحظة المرحلة (اختياري)"
                          value={stageNotes}
                          onChange={(e) => setStageNotes(e.target.value)}
                        />
                        <button type="submit" disabled={busy} className="btn-primary !py-2">
                          تسجيل المرحلة
                        </button>
                      </form>
                    )}

                  {role === 'supervisor' && selected.current_status !== 'released' && (
                    <button onClick={approveLaptop} disabled={busy} className="btn-accent !py-2">
                      اعتماد اللاب
                    </button>
                  )}

                  {role === 'accountant' && selected.current_status !== 'released' && (
                    <>
                      <button
                        onClick={() => releaseLaptop('released')}
                        disabled={busy}
                        className="btn-accent !py-2"
                      >
                        إصدار نهائي
                      </button>
                      <button
                        onClick={() => releaseLaptop('returned')}
                        disabled={busy}
                        className="btn-danger !py-2"
                      >
                        إرجاع
                      </button>
                    </>
                  )}
                </div>
              </div>

              {/* تسجيل عملية على اللاب */}
              {['worker', 'supervisor'].includes(role) && (
                <form onSubmit={addEntry} className="card space-y-3">
                  <h2 className="font-bold">تسجيل عملية على اللاب</h2>
                  <div className="grid gap-3 sm:grid-cols-3">
                    <div className="sm:col-span-2">
                      <label className="label">نوع العملية</label>
                      <select className="input" value={opId} onChange={(e) => setOpId(e.target.value)} required>
                        <option value="">اختر عملية…</option>
                        {operations.map((o) => (
                          <option key={o.id} value={o.id}>
                            {o.name_ar}
                          </option>
                        ))}
                      </select>
                    </div>
                    <div>
                      <label className="label">العدد</label>
                      <input
                        type="number"
                        min="1"
                        className="input"
                        value={opQty}
                        onChange={(e) => setOpQty(e.target.value)}
                      />
                    </div>
                  </div>
                  <div className="flex justify-end">
                    <button type="submit" disabled={busy} className="btn-accent">
                      إضافة (مسودّة)
                    </button>
                  </div>
                </form>
              )}

              {/* عمليات اللاب */}
              <div className="card">
                <h2 className="mb-3 font-bold">العمليات المسجّلة ({entries.length})</h2>
                <div className="table-wrap">
                  <table className="table table-cards">
                    <thead>
                      <tr>
                        <th>العملية</th>
                        <th>العدد</th>
                        <th>الحالة</th>
                        <th>إجراء</th>
                      </tr>
                    </thead>
                    <tbody>
                      {entries.length === 0 && (
                        <tr>
                          <td colSpan={4} className="py-4 text-center text-slate-400">
                            مفيش عمليات
                          </td>
                        </tr>
                      )}
                      {entries.map((e) => (
                        <tr key={e.id}>
                          <td data-label="العملية">{e.operations?.name_ar ?? '-'}</td>
                          <td data-label="العدد">{e.quantity}</td>
                          <td data-label="الحالة">
                            <StatusBadge status={e.status} />
                          </td>
                          <td data-label="إجراء">
                            {e.status === 'draft' && e.worker_id === user.id && (
                              <button
                                onClick={() => submitEntry(e.id)}
                                disabled={busy}
                                className="btn-ghost !py-1 !px-3 text-xs"
                              >
                                تقديم للمراجعة
                              </button>
                            )}
                          </td>
                        </tr>
                      ))}
                    </tbody>
                  </table>
                </div>
              </div>

              {/* الـ Timeline */}
              <div className="card">
                <h2 className="mb-3 font-bold">مسار اللاب (Timeline)</h2>
                <ol className="space-y-3">
                  {movements.length === 0 && <li className="text-slate-400">مفيش حركات.</li>}
                  {movements.map((m) => (
                    <li key={m.id} className="flex gap-3">
                      <span className="mt-1 h-2.5 w-2.5 shrink-0 rounded-full bg-blue-600" />
                      <div className="text-sm">
                        <div className="font-medium">
                          {m.stage_code ? stageByCode[m.stage_code]?.name_ar ?? m.stage_code : m.action}
                          {m.to_status ? ` — ${m.to_status}` : ''}
                        </div>
                        <div className="text-xs text-slate-500">
                          {m.profiles?.full_name ?? 'النظام'} · {formatDate(m.created_at)}
                          {m.notes ? ` · ${m.notes}` : ''}
                        </div>
                      </div>
                    </li>
                  ))}
                </ol>
              </div>
            </>
          )}
        </div>
      </div>

      {scanning && <QRScannerModal onClose={() => setScanning(false)} onResult={handleScan} />}
    </Layout>
  )
}
