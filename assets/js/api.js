import { SUPABASE_URL, SUPABASE_ANON_KEY } from "./config.js";

export const supabaseClient = window.supabase.createClient(SUPABASE_URL, SUPABASE_ANON_KEY);

export async function callAnonymousTerminalRpc(functionName, parameters, fallbackError) {
  try {
    const response = await fetch(
      SUPABASE_URL.replace(/\/+$/, "") + "/rest/v1/rpc/" + functionName,
      {
        method: "POST",
        headers: {
          apikey: SUPABASE_ANON_KEY,
          Authorization: "Bearer " + SUPABASE_ANON_KEY,
          "Content-Type": "application/json"
        },
        body: JSON.stringify(parameters)
      }
    );
    const responseBody = await response.text();
    let data = null;
    if (responseBody) {
      try {
        data = JSON.parse(responseBody);
      } catch (parseError) {
        return {
          data: null,
          error: {
            message: fallbackError,
            cause: parseError
          }
        };
      }
    }

    if (!response.ok) {
      return {
        data: null,
        error: {
          message: data && data.message
            ? data.message
            : fallbackError
        }
      };
    }

    return { data, error: null };
  } catch (error) {
    return { data: null, error };
  }
}

// Terminal registration is device-token based and must not inherit a staff
// session that is still loading, refreshing, or signing out.
export function validateTerminalToken(token) {
  return callAnonymousTerminalRpc(
    "validate_kiosk_device_token",
    { p_kiosk_token: token },
    "Terminal token validation failed."
  );
}

// Called only while the explicit startup debug flag is enabled. The RPC
// returns lengths and row counts, never the token itself.
export function diagnoseTerminalToken(token) {
  return callAnonymousTerminalRpc(
    "diagnose_kiosk_device_token",
    { p_kiosk_token: token },
    "Terminal token SQL diagnostic failed."
  );
}
