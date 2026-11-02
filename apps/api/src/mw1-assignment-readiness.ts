// Read-only preflight for a proposed MW1 company plan assignment.
// This is never permission to modify subscriptions, integrations or entitlements.
export type ProposedAssignment={tier:string}|null;
export type ApprovedMatrix={draft_updated_at:string}|null;
export type CurrentMatrix={updated_at:string}|null;
export function evaluateAssignmentReadiness(
 assignment:ProposedAssignment, approval:ApprovedMatrix, draft:CurrentMatrix,
):{commerciallyReady:boolean;canApply:false;reasons:string[]}{
 const reasons:string[]=[];
 if(!assignment)reasons.push('La empresa no tiene un plan propuesto.');
 else if(!approval)reasons.push('El plan todavía no tiene aprobación comercial.');
 else if(!draft||draft.updated_at!==approval.draft_updated_at)
  reasons.push('La aprobación no corresponde a la versión actual del plan.');
 return {commerciallyReady:reasons.length===0,canApply:false,reasons};
}
