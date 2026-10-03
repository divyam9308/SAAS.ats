import { supabase } from './supabaseClient'

export async function getSupabaseAccessToken() {
  return supabase ? (await supabase.auth.getSession()).data.session?.access_token || '' : ''
}
