import { canSafelyAutoCloseUnansweredCustomer, qualifiesForStaleAiReview, pickStaleReviewAction } from './stale-human-ai-rules';
describe('24h neglected customer review rules', () => {
 const cutoff = '2026-11-20T12:00:00Z';
 it('reviews only customer-last older than 24h', () => {
   expect(qualifiesForStaleAiReview({author_type:'customer', created_at:'2026-11-19T10:00:00Z'}, cutoff)).toBe(true);
   expect(qualifiesForStaleAiReview({author_type:'advisor', created_at:'2026-11-19T10:00:00Z'}, cutoff)).toBe(false);
   expect(qualifiesForStaleAiReview({author_type:'customer', created_at:'2026-11-20T13:00:00Z'}, cutoff)).toBe(false);
 });
 it('never closes requests or uncertain customer messages', () => {
   for(const text of ['Dónde está mi pedido','Necesito cambio','Quiero hablar con un asesor','No me ha llegado','gracias, pero falta mi pedido']) {
     expect(canSafelyAutoCloseUnansweredCustomer({author_type:'customer',message:text})).toBe(false);
     expect(pickStaleReviewAction('close','high',{author_type:'customer',message:text})).toBe('waiting');
   }
 });
 it('closes only high-confidence resolved acknowledgements', () => {
   expect(pickStaleReviewAction('close','high',{author_type:'customer',message:'Muchas gracias!'})).toBe('closed');
   expect(pickStaleReviewAction('close','medium',{author_type:'customer',message:'Gracias'})).toBe('waiting');
 });
 it('routes reply readiness to AI without sending a prohibited outbound message', () => {
   expect(pickStaleReviewAction('reply','high',{author_type:'customer',message:'Ayúdame con la talla'})).toBe('ai');
   expect(pickStaleReviewAction('reply','medium',{author_type:'customer',message:'Ayúdame con la talla'})).toBe('waiting');
   expect(pickStaleReviewAction('transfer','high',{author_type:'customer',message:'Reclamo'})).toBe('waiting');
 });
});
