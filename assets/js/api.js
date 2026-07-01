import { SUPABASE_URL, SUPABASE_ANON_KEY } from "./config.js";

export const supabaseClient = window.supabase.createClient(SUPABASE_URL, SUPABASE_ANON_KEY);
