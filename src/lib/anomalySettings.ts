import { supabase } from "./supabase";

/** One row in public.kw_anomaly_settings (migration 012). */
export type AnomalySettings = {
  surge_pct: number;
  surge_min_watts: number;
  sag_floor_v: number;
  overvoltage_v: number;
  offline_after_min: number;
  flag_zero_usage: boolean;
  zero_usage_hours: number;
  flag_reverse_energy: boolean;
  critical_rule: string;
  warning_rule: string;
  resolve_rule: string;
  notify_landlord: boolean;
  group_repeat_flags: boolean;
  escalate_after_hours: number;
  updated_at: string;
  updated_by: string | null;
};

export type AnomalyPatch = Partial<Omit<AnomalySettings, "updated_at" | "updated_by">>;

/** Same ranges as the CHECK constraints in 012, so the form can warn before the database does. */
export const ANOMALY_RANGES = {
  surge_pct: [10, 500],
  surge_min_watts: [1, 5000],
  sag_floor_v: [120, 229],
  overvoltage_v: [231, 300],
  offline_after_min: [1, 60],
  zero_usage_hours: [1, 720],
  escalate_after_hours: [1, 720],
} as const;

export const anomalySettingsKey = ["anomaly-settings"] as const;

export async function getAnomalySettings(): Promise<AnomalySettings> {
  const { data, error } = await supabase.rpc("admin_get_anomaly_settings");
  if (error) throw new Error(error.message);
  return data as AnomalySettings;
}

/** Send only the keys that changed. */
export async function saveAnomalySettings(patch: AnomalyPatch): Promise<AnomalySettings> {
  const { data, error } = await supabase.rpc("admin_set_anomaly_settings", { p: patch });
  if (error) {
    if (error.message.includes("invalid_setting")) throw new Error("One of the values is out of range.");
    if (error.message.includes("not_authorized")) throw new Error("Only admins can change these settings.");
    throw new Error(error.message);
  }
  return data as AnomalySettings;
}