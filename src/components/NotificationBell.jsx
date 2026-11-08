import { useCallback, useEffect, useRef, useState } from 'react'
import { useNavigate } from 'react-router-dom'
import { supabase, supabaseConfigured } from '../lib/supabase'
import { useAuth } from '../context/AuthContext'

const LIMIT = 20

// لون لكل نوع إشعار (نقطة صغيرة)
const TONES = {
  entry_submitted: 'bg-amber-500',
  entry_approved: 'bg-emerald-500',
  entry_returned: 'bg-red-500',
  laptop_awaiting_release: 'bg-blue-600',
  laptop_released: 'bg-emerald-600',
  laptop_returned: 'bg-red-600',
  month_closed: 'bg-violet-600',
}

function targetFor(type, role) {
  switch (type) {
    case 'entry_submitted':
      return '/supervisor'
    case 'entry_approved':
    case 'entry_returned':
      return '/worker'
    case 'laptop_awaiting_release':
      return '/accountant'
    case 'laptop_released':
    case 'laptop_returned':
      return '/laptops'
    case 'month_closed':
      return role === 'worker' ? '/worker/incentives' : '/accountant/locks'
    default:
      return null
  }
}

function timeAgo(value) {
  if (!value) return ''
  const diff = Date.now() - new Date(value).getTime()
  const min = Math.floor(diff / 60000)
  if (min < 1) return 'الآن'
  if (min < 60) return `قبل ${min} دقيقة`
  const hr = Math.floor(min / 60)
  if (hr < 24) return `قبل ${hr} ساعة`
  const day = Math.floor(hr / 24)
  if (day < 30) return `قبل ${day} يوم`
  return new Date(value).toLocaleDateString('ar-EG', { year: 'numeric', month: '2-digit', day: '2-digit' })
}

export default function NotificationBell() {
  const { profile } = useAuth()
  const navigate = useNavigate()
  const [items, setItems] = useState([])
  const [unread, setUnread] = useState(0)
  const [open, setOpen] = useState(false)
  const boxRef = useRef(null)

  const load = useCallback(async () => {
    if (!supabaseConfigured || !profile?.id) return
    const [listRes, countRes] = await Promise.all([
      supabase
        .from('notifications')
        .select('id, type, title, body, read_at, created_at')
        .order('created_at', { ascending: false })
        .limit(LIMIT),
      supabase
        .from('notifications')
        .select('id', { count: 'exact', head: true })
        .is('read_at', null),
    ])
    setItems(listRes.data ?? [])
    setUnread(countRes.count ?? 0)
  }, [profile?.id])

  // تحميل أولي + تحديث دوري كل دقيقة (احتياطي لو الـ Realtime فشل)
  useEffect(() => {
    load()
    const t = setInterval(load, 60000)
    return () => clearInterval(t)
  }, [load])

  // إشعارات لحظية عبر Supabase Realtime
  useEffect(() => {
    if (!supabaseConfigured || !profile?.id) return
    const channel = supabase
      .channel('notifications-live')
      .on(
        'postgres_changes',
        { event: 'INSERT', schema: 'public', table: 'notifications', filter: `user_id=eq.${profile.id}` },
        (payload) => {
          setItems((prev) => [payload.new, ...prev].slice(0, LIMIT))
          setUnread((c) => c + 1)
        }
      )
      .on(
        'postgres_changes',
        { event: 'UPDATE', schema: 'public', table: 'notifications', filter: `user_id=eq.${profile.id}` },
        () => load()
      )
      .subscribe()
    return () => {
      supabase.removeChannel(channel)
    }
  }, [profile?.id, load])

  // تحديث لما المستخدم يرجع للتطبيق
  useEffect(() => {
    const onFocus = () => load()
    window.addEventListener('focus', onFocus)
    return () => window.removeEventListener('focus', onFocus)
  }, [load])

  // إغلاق عند الضغط برّه
  useEffect(() => {
    if (!open) return
    const onDown = (e) => {
      if (boxRef.current && !boxRef.current.contains(e.target)) setOpen(false)
    }
    document.addEventListener('mousedown', onDown)
    return () => document.removeEventListener('mousedown', onDown)
  }, [open])

  const toggle = () => {
    setOpen((v) => !v)
    load()
  }

  const markAllRead = async () => {
    if (!unread) return
    const now = new Date().toISOString()
    setItems((prev) => prev.map((n) => (n.read_at ? n : { ...n, read_at: now })))
    setUnread(0)
    await supabase.from('notifications').update({ read_at: now }).is('read_at', null)
    load()
  }

  const openItem = async (n) => {
    setOpen(false)
    if (!n.read_at) {
      const now = new Date().toISOString()
      setItems((prev) => prev.map((x) => (x.id === n.id ? { ...x, read_at: now } : x)))
      setUnread((c) => Math.max(0, c - 1))
      await supabase.from('notifications').update({ read_at: now }).eq('id', n.id).is('read_at', null)
      load()
    }
    const to = targetFor(n.type, profile?.role)
    if (to) navigate(to)
  }

  return (
    <div ref={boxRef} className="relative">
      <button
        type="button"
        onClick={toggle}
        aria-label="الإشعارات"
        className="relative rounded-lg border border-white/40 bg-white/10 p-2 text-white hover:bg-white/20"
      >
        <svg
          viewBox="0 0 24 24"
          fill="none"
          stroke="currentColor"
          strokeWidth="1.8"
          strokeLinecap="round"
          strokeLinejoin="round"
          className="h-5 w-5"
          aria-hidden="true"
        >
          <path d="M18 8a6 6 0 1 0-12 0c0 7-3 9-3 9h18s-3-2-3-9" />
          <path d="M13.7 21a2 2 0 0 1-3.4 0" />
        </svg>
        {unread > 0 && (
          <span className="absolute -top-1.5 -left-1.5 min-w-[18px] rounded-full bg-red-500 px-1 text-center text-[11px] font-bold leading-[18px] text-white">
            {unread > 99 ? '99+' : unread}
          </span>
        )}
      </button>

      {open && (
        <div className="absolute left-0 top-full z-50 mt-2 w-80 max-w-[85vw] overflow-hidden rounded-xl border border-slate-200 bg-white text-slate-800 shadow-lg">
          <div className="flex items-center justify-between border-b border-slate-100 bg-blue-50 px-3 py-2">
            <span className="text-sm font-semibold text-blue-800">الإشعارات</span>
            {unread > 0 && (
              <button type="button" onClick={markAllRead} className="text-xs font-medium text-blue-700 hover:underline">
                تعليم الكل كمقروء
              </button>
            )}
          </div>

          <div className="max-h-80 overflow-y-auto">
            {items.length === 0 ? (
              <p className="px-3 py-6 text-center text-sm text-slate-400">مفيش إشعارات لسه</p>
            ) : (
              items.map((n) => (
                <button
                  key={n.id}
                  type="button"
                  onClick={() => openItem(n)}
                  className={`flex w-full items-start gap-2 border-b border-slate-100 px-3 py-2.5 text-right last:border-b-0 hover:bg-slate-50 ${
                    n.read_at ? '' : 'bg-blue-50/60'
                  }`}
                >
                  <span className={`mt-1.5 h-2 w-2 shrink-0 rounded-full ${TONES[n.type] ?? 'bg-slate-400'}`} />
                  <span className="min-w-0 flex-1">
                    <span className={`block truncate text-sm ${n.read_at ? 'text-slate-700' : 'font-semibold text-slate-900'}`}>
                      {n.title}
                    </span>
                    {n.body && <span className="mt-0.5 block text-xs text-slate-500">{n.body}</span>}
                    <span className="mt-0.5 block text-[11px] text-slate-400">{timeAgo(n.created_at)}</span>
                  </span>
                </button>
              ))
            )}
          </div>
        </div>
      )}
    </div>
  )
}
