import { useEffect, useState } from 'react'
import { Link, useNavigate, useParams } from 'react-router-dom'
import { supabase } from '../lib/supabase'

// صفحة الوصول من مسح الـ QR: /l/:token — بتحوّل لمسار اللاب المحدد
export default function ScanLanding() {
  const { token } = useParams()
  const navigate = useNavigate()
  const [notFound, setNotFound] = useState(false)

  useEffect(() => {
    let active = true
    async function run() {
      const { data, error } = await supabase
        .from('laptops')
        .select('id')
        .eq('qr_token', token)
        .maybeSingle()
      if (!active) return
      if (error || !data) {
        setNotFound(true)
        return
      }
      navigate(`/laptops?laptop=${data.id}`, { replace: true })
    }
    run()
    return () => {
      active = false
    }
  }, [token, navigate])

  if (notFound) {
    return (
      <div className="p-10 text-center">
        <p className="text-slate-600 mb-4">مفيش لاب بالكود ده.</p>
        <Link to="/laptops" className="btn-ghost">
          مسار اللابات
        </Link>
      </div>
    )
  }

  return <div className="p-10 text-center text-slate-500">جاري فتح اللاب…</div>
}
