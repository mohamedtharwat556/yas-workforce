import { createContext, useCallback, useContext, useEffect, useState } from 'react'
import { supabase, supabaseConfigured } from '../lib/supabase'

const AuthContext = createContext(null)

export function AuthProvider({ children }) {
  const [session, setSession] = useState(null)
  const [profile, setProfile] = useState(null)
  const [loading, setLoading] = useState(true)

  const loadProfile = useCallback(async (uid) => {
    if (!uid) {
      setProfile(null)
      return
    }
    const { data } = await supabase.from('profiles').select('*').eq('id', uid).maybeSingle()
    setProfile(data ?? null)
  }, [])

  useEffect(() => {
    if (!supabaseConfigured) {
      setLoading(false)
      return
    }
    let active = true
    supabase.auth.getSession().then(async ({ data }) => {
      if (!active) return
      setSession(data.session)
      await loadProfile(data.session?.user?.id)
      setLoading(false)
    })
    const { data: sub } = supabase.auth.onAuthStateChange(async (_event, s) => {
      setSession(s)
      await loadProfile(s?.user?.id)
    })
    return () => {
      active = false
      sub.subscription.unsubscribe()
    }
  }, [loadProfile])

  const signIn = (email, password) => supabase.auth.signInWithPassword({ email, password })

  const signUp = (fullName, email, password) =>
    supabase.auth.signUp({
      email,
      password,
      options: { data: { full_name: fullName } },
    })

  const signOut = () => supabase.auth.signOut()

  // تغيير كلمة مرور المستخدم الحالي
  const changePassword = (password) => supabase.auth.updateUser({ password })

  const reloadProfile = useCallback(() => loadProfile(session?.user?.id), [loadProfile, session])

  return (
    <AuthContext.Provider
      value={{
        session,
        user: session?.user ?? null,
        profile,
        loading,
        signIn,
        signUp,
        signOut,
        changePassword,
        reloadProfile,
      }}
    >
      {children}
    </AuthContext.Provider>
  )
}

export const useAuth = () => useContext(AuthContext)
