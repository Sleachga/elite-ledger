/**
 * The wire shapes of `/api/admin/settings`, shared by the route and the admin
 * page. Browser-safe: type imports only, so the db module never reaches the
 * client bundle.
 */
import type { Settings, SettingsInfo, SettingsPatch } from "./index";

export const ADMIN_SETTINGS_ENDPOINT = "/api/admin/settings";
export const ADMIN_PASSCODE_HEADER = "x-admin-passcode";

export type AdminErrorKind =
  | "unauthorized"
  | "disabled"
  | "too_many_requests"
  | "bad_request"
  | "database";

export interface AdminErrorBody {
  error: { kind: AdminErrorKind; message: string };
}

/** `GET` and a successful `PUT` answer with the settings as they now are. */
export interface AdminSettingsBody {
  settings: Settings;
  /** ISO timestamp + name of the most recent change; null while nothing was ever saved. */
  lastChange: { at: string; by: string | null } | null;
}

export interface AdminSettingsUpdate {
  patch: SettingsPatch;
  /** Who is saving. Required; free text until Discord auth exists. */
  updatedBy: string;
}

export function toAdminSettingsBody(info: SettingsInfo): AdminSettingsBody {
  return {
    settings: info.settings,
    lastChange: info.lastChange ? { at: info.lastChange.at.toISOString(), by: info.lastChange.by } : null,
  };
}
