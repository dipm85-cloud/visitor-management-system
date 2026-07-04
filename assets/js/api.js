import { SUPABASE_URL, SUPABASE_ANON_KEY } from "./config.js";

export const supabaseClient = window.supabase.createClient(SUPABASE_URL, SUPABASE_ANON_KEY);

// Terminal registration is device-token based and must not inherit a staff
// session that is still loading, refreshing, or signing out.
export async function validateTerminalToken(token) {
  try {
    const response = await fetch(
      SUPABASE_URL.replace(/\/+$/, "") + "/rest/v1/rpc/validate_kiosk_device_token",
      {
        method: "POST",
        headers: {
          apikey: SUPABASE_ANON_KEY,
          Authorization: "Bearer " + SUPABASE_ANON_KEY,
          "Content-Type": "application/json"
        },
        body: JSON.stringify({ p_kiosk_token: token })
      }
    );
    const data = await response.json();

    if (!response.ok) {
      return {
        data: null,
        error: {
          message: data && data.message
            ? data.message
            : "Terminal token validation failed."
        }
      };
    }

    return { data, error: null };
  } catch (error) {
    return { data: null, error };
  }
}
