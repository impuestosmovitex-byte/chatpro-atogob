/**
 * MW1 commercial tiers — safe planning matrix, not runtime entitlements.
 *
 * Existing published/draft identifiers ('inicial', 'pro', 'empresa') and the
 * proposed commercial tiers ('basico', 'eco', 'pro') MUST NOT be conflated.
 * Until commercial approval, missing features are undefined rather than false.
 * No billing, migration or live tenant gating may depend on this draft.
 */
import {MW1_FEATURE_KEYS,type Mw1FeatureKey} from './mw1-feature-resolution';

export type CommercialTier='basico'|'eco'|'pro';
export type PlannedRight='included'|'not_included'|'pending';
export type TierDraft={
  tier:CommercialTier;
  label:string;
  maxUsers:number;
  maxConnections:number;
  rights:Record<Mw1FeatureKey,PlannedRight>;
  approved:false;
};

function pendingRights():Record<Mw1FeatureKey,PlannedRight>{
  return Object.fromEntries(MW1_FEATURE_KEYS.map(key=>[key,'pending'])) as Record<Mw1FeatureKey,PlannedRight>;
}

// The statuses below describe the current *proposal*, not deployed access.
// New connectors, native orders and merchant payments remain pending.
function plannedRights(tier:CommercialTier):Record<Mw1FeatureKey,PlannedRight>{
  const rights=pendingRights();
  rights.whatsapp='included';
  if(tier==='basico'){
    rights.ai_assistant='not_included';
    rights.instagram='not_included';
    rights.messenger='not_included';
    rights.automations='not_included';
  } else {
    rights.ai_assistant='included';
    rights.instagram='included';
    rights.messenger='included';
    rights.automations='included';
    rights.statistics='included';
  }
  return rights;
}

export const MW1_COMMERCIAL_TIER_DRAFTS:readonly TierDraft[]=[
  {tier:'basico',label:'Básico',maxUsers:2,maxConnections:1,rights:plannedRights('basico'),approved:false},
  {tier:'eco',label:'Eco',maxUsers:3,maxConnections:3,rights:plannedRights('eco'),approved:false},
  {tier:'pro',label:'Pro',maxUsers:3,maxConnections:5,rights:plannedRights('pro'),approved:false},
];

/** Only an explicitly reviewed mapping may be used for published entitlements. */
export function checkTierDraftReady(tier:TierDraft):{ready:boolean;pending:Mw1FeatureKey[]} {
  const pending=MW1_FEATURE_KEYS.filter(key=>tier.rights[key]==='pending');
  return {ready:pending.length===0,pending};
}
