// MW1: pure, side-effect-free feature resolution.
// Plan entitlement and optional company preference are separate dimensions.
// No tenant, integration or subscription can be mutated by this module.
export const MW1_FEATURE_KEYS = [
  'ai_assistant','whatsapp','instagram','messenger','automations',
  'catalog_pdf','native_orders','merchant_payments','statistics',
] as const;

export type Mw1FeatureKey = typeof MW1_FEATURE_KEYS[number];

export type Mw1FeatureDecision = {
  featureKey: Mw1FeatureKey;
  entitled: boolean;
  chosen: boolean;
  effective: boolean;
  reason: 'not_in_plan' | 'company_opted_out' | 'available';
};

// A missing preference preserves legacy behavior, preventing upgrades from
// silently switching off currently working ATOGOB/MAOGO integrations.
// Unavailable features stay disabled regardless of user preferences.
export function resolveMw1Feature(
  featureKey: Mw1FeatureKey,
  entitled: boolean,
  preference?: boolean | null,
): Mw1FeatureDecision {
  const chosen = preference !== false;
  return {
    featureKey,
    entitled,
    chosen,
    effective: entitled && chosen,
    reason: !entitled ? 'not_in_plan' :
      !chosen ? 'company_opted_out' : 'available',
  };
}

// These two legacy pilot tenants must never be denied solely because their
// subscription or payment method has not been configured. Use an explicit
// ID-based, audited pilot exemption at the eventual billing enforcement layer;
// do not encode company names, IDs or secrets in the client.
export function billingGateAllowsAccess(
  subscriptionActive: boolean,
  explicitPilotExemption: boolean,
): boolean {
  return subscriptionActive || explicitPilotExemption;
}
