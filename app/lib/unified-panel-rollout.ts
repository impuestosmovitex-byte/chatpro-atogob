// Fail closed: without an explicit per-company flag, all tenants keep their CRM.
const ELIGIBLE = new Set(['atogob', 'emprende-con-maogo']);
export function isUnifiedPanelEnabled(slug: string): boolean {
  const company = slug.trim().toLowerCase();
  if (!ELIGIBLE.has(company)) return false;
  return (process.env.MW1_UNIFIED_PANEL_COMPANIES ?? '')
    .split(',')
    .some(value => value.trim().toLowerCase() === company);
}
