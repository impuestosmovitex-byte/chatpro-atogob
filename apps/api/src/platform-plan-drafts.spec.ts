import {emptyPlanDraft,PLAN_KEYS,validatePlanDraft} from './platform-plan-drafts';

describe('MW1 staging commercial plans are proposals, never billing',()=>{
  const proposal=()=>{
    const p=emptyPlanDraft('pro');
    return {...p,priceCop:79000,maxUsers:3,maxWhatsappLines:1,
      whatsappEnabled:true,aiEnabled:true,reviewStatus:'ready_for_review' as const};
  };
  test('three plans exist without inventing public prices or users',()=>{
    expect(PLAN_KEYS).toEqual(['inicial','pro','empresa']);
    for(const key of PLAN_KEYS){
      const p=emptyPlanDraft(key);
      expect(p.priceCop).toBeNull();
      expect(p.maxUsers).toBeNull();
      expect(p.reviewStatus).toBe('draft');
    }
  });
  test('can save draft without pricing or granting features',()=>{
    const draft=validatePlanDraft(emptyPlanDraft('inicial'));
    expect(draft.priceCop).toBeNull();
    expect(draft.aiEnabled).toBe(false);
  });
  test('can mark complete internal proposal as ready for review',()=>{
    expect(validatePlanDraft(proposal())).toMatchObject({
      priceCop:79000,reviewStatus:'ready_for_review',
    });
  });
  test('cannot falsely publish or activate a subscription through plan config',()=>{
    expect(()=>validatePlanDraft({...proposal(),reviewStatus:'published'})).toThrow();
    expect(()=>validatePlanDraft({...proposal(),paymentVerified:true})).toThrow();
    expect(()=>validatePlanDraft({...proposal(),companyId:'cross-tenant'})).toThrow();
    expect(()=>validatePlanDraft({...proposal(),planKey:'unlimited'})).toThrow();
  });
  test('drafts with no pricing cannot be sent for review',()=>{
    expect(()=>validatePlanDraft({...proposal(),priceCop:null})).toThrow(/precio/);
    expect(()=>validatePlanDraft({...proposal(),maxUsers:null})).toThrow(/usuarios/);
    expect(()=>validatePlanDraft({...proposal(),maxWhatsappLines:null})).toThrow(/líneas/);
  });
  test('does not allow decimal, negative or unreasonable billing numbers',()=>{
    for(const priceCop of [-1,0,1.5,1e10,'79000',Number.NaN]){
      expect(()=>validatePlanDraft({...proposal(),priceCop})).toThrow(/priceCop/);
    }
    expect(()=>validatePlanDraft({...proposal(),maxUsers:0})).toThrow();
    expect(()=>validatePlanDraft({...proposal(),maxWhatsappLines:1001})).toThrow();
  });
  test('rejects nonboolean capabilities',()=>{
    expect(()=>validatePlanDraft({...proposal(),aiEnabled:'true'})).toThrow(/marcarse/);
  });
  test('add-on prices can be set independently and zero is allowed',()=>{
    const draft=validatePlanDraft({...proposal(),extraUserCop:32000,extraConnectionCop:0});
    expect(draft.extraUserCop).toBe(32000);
    expect(draft.extraConnectionCop).toBe(0);
  });
  test('rejects invalid add-on prices',()=>{
    for(const extraUserCop of [-1,1.3,'32000',Number.NaN,1000000000]){
      expect(()=>validatePlanDraft({...proposal(),extraUserCop})).toThrow(/extraUserCop/);
    }
    for(const extraConnectionCop of [-1,0.5,'50000']){
      expect(()=>validatePlanDraft({...proposal(),extraConnectionCop})).toThrow(/extraConnectionCop/);
    }
  });
  test('validates plan public benefits and AI monthly budget',()=>{
    const valid=validatePlanDraft({...proposal(),aiMonthlyBudgetCop:10000,publicSummary:'Atención comercial',publicFeatures:['CRM','Soporte']});
    expect(valid.publicFeatures).toEqual(['CRM','Soporte']);
    expect(()=>validatePlanDraft({...proposal(),aiMonthlyBudgetCop:-1})).toThrow(/IA/);
    expect(()=>validatePlanDraft({...proposal(),publicFeatures:['x'.repeat(151)]})).toThrow(/Beneficios/);
    expect(()=>validatePlanDraft({...proposal(),publicSummary:'x'.repeat(301)})).toThrow(/Resumen/);
  });
  test('rejects oversized plan notes',()=>{
    expect(()=>validatePlanDraft({...proposal(),notes:'x'.repeat(1401)})).toThrow();
  });
});
