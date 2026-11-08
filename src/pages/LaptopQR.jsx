import { useEffect, useMemo, useState } from 'react'
import { Link } from 'react-router-dom'
import Layout from '../components/Layout'
import StatusBadge, { STATUS_MAP } from '../components/StatusBadge'
import { supabase } from '../lib/supabase'
import { laptopUrl, makeBarcodeDataUrl, makeQrDataUrl, printLabels } from '../lib/labels'

const STATUSES = ['received', 'in_progress', 'awaiting_release', 'released', 'on_hold', 'rejected', 'returned']

export default function LaptopQR() {
  const [laptops, setLaptops] = useState([])
  const [stages, setStages] = useState([])
  const [search, setSearch] = useState('')
  const [status, setStatus] = useState('')
  const [selected, setSelected] = useState(() => new Set())
  const [previews, setPreviews] = useState({})
  const [busy, setBusy] = useState(false)
  const [msg, setMsg] = useState(null)

  useEffect(() => {
    let active = true
    async function load() {
      const [l, s] = await Promise.all([
        supabase.from('laptops').select('*').order('created_at', { ascending: false }).limit(300),
        supabase.from('stages').select('*'),
      ])
      if (!active) return
      setLaptops(l.data ?? [])
      setStages(s.data ?? [])
    }
    load()
    return () => {
      active = false
    }
  }, [])

  // توليد صور الـ QR لكل اللابات مرة واحدة (للمعاينة)
  useEffect(() => {
    let active = true
    async function gen() {
      if (laptops.length === 0) {
        setPreviews({})
        return
      }
      const out = {}
      for (const l of laptops) {
        out[l.id] = await makeQrDataUrl(laptopUrl(l.qr_token), 160)
      }
      if (active) setPreviews(out)
    }
    gen()
    return () => {
      active = false
    }
  }, [laptops])

  const stageByCode = useMemo(() => Object.fromEntries(stages.map((s) => [s.code, s])), [stages])

  const filtered = useMemo(() => {
    const term = search.trim().toLowerCase()
    return laptops.filter((l) => {
      if (status && l.current_status !== status) return false
      if (term && !String(l.serial).toLowerCase().includes(term)) return false
      return true
    })
  }, [laptops, search, status])

  function toggle(id) {
    setSelected((prev) => {
      const next = new Set(prev)
      if (next.has(id)) next.delete(id)
      else next.add(id)
      return next
    })
  }

  async function doPrint() {
    const ids = selected.size ? selected : new Set(filtered.map((l) => l.id))
    const list = filtered.filter((l) => ids.has(l.id))
    if (list.length === 0) {
      setMsg({ type: 'error', text: 'مفيش لابات محدّدة للطباعة.' })
      return
    }
    setBusy(true)
    setMsg(null)
    const labels = []
    for (const l of list) {
      const stageName = l.current_stage ? stageByCode[l.current_stage]?.name_ar ?? l.current_stage : ''
      const statusName = STATUS_MAP[l.current_status]?.[1] ?? l.current_status
      labels.push({
        qr: await makeQrDataUrl(laptopUrl(l.qr_token), 260),
        barcode: makeBarcodeDataUrl(l.serial),
        serial: l.serial,
        sub: [stageName, statusName].filter(Boolean).join(' · '),
      })
    }
    setBusy(false)
    printLabels(labels, { title: `ملصقات لابات YAS (${labels.length})` })
    setMsg({ type: 'ok', text: `اتجهّز ${labels.length} ملصق للطباعة.` })
  }

  return (
    <Layout title="ملصقات QR">
      <div className="mb-4 flex flex-wrap items-center justify-between gap-3">
        <h1 className="text-xl font-bold">ملصقات QR / باركود اللابات</h1>
        <Link to="/laptops" className="btn-ghost">
          مسار اللابات
        </Link>
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

      <div className="card mb-4 flex flex-wrap items-end gap-3">
        <div className="w-full sm:w-auto">
          <label className="label">بحث بالسيريال</label>
          <input className="input w-56" dir="ltr" value={search} onChange={(e) => setSearch(e.target.value)} />
        </div>
        <div className="w-full sm:w-auto">
          <label className="label">الحالة</label>
          <select className="input w-44" value={status} onChange={(e) => setStatus(e.target.value)}>
            <option value="">كل الحالات</option>
            {STATUSES.map((s) => (
              <option key={s} value={s}>
                {STATUS_MAP[s]?.[1] ?? s}
              </option>
            ))}
          </select>
        </div>
        <div className="flex-1" />
        <button onClick={() => setSelected(new Set(filtered.map((l) => l.id)))} className="btn-ghost">
          تحديد الكل ({filtered.length})
        </button>
        <button onClick={() => setSelected(new Set())} disabled={selected.size === 0} className="btn-ghost">
          إلغاء التحديد
        </button>
        <button onClick={doPrint} disabled={busy || filtered.length === 0} className="btn-accent">
          {busy ? 'جاري التجهيز…' : `طباعة الملصقات (${selected.size || filtered.length})`}
        </button>
      </div>

      <div className="card mb-4 text-sm text-slate-500">
        كل ملصق فيه QR بيفتح مسار اللاب مباشرة + السيريال كباركود. من غير تحديد بيتم طبع كل النتائج المعروضة.
      </div>

      <div className="grid gap-3 sm:grid-cols-2 lg:grid-cols-3">
        {filtered.length === 0 && <div className="card text-center text-slate-400">مفيش لابات مطابقة.</div>}
        {filtered.map((l) => (
          <div
            key={l.id}
            onClick={() => toggle(l.id)}
            className={`card flex cursor-pointer items-center gap-3 ${
              selected.has(l.id) ? 'ring-2 ring-blue-600' : ''
            }`}
          >
            <input type="checkbox" readOnly checked={selected.has(l.id)} className="h-4 w-4" />
            {previews[l.id] ? (
              <img src={previews[l.id]} alt={`QR ${l.serial}`} className="h-16 w-16 shrink-0" />
            ) : (
              <div className="h-16 w-16 shrink-0 rounded bg-slate-100" />
            )}
            <div className="min-w-0 flex-1">
              <div className="truncate font-mono text-sm" dir="ltr">
                {l.serial}
              </div>
              <div className="truncate text-xs text-slate-500">
                {l.current_stage ? stageByCode[l.current_stage]?.name_ar ?? l.current_stage : '—'}
              </div>
              <div className="mt-1">
                <StatusBadge status={l.current_status} />
              </div>
            </div>
          </div>
        ))}
      </div>
    </Layout>
  )
}
