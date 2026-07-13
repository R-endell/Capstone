import { createClient } from '@supabase/supabase-js';
import AsyncStorage from '@react-native-async-storage/async-storage';

const supabaseUrl = 'https://ellqwkalvvedtyivdozd.supabase.co';
const supabaseAnonKey = 'sb_publishable_RmrQfn5HYvGIjVcywzAg6w_p_JNewt8';

export const supabase = createClient(supabaseUrl, supabaseAnonKey, {
  auth: {
    storage: AsyncStorage,
    autoRefreshToken: true,
    persistSession: true,
    detectSessionInUrl: false,
  },
});