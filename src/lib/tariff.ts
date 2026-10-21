/**
 * Electricity rate used for peso estimates on the admin website.
 *
 * The database has no rate yet (landlords will enter their own from the Meralco bill).
 * Every peso figure on the site goes through this file, so when a real rate exists
 * only getTariff() changes: it can later read a table or an RPC instead of the constant.
 */
export const DEFAULT_TARIFF_PHP_PER_KWH = 8.5;

export type Tariff = { rate: number; source: "default" | "database" };

export function getTariff(): Tariff {
  return { rate: DEFAULT_TARIFF_PHP_PER_KWH, source: "default" };
}

/** Estimated cost in pesos for a kWh amount. */
export const estimateCost = (kwh: number, tariff: Tariff = getTariff()) => kwh * tariff.rate;

/** Short note shown beside peso figures, e.g. "Estimated at ₱8.50/kWh". */
export const tariffNote = (tariff: Tariff = getTariff()) =>
  `Estimated at ₱${tariff.rate.toFixed(2)}/kWh`;