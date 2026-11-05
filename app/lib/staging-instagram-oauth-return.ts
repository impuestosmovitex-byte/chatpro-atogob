/**
 * Validate the Meta OAuth callback query in the isolated Instagram staging pilot.
 * Treat ambiguous provider responses as denied, without reflecting a token or
 * provider-controlled error description into a redirect.
 */
export type StagingInstagramOAuthReturn =
  | { ok: true; code: string; state: string }
  | { ok: false; reason: 'provider_error' | 'missing_code' | 'invalid_parameters' };

export function parseStagingInstagramOAuthReturn(
  parameters: URLSearchParams,
): StagingInstagramOAuthReturn {
  const codes = parameters.getAll('code');
  const states = parameters.getAll('state');
  const errors = parameters.getAll('error');
  const descriptions = parameters.getAll('error_description');

  // The signed state has already been checked against the session and cookie
  // in the callback route. A duplicate parameter can make different layers
  // interpret different values, so deny the entire callback.
  if (
    codes.length > 1 ||
    states.length !== 1 ||
    errors.length > 1 ||
    descriptions.length > 1 ||
    !states[0] ||
    states[0].length > 2048 ||
    (codes.length > 0 && errors.length > 0) ||
    (descriptions.length > 0 && errors.length === 0)
  ) {
    return { ok: false, reason: 'invalid_parameters' };
  }

  if (errors.length > 0) {
    return { ok: false, reason: 'provider_error' };
  }

  if (codes.length === 0) {
    return { ok: false, reason: 'missing_code' };
  }

  const code = codes[0];
  if (!code || !code.trim() || code.length > 4096) {
    return { ok: false, reason: 'invalid_parameters' };
  }

  return { ok: true, code, state: states[0] };
}
