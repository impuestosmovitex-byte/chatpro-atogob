/**
 * Tenant-neutral safeguards for AI-created handoff summaries.
 *
 * These functions evaluate what the customer actually requested. They must
 * never contain product types, merchant names, catalog data, pricing, policy
 * decisions, or any tenant-specific configuration.
 */
export function normalizeCustomerExpression(value: string): string {
  return String(value || '')
    .toLowerCase()
    .normalize('NFD')
    .replace(/[\u0300-\u036f]/g, '')
    .replace(/\s+/g, ' ')
    .trim();
}

/**
 * A word like "asesor" in the AI's proposed reason is NOT evidence that the
 * customer asked to speak with an advisor.
 */
export function customerExplicitlyAskedForAdvisor(value: string): boolean {
  const text = normalizeCustomerExpression(value);
  if (!text) return false;
  if (
    /\b(?:no|nunca)\s+(?:quiero|necesito|deseo|busco)\b.{0,45}\b(?:asesor(?:a)?|agente humano|persona real)\b/.test(text) ||
    /\bno\s+(?:me\s+)?(?:pases|transfieras|comuniques)\b.{0,45}\b(?:asesor(?:a)?|agente|persona)\b/.test(text)
  ) return false;
  if (/^(?:asesor(?:a)?|humano|agente humano|persona real)[.!? ]*$/.test(text)) {
    return true;
  }
  return (
    /\b(?:quiero|deseo|necesito|prefiero|puedo|puedes|podria|podrias)\b.{0,70}\b(?:asesor(?:a)?|agente humano|persona real)\b/.test(text) ||
    /\b(?:hablar|comunicarme|pasame|pasenme|transfiereme|atenderme)\b.{0,60}\b(?:asesor(?:a)?|agente humano|persona real)\b/.test(text)
  );
}

/**
 * Colloquial buying expressions ("regálame el pedido así", "me regalas
 * dos unidades") are not an instruction to waive the purchase price.
 * An actual concession must be stated explicitly.
 */
export function customerExplicitlyAskedForFreeBenefit(value: string): boolean {
  const text = normalizeCustomerExpression(value);
  return (
    /\b(?:gratis|gratuit[oa]s?|sin costo|sin cobro|sin cobrar|sin pagar|de obsequio|a costo cero)\b/.test(text) ||
    /\b(?:me|nos)\s+(?:regalas|regalan|obsequias|obsequian)\s+(?:el|la|los|las)\s+(?:envio|domicilio|entrega|producto|productos|pedido)\b/.test(text) &&
      /\b(?:gratis|sin costo|sin cobrar|sin pagar|de obsequio)\b/.test(text)
  );
}

/**
 * Only reject an unsupported interpretation, not a request for human support
 * made by the customer. If insufficient evidence exists, give the agent a
 * chance to correct its handoff rationale; do not modify commercial state.
 */
export function handoffAssertsUnrequestedFreeBenefit(
  reason: string,
  summary: string,
  customerMessages: readonly string[],
): boolean {
  const modelClaim = normalizeCustomerExpression(
    [reason, summary].filter(Boolean).join(' '),
  );
  const assertsFreeConcession =
    /\b(?:sin costo|sin cobro|sin cobrar|sin pagar|gratis|gratuit[oa]s?|costo cero)\b/.test(modelClaim) ||
    /\b(?:solicitud|peticion|pedido)\s+(?:de|para)\s+(?:un\s+)?(?:regalo|obsequio)\s+(?:del|de|en)\s+(?:pedido|producto|compra)\b/.test(modelClaim) ||
    /\b(?:regalar|obsequiar)\s+(?:el|la|los|las)\s+(?:pedido|producto|productos|compra)\b/.test(modelClaim);
  if (!assertsFreeConcession) return false;

  return !customerMessages.some((message) =>
    customerExplicitlyAskedForFreeBenefit(message),
  );
}
