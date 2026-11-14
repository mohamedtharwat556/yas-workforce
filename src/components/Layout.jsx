import { Link, useLocation } from 'react-router-dom'
import { useAuth } from '../context/AuthContext'
import InstallPrompt from './InstallPrompt'
import NotificationBell from './NotificationBell'

const NAV = {
  supervisor: [
    { to: '/supervisor', label: 'لوحة المشرف', short: 'المشرف' },
    { to: '/supervisor/employees', label: 'أسماء الموظفين', short: 'الموظفين' },
    { to: '/supervisor/stages', label: 'الوجهات والمراحل', short: 'المراحل' },
    { to: '/supervisor/productivity', label: 'الإنتاجية', short: 'الإنتاجية' },
    { to: '/audit', label: 'سجل الأوديت', short: 'أوديت' },
  ],
  accountant: [
    { to: '/accountant', label: 'التقارير', short: 'تقارير' },
    { to: '/supervisor', label: 'لوحة المشرف', short: 'المشرف' },
    { to: '/management', label: 'لوحة الإدارة', short: 'الإدارة' },
    { to: '/audit', label: 'سجل الأوديت', short: 'أوديت' },
  ],
}

const ROLE_LABEL = { supervisor: 'مشرف', accountant: 'الحسابات' }

// أيقونات SVG بسيطة لكل مسار
const ICONS = {
  '/supervisor': (
    <>
      <path d="M12 3l7 4v5c0 4-3 7-7 9-4-2-7-5-7-9V7z" />
      <path d="M9 12l2 2 4-4" />
    </>
  ),
  '/accountant': <path d="M4 20V10M10 20V4M16 20v-7M21 20H3" />,
  '/supervisor/employees': (
    <>
      <circle cx="9" cy="8" r="3.2" />
      <path d="M3.5 19c0-3 2.6-4.6 5.5-4.6s5.5 1.6 5.5 4.6" />
      <path d="M16 6.5h5M16 10.5h5M16 14.5h3" />
    </>
  ),
  '/supervisor/stages': (
    <>
      <path d="M4 6h16M4 12h16M4 18h10" />
      <circle cx="18" cy="18" r="3" />
    </>
  ),
  '/supervisor/productivity': (
    <>
      <circle cx="8" cy="7" r="3" />
      <path d="M3 20c0-3 2.3-5 5-5s5 2 5 5" />
      <path d="M16 20v-6M20 20v-9" />
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
            {title && <span className="hidden truncate text-sm text-blue-200 md:inline">· {title}</span>}
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
        <nav className="pb-safe fixed inset-x-0 bottom-0 z-40 border-t border-slate-200 bg-white/95 backdrop-blur md:hidden">
          <div className="no-scrollbar flex overflow-x-auto">
            {items.map((item) => {
              const active = location.pathname === item.to
              return (
                <Link
                  key={item.to}
                  to={item.to}
                  aria-current={active ? 'page' : undefined}
                  className={`relative flex min-w-[4.5rem] flex-1 shrink-0 flex-col items-center gap-0.5 px-1 py-2 text-[11px] transition active:scale-95 ${
                    active ? 'font-semibold text-blue-700' : 'text-slate-500'
                  }`}
                >
                  {active && <span className="absolute inset-x-4 top-0 h-0.5 rounded-full bg-blue-700" />}
                  <Icon to={item.to} />
                  <span className="max-w-full truncate">{item.short ?? item.label}</span>
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
