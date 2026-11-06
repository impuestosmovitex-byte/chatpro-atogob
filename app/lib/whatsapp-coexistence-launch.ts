import type { WhatsappSignupMode } from './whatsapp-coexistence-completion.ts';

/**
 * Constructs the documented Meta Embedded Signup launch configuration for
 * an explicitly chosen onboarding mode. This helper is not wired into the
 * production or staging signup button. It does not call FB.login.
 *
 * Coexistence requires a separate readiness review of webhook ingestion,
 * history/contact consent, plan eligibility, and Meta app configuration.
 * This function alone must not be treated as authorization to launch.
 */
export function buildWhatsappSignupLaunchOptions(
  configurationId: string,
  mode: WhatsappSignupMode,
): Record<string, unknown> {
  if (typeof configurationId !== 'string' ||
      !/^[0-9]{6,30}$/.test(configurationId)) {
    throw new Error('Invalid Embedded Signup configuration');
  }
  if (mode !== 'cloud_api' && mode !== 'coexistence') {
    throw new Error('Unknown WhatsApp signup mode');
  }
  const extras = mode === 'coexistence'
    ? { setup: {}, featureType: 'whatsapp_business_app_onboarding', sessionInfoVersion: '3' }
    : {};
  return {
    config_id: configurationId,
    response_type: 'code',
    override_default_response_type: true,
    extras,
  };
}
