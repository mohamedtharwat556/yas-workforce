import { createClient } from '@supabase/supabase-js'

const url = import.meta.env.VITE_SUPABASE_URL
const anonKey = import.meta.env.VITE_SUPABASE_ANON_KEY

// لو الإعدادات ناقصة، النظام يشتغل لكن يعرض تنبيه بدل ما ينهار
export const supabaseConfigured = Boolean(url && anonKey)

export const supabase = createClient(url || 'http://localhost', anonKey || 'public-anon-key', {
  auth: { persistSession: true, autoRefreshToken: true },
})

// PostgREST بيرجّع 1000 صف كحد أقصى للطلب الواحد، وبالتالي أي استعلام من غير تحديد
// بيقطع البيانات بصمت. الدالة دي بتسحب كل الصفوف على دفعات لحد ما تخلّص.
// لازم تمرّر دالة بتبني الاستعلام من جديد (لأن الـ builder بيُستخدم مرة واحدة).
export async function fetchAll(buildQuery, pageSize = 1000) {
  const rows = []
  let from = 0
  for (;;) {
    const { data, error } = await buildQuery().range(from, from + pageSize - 1)
    if (error) throw error
    const batch = data ?? []
    rows.push(...batch)
    if (batch.length < pageSize) break
    from += pageSize
  }
  return rows
}
