import { Link, useLocation } from 'react-router-dom'
import { useAuth } from '../context/AuthContext'
import InstallPrompt from './InstallPrompt'
import NotificationBell from './NotificationBell'

const NAV = {
  worker: [
    { to: '/worker', label: 'إنتاجي اليوم', short: 'إنتاجي' },
    { to: '/worker/incentives', label: 'تفاصيل إنتاجي', short: 'تفاصيلي' },
    { to: '/worker/archive', label: 'أرشيف إنتاجي', short: 'أرشيف' },
  ],
  supervisor: [
    { to: '/supervisor', label: 'لوحة المشرف', short: 'المشرف' },
    { to: '/supervisor/accounts', label: 'إدارة الحسابات', short: 'حسابات' },
    { to: '/audit', label: 'سجل الأوديت', short: 'أوديت' },
  ],
  accountant: [
    { to: '/accountant', label: 'التقارير', short: 'تقارير' },
    { to: '/supervisor', label: 'لوحة المشرف', short: 'المشرف' },
    { to: '/supervisor/accounts', label: 'إدارة الحسابات', short: 'حسابات' },
    { to: '/management', label: 'لوحة الإدارة', short: 'الإدارة' },
    { to: '/audit', label: 'سجل الأوديت', short: 'أوديت' },
  ],
}

const ROLE_LABEL = { worker: 'عامل', supervisor: 'مشرف', accountant: 'الحسابات' }

// أيقونات SVG بسيطة لكل مسار
const ICONS = {
  '/worker': <path d="M12 5v14M5 12h14" />,
  '/worker/incentives': (
    <>
      <path d="M12 2v20" />
      <path d="M17 6H9.5a3.5 3.5 0 0 0 0 7h5a3.5 3.5 0 0 1 0 7H6" />
    </>
  ),
  '/worker/archive': (
    <>
      <rect x="3" y="4" width="18" height="4" rx="1" />
      <path d="M5 8v11a1 1 0 0 0 1 1h12a1 1 0 0 0 1-1V8" />
      <path d="M10 12h4" />
    </>
  ),
  '/supervisor': (
    <>
      <path d="M12 3l7 4v5c0 4-3 7-7 9-4-2-7-5-7-9V7z" />
      <path d="M9 12l2 2 4-4" />
    </>
  ),
  '/accountant': <path d="M4 20V10M10 20V4M16 20v-7M21 20H3" />,
  '/supervisor/accounts': (
    <>
      <circle cx="12" cy="8" r="4" />
      <path d="M4 21c0-4 4-6 8-6s8 2 8 6" />
    </>
  ),
  '/management': (
    <>
      <path d="M3 21h18" />
      <path d="M5 21V10M10 21V6M15 21v-8M20 21v-4" />
    </>
  ),
  '/audit': (
    <>
      <path d="M9 4h6a2 2 0 0 1 2 2v0H7v0a2 2 0 0 1 2-2z" />
      <path d="M7 6H5v14a2 2 0 0 0 2 2h10a2 2 0 0 0 2-2V6h-2" />
      <path d="M9 12h6M9 16h4" />
    </>
  ),
}

function Icon({ to }) {
  return (
    <svg
      viewBox="0 0 24 24"
      fill="none"
      stroke="currentColor"
      strokeWidth="1.8"
      strokeLinecap="round"
      strokeLinejoin="round"
      className="h-6 w-6"
      aria-hidden="true"
    >
      {ICONS[to] ?? null}
    </svg>
  )
}

export default function Layout({ title, children }) {
  const { profile, signOut } = useAuth()
  const location = useLocation()
  const items = NAV[profile?.role] ?? []

  return (
    <div className="min-h-screen">
      <header className="sticky top-0 z-30 border-b border-blue-800 bg-blue-700 text-white">
        <div className="mx-auto flex max-w-6xl items-center justify-between gap-3 px-4 py-3">
          <div className="flex min-w-0 items-center gap-2">
            <span className="whitespace-nowrap text-base font-bold text-white md:text-lg">YAS Workforce</span>
            {title && <span className="hidden truncate text-sm text-blue-200 sm:inline">· {title}</span>}
          </div>
          <div className="flex shrink-0 items-center gap-3">
            <span className="hidden text-sm text-blue-100 md:inline">
              {profile?.full_name} · <span className="font-medium text-white">{ROLE_LABEL[profile?.role] ?? profile?.role}</span>
            </span>
            <NotificationBell />
            <Link
              to="/password"
              aria-label="تغيير كلمة المرور"
              title="تغيير كلمة المرور"
              className="rounded-lg border border-white/40 bg-white/10 p-2 text-white hover:bg-white/20"
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
                <circle cx="8" cy="15" r="4" />
                <path d="M10.85 12.15 19 4M17 5l2 2M14 8l2 2" />
              </svg>
            </Link>
            <button
              onClick={signOut}
              className="btn border border-white/40 bg-white/10 !px-3 !py-1 text-sm text-white hover:bg-white/20"
            >
              خروج
            </button>
          </div>
        </div>

        {/* شريط التنقّل العلوي — للشاشات الكبيرة */}
        <nav className="mx-auto hidden max-w-6xl gap-1 px-4 pb-2 md:flex">
          {items.map((item) => {
            const active = location.pathname === item.to
            return (
              <Link
                key={item.to}
                to={item.to}
                className={`rounded-lg px-3 py-1.5 text-sm ${
                  active ? 'bg-white font-medium text-blue-700' : 'text-blue-100 hover:bg-white/15 hover:text-white'
                }`}
              >
                {item.label}
              </Link>
            )
          })}
        </nav>
      </header>

      <main className="mx-auto max-w-6xl px-3 pb-24 pt-4 md:px-4 md:pb-6 md:pt-6">
        {title && <h1 className="mb-4 text-xl font-bold md:hidden">{title}</h1>}
        {children}
      </main>

      {/* شريط التنقّل السفلي — للموبايل */}
      {items.length > 0 && (
        <nav className="pb-safe fixed inset-x-0 bottom-0 z-40 border-t border-slate-200 bg-white md:hidden">
          <div className="flex">
            {items.map((item) => {
              const active = location.pathname === item.to
              return (
                <Link
                  key={item.to}
                  to={item.to}
                  className={`flex flex-1 flex-col items-center gap-0.5 py-2 text-[11px] ${
                    active ? 'font-semibold text-blue-700' : 'text-slate-500'
                  }`}
                >
                  <Icon to={item.to} />
                  <span>{item.short ?? item.label}</span>
                </Link>
              )
            })}
          </div>
        </nav>
      )}

      <InstallPrompt />
    </div>
  )
}
