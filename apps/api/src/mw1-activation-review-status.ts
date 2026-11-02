/** Pure internal review status. Never activates tenant entitlements. */
export type ReviewEvent={action:string;created_at:string};
export type ReviewStatus='not_requested'|'pending_review'|'rejected'|'approved_for_review';
export function reviewStatus(events:ReviewEvent[]):ReviewStatus{
 const latest=[...events].filter(e=>['activation_requested','activation_rejected','activation_review_approved'].includes(e.action))
   .sort((a,b)=>b.created_at.localeCompare(a.created_at))[0];
 if(!latest)return 'not_requested';
 if(latest.action==='activation_rejected')return 'rejected';
 if(latest.action==='activation_review_approved')return 'approved_for_review';
 return 'pending_review';
}
