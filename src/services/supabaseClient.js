import { createClient } from '@supabase/supabase-js'

const supabaseUrl = import.meta.env.VITE_SUPABASE_URL
const supabaseAnonKey = import.meta.env.VITE_SUPABASE_ANON_KEY
export const isLocalDemo = import.meta.env.VITE_LOCAL_DEMO_MODE === 'true'

const demoListeners = new Set()
const DEMO_SESSION_KEY = 'ats_local_demo_session'
const demoUser = {
  id: 'demo-admin',
  email: 'demo@localhost.test',
  user_metadata: { full_name: 'Demo Administrator', name: 'Demo Administrator' }
}

function demoSession() {
  if (typeof window === 'undefined' || window.localStorage.getItem(DEMO_SESSION_KEY) !== 'signed-in') return null
  return { access_token: 'local-demo-token', token_type: 'bearer', expires_at: 4102444800, user: demoUser }
}

function demoChannel(name) {
  return {
    name,
    on() { return this },
    subscribe(callback) { queueMicrotask(() => callback?.('SUBSCRIBED')); return this },
    unsubscribe() { return Promise.resolve('ok') }
  }
}

const localDemoClient = {
  auth: {
    async getSession() { return { data: { session: demoSession() }, error: null } },
    onAuthStateChange(callback) {
      demoListeners.add(callback)
      return { data: { subscription: { unsubscribe: () => demoListeners.delete(callback) } } }
    },
    async signInWithPassword() {
      window.localStorage.setItem(DEMO_SESSION_KEY, 'signed-in')
      const session = demoSession()
      demoListeners.forEach(listener => listener('SIGNED_IN', session))
      return { data: { session, user: demoUser }, error: null }
    },
    async signInWithOAuth() { return this.signInWithPassword() },
    async signOut() {
      window.localStorage.removeItem(DEMO_SESSION_KEY)
      demoListeners.forEach(listener => listener('SIGNED_OUT', null))
      return { error: null }
    }
  },
  channel: demoChannel,
  removeChannel: channel => channel?.unsubscribe?.(),
  from: () => ({ select: async () => ({ data: [], error: null }) }),
  storage: {
    from: () => ({
      upload: async (path) => ({ data: { path }, error: null }),
      remove: async () => ({ data: [], error: null })
    })
  }
}

export const isSupabaseConfigured = isLocalDemo || Boolean(supabaseUrl && supabaseAnonKey)

export const supabase = isLocalDemo
  ? localDemoClient
  : isSupabaseConfigured
  ? createClient(supabaseUrl, supabaseAnonKey)
  : null
