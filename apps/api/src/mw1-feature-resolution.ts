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


// Commercial plan names are not yet standardized: current plan drafts use
// Inicial/Pro/Empresa while product planning anticipates Basico/Eco/Pro.
// For that reason do NOT infer rights from a plan name. Read the actual
// per-tenant entitlement booleans instead, and leave new modules pending.
export type Mw1EntitlementSnapshot = {
  ai_enabled?: boolean | null;
  whatsapp_enabled?: boolean | null;
  instagram_enabled?: boolean | null;
  messenger_enabled?: boolean | null;
  automations_enabled?: boolean | null;
  statistics_enabled?: boolean | null;
  native_orders_enabled?: boolean | null;
};

export function planAllowsMw1Feature(
  feature: Mw1FeatureKey,
  rights: Mw1EntitlementSnapshot,
): boolean | null {
  const fields: Partial<Record<Mw1FeatureKey, keyof Mw1EntitlementSnapshot>> = {
    ai_assistant: 'ai_enabled',
    whatsapp: 'whatsapp_enabled',
    instagram: 'instagram_enabled',
    messenger: 'messenger_enabled',
    automations: 'automations_enabled',
    statistics: 'statistics_enabled',
    native_orders: 'native_orders_enabled',
  };
  const field = fields[feature];
  if (!field) return null; // Not yet defined in the commercial plan schema.
  const value = rights[field];
  return typeof value === 'boolean' ? value : null;
}

export type Mw1FeaturePreview = Mw1FeatureDecision | {
  featureKey: Mw1FeatureKey;
  entitled: null;
  chosen: boolean;
  effective: false;
  reason: 'entitlement_not_configured';
};

export function previewMw1Feature(
  feature: Mw1FeatureKey,
  rights: Mw1EntitlementSnapshot,
  preference?: boolean | null,
): Mw1FeaturePreview {
  const entitlement = planAllowsMw1Feature(feature, rights);
  if (entitlement === null) {
    return {featureKey:feature,entitled:null,chosen:preference!==false,
      effective:false,reason:'entitlement_not_configured'};
  }
  return resolveMw1Feature(feature, entitlement, preference);
}
