import { supabaseClient } from "./api.js";
import { AppState } from "./state.js";
import { $ } from "./dom.js";
import { clearMessage, showMessage } from "./messages.js";
import { writeAuditEvent } from "./audit.js";
import { safe } from "./utils.js";

function maskToken(token) {
  if (!token) return "-";
  const text = String(token);
  if (text.length <= 8) return "********";
  return "************" + text.slice(-6);
}

function kioskConnectionStatus(device) {
  if (!device.active) return { label: "Disabled", className: "muted", icon: "⚫" };
  if (!device.last_seen_at) return { label: "Never connected", className: "muted", icon: "⚪" };

  const minutes = (Date.now() - new Date(device.last_seen_at).getTime()) / 60000;

  if (minutes <= 10) return { label: "Online", className: "success", icon: "🟢" };
  if (minutes <= 1440) return { label: "Idle", className: "warning", icon: "🟡" };
  return { label: "Offline", className: "danger", icon: "🔴" };
}

function formatDeviceDate(value) {
  return value ? new Date(value).toLocaleString() : "-";
}

export async function loadKioskDevices() {
  const box = $("kioskDevicesList");
  if (!box) return;

  box.innerHTML = "Loading kiosk devices...";

  try {
    const result = await supabaseClient.rpc("superuser_list_kiosk_devices");

    if (result.error) {
      box.innerHTML = "Could not load kiosk devices: " + safe(result.error.message);
      showMessage("Could not load kiosk devices: " + result.error.message, "error");
      console.error(result.error);
      return;
    }

    const data = result.data || [];

    if (data.length === 0) {
      box.innerHTML = "<div class='row-meta'>No kiosk devices registered.</div>";
      return;
    }

    box.innerHTML = "";

    data.forEach(device => {
      const health = kioskConnectionStatus(device);

      const row = document.createElement("div");
      row.className = "row";

      row.innerHTML =
        "<div class='row-title'>" + safe(device.device_name) + "</div>" +
        "<div class='row-meta'>" +
        "<strong>Device status:</strong> " + (device.active ? "🟢 Active" : "⚫ Disabled") + "<br>" +
        "<strong>Connection:</strong> " + health.icon + " " + safe(health.label) + "<br>" +
        "<strong>Location:</strong> " + safe(device.location_name) + "<br>" +
        "<strong>Description:</strong> " + safe(device.description) + "<br>" +
        "<strong>Last seen:</strong> " + safe(formatDeviceDate(device.last_seen_at)) + "<br>" +
        "<strong>Last visitor activity:</strong> " + safe(formatDeviceDate(device.last_used_at)) + "<br>" +
        "<strong>Last heartbeat reason:</strong> " + safe(device.last_heartbeat_reason || "-") + "<br>" +
        "<strong>App version:</strong> " + safe(device.last_app_version || "-") + "<br>" +
        "<strong>Screen:</strong> " + safe(device.last_screen || "-") + "<br>" +
        "<strong>Browser:</strong> " + safe(device.last_browser || "-") + "<br>" +
        "<strong>Total transactions:</strong> " + safe(device.total_transactions || 0) + "<br>" +
        "<strong>Force logout:</strong> " + (device.force_logout ? "Yes" : "No") + "<br>" +
        "<strong>Token:</strong> <code style='word-break:break-word;'>" + safe(device.kiosk_token) + "</code>" +
        "</div>";

      const actions = document.createElement("div");
      actions.className = "button-row";

      const regen = document.createElement("button");
      regen.textContent = "Regenerate Token";
      regen.type = "button";
      regen.className = "secondary";
      regen.addEventListener("click", () => regenerateKioskToken(device.id));
      actions.appendChild(regen);

      const toggle = document.createElement("button");
      toggle.textContent = device.active ? "Disable" : "Enable";
      toggle.type = "button";
      toggle.className = device.active ? "danger" : "secondary";
      toggle.addEventListener("click", () => setKioskDeviceStatus(device.id, !device.active));
      actions.appendChild(toggle);

      const delDevice = document.createElement("button");
      delDevice.textContent = "Delete Device";
      delDevice.type = "button";
      delDevice.className = "danger";
      delDevice.addEventListener("click", () => deleteKioskDevice(device.id, device.device_name));
      actions.appendChild(delDevice);

      row.appendChild(actions);
      box.appendChild(row);
    });
  } catch (err) {
    box.innerHTML = "Could not load kiosk devices: " + safe(err.message || String(err));
    showMessage("Could not load kiosk devices. See registered devices card.", "error");
    console.error("loadKioskDevices failed:", err);
  }
}

export async function deleteKioskDevice(deviceId, deviceName) {
  clearMessage();

  if (!confirm("Permanently delete kiosk device '" + safe(deviceName) + "'? This cannot be undone.")) return;

  const result = await supabaseClient.rpc("superuser_delete_kiosk_device", {
    p_device_id: deviceId
  });

  if (result.error) {
    showMessage("Could not delete kiosk device: " + result.error.message, "error");
    console.error(result.error);
    return;
  }

  await writeAuditEvent("kiosk_device_deleted", "kiosk_devices", deviceId, {
    action: "delete",
    before: { device_name: deviceName },
    summary: "Kiosk device deleted."
  });
  showMessage("Kiosk device deleted.", "success");
  await loadKioskDevices();
}

export async function createKioskDevice() {
  clearMessage();

  if (!AppState.currentProfile || AppState.currentProfile.role !== "super_user") {
    showMessage("Only Super Users can create kiosk devices.", "error");
    return;
  }

  const name = $("kioskDeviceName").value.trim();
  const location = $("kioskLocationName").value.trim();
  const description = $("kioskDescription").value.trim();

  if (!name) {
    showMessage("Device name is required.", "error");
    return;
  }

  $("newKioskTokenBox").textContent = "Creating kiosk device...";

  const result = await supabaseClient.rpc("superuser_create_kiosk_device", {
    p_device_name: name,
    p_location_name: location,
    p_description: description
  });

  if (result.error) {
    $("newKioskTokenBox").textContent = "Could not create kiosk device: " + result.error.message;
    showMessage("Could not create kiosk device: " + result.error.message, "error");
    console.error(result.error);
    return;
  }

  const token = result.data;

  $("newKioskTokenBox").innerHTML =
    "<strong>New token generated. Copy it now:</strong><br>" +
    "<code style='word-break:break-all;'>" + safe(token) + "</code>";

  $("kioskDeviceName").value = "";
  $("kioskLocationName").value = "";
  $("kioskDescription").value = "";

  await writeAuditEvent("kiosk_device_created", "kiosk_devices", null, {
    action: "create",
    after: { device_name: name, location_name: location, description: description, active: true },
    summary: "Kiosk device created."
  });
  showMessage("Kiosk device created. Copy the token into the tablet.", "success");
  await loadKioskDevices();
}

export async function regenerateKioskToken(deviceId) {
  clearMessage();

  if (!confirm("Regenerate this kiosk token? The old token will stop working immediately.")) return;

  const result = await supabaseClient.rpc("superuser_regenerate_kiosk_token", {
    p_device_id: deviceId
  });

  if (result.error) {
    showMessage("Could not regenerate token: " + result.error.message, "error");
    console.error(result.error);
    return;
  }

  alert("New token. Copy it now:\\n\\n" + result.data);
  await writeAuditEvent("kiosk_token_regenerated", "kiosk_devices", deviceId, {
    action: "regenerate_token",
    summary: "Kiosk token regenerated."
  });
  showMessage("Kiosk token regenerated.", "success");
  await loadKioskDevices();
}

export async function setKioskDeviceStatus(deviceId, active) {
  clearMessage();

  const reason = active ? "" : prompt("Reason for disabling this device:", "Disabled by SuperUser") || "";

  const result = await supabaseClient.rpc("superuser_set_kiosk_status", {
    p_device_id: deviceId,
    p_active: active,
    p_reason: reason
  });

  if (result.error) {
    showMessage("Could not update kiosk status: " + result.error.message, "error");
    console.error(result.error);
    return;
  }

  await writeAuditEvent("kiosk_device_status_changed", "kiosk_devices", deviceId, {
    action: "set_status",
    changes: { active: { old: !active, new: active } },
    reason: reason,
    summary: "Kiosk device status changed."
  });
  showMessage("Kiosk device status updated.", "success");
  await loadKioskDevices();
}
