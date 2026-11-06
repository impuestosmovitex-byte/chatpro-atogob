import { ForbiddenException } from '@nestjs/common';
import type { MessengerNonceRequest } from './staging-messenger-oauth-authorized-nonce.service';
import type { StagingMessengerOAuthAuthorizedNonceService } from './staging-messenger-oauth-authorized-nonce.service';
import { messengerStateHashIfValid } from './staging-messenger-oauth-signed-state';

/**
 * INTERNAL ONLY: signed state + fresh membership + atomic one-time nonce.
 * Deliberately not injected into AppModule or connected to any route.
 * Does NOT contact Meta, exchange codes, store tokens or activate webhooks.
 * A future reviewed server callback must authenticate the session and supply
 * expectedCookieState from its HttpOnly secure cookie, not from request JSON.
 */
export class StagingMessengerOAuthVerifiedFlow {
  constructor(private readonly guard: Pick<
    StagingMessengerOAuthAuthorizedNonceService, 'register' | 'consume'
  >) {}

  private hash(request: MessengerNonceRequest, state: string, cookie?: string) {
    const nonceHash = messengerStateHashIfValid(state, {
      companyId: request?.companyId,
      userId: request?.userId,
      companySlug: request?.companySlug,
    }, cookie);
    if (!nonceHash) {
      throw new ForbiddenException('El estado OAuth de Messenger es inválido o venció.');
    }
    return nonceHash;
  }

  async registerSignedState(
    request: MessengerNonceRequest,
    signedState: string,
  ): Promise<void> {
    const hash = this.hash(request, signedState);
    await this.guard.register(request, hash);
  }

  async consumeSignedState(
    request: MessengerNonceRequest,
    signedState: string,
    expectedCookieState: string,
  ): Promise<void> {
    const hash = this.hash(request, signedState, expectedCookieState);
    await this.guard.consume(request, hash);
  }
}
