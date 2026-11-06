/**
 * MW1 plan activation guardrail.
 * Purely evaluates prerequisites. It cannot activate anything.
 * Production integrations and pilot exemptions are NEVER inferred by name.
 */
export type ActivationInput={
 proposedTier:'basico'|'eco'|'pro'|null;
 approvedCurrentVersion:boolean;
 explicitPilotExemption:boolean;
 existingIntegrationsPreserved:boolean;
 billingValidated:boolean;
 adminConfirmed:boolean;
};
export function assessPlanActivation(input:ActivationInput){
 const blockers:string[]=[];
 if(!input.proposedTier)blockers.push('No existe plan propuesto.');
 if(!input.approvedCurrentVersion)blockers.push('La matriz comercial no está aprobada o vigente.');
 if(!input.existingIntegrationsPreserved)blockers.push('No se ha verificado la conservación de integraciones existentes.');
 if(!input.billingValidated&&!input.explicitPilotExemption)
  blockers.push('Falta validar facturación o excepción explícita de piloto.');
 if(!input.adminConfirmed)blockers.push('Falta confirmación expresa del superadministrador.');
 return {readyForReview:blockers.length===0,canApply:false as const,blockers};
}
