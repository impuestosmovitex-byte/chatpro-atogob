import { instagramSignatureFailureReason, instagramWebhookBusinessIds, StagingInstagramWebhookController } from './staging-instagram-webhook.controller';
import type { RawBodyRequest } from '@nestjs/common';
import type { Request } from 'express';
import { SupabaseService } from './supabase.service';
import { createHmac } from 'node:crypto';
import { validMetaSignature } from './staging-meta-signature';

describe('Instagram staging webhook tenant candidate selection', () => {
  const event = {
    object: 'instagram',
    entry: [{ id: '17841400000000123', messaging: [{
      sender: { id: '9876543210123456' },
      recipient: { id: '17841400000000123' },
      timestamp: 1700000000000,
      message: { mid: 'mid.test-1', text: 'Hola' },
    }] }],
  };

  it('extracts only the professional account, not the sender', () => {
    expect(instagramWebhookBusinessIds(event)).toEqual(['17841400000000123']);
  });

  it('rejects recipient mismatch rather than routing to a guessed tenant', () => {
    const mismatched = JSON.parse(JSON.stringify(event));
    mismatched.entry[0].messaging[0].recipient.id = '17841400000000999';
    expect(instagramWebhookBusinessIds(mismatched)).toEqual([]);
  });

  it('detects multiple account destinations to fail closed in the controller', () => {
    const second = JSON.parse(JSON.stringify(event.entry[0]));
    second.id = '17841400000000999';
    second.messaging[0].recipient.id = second.id;
    expect(instagramWebhookBusinessIds({object:'instagram', entry:[event.entry[0], second]}))
      .toEqual(['17841400000000123', '17841400000000999']);
  });

  it('rejects missing or malformed Instagram event payloads', () => {
    expect(instagramWebhookBusinessIds({object:'page',entry:event.entry})).toEqual([]);
    expect(instagramWebhookBusinessIds({object:'instagram',entry:'bad'})).toEqual([]);
    expect(instagramWebhookBusinessIds({object:'instagram',entry:[{id:'x',messaging:[]}]})).toEqual([]);
    expect(instagramWebhookBusinessIds({object:'instagram',entry:[{id:'17841400000000123'}]})).toEqual([]);
  });
});

describe('Instagram staging signature diagnostics fail closed', () => {
  const secret = 'staging-test-secret-at-least-sixteen-characters';
  const body = Buffer.from('{\"object\":\"instagram\"}');
  const signature = 'sha256=' + createHmac('sha256',secret).update(body).digest('hex');

  it('allows a correctly signed request', () => {
    expect(instagramSignatureFailureReason('true',body,signature,secret)).toBeNull();
  });
  it('classifies missing inputs without revealing credentials', () => {
    expect(instagramSignatureFailureReason('false',body,signature,secret)).toBe('STAGING_MODE_DISABLED');
    expect(instagramSignatureFailureReason('true',undefined,signature,secret)).toBe('RAW_BODY_MISSING');
    expect(instagramSignatureFailureReason('true',body,signature,undefined)).toBe('APP_SECRET_UNAVAILABLE');
    expect(instagramSignatureFailureReason('true',body,undefined,secret)).toBe('SIGNATURE_HEADER_MISSING');
    expect(instagramSignatureFailureReason('true',body,'sha1=bad',secret)).toBe('SIGNATURE_HEADER_MALFORMED');
  });
  it('classifies signature mismatch and never accepts an altered body', () => {
    expect(instagramSignatureFailureReason('true',Buffer.concat([body,Buffer.from(' ')]),signature,secret))
      .toBe('SIGNATURE_MISMATCH');
  });
});

describe('Instagram pilot signed webhook', () => {
  const secret = 'test-signature-secret-with-sufficient-entropy';
  const bytes = Buffer.from(JSON.stringify({
    object:'instagram',entry:[{id:'17841400000000123',
      messaging:[{sender:{id:'9876543210123456'},
        recipient:{id:'17841400000000123'},
        message:{mid:'mid.test-1',text:'Hola'}}]}],
  }));
  const signature = 'sha256=' + createHmac('sha256',secret).update(bytes).digest('hex');

  it('accepts a correctly signed body from Meta', () => {
    expect(validMetaSignature(bytes,signature,secret)).toBe(true);
  });

  it('rejects a modified body without an updated signature', () => {
    expect(validMetaSignature(Buffer.concat([bytes,Buffer.from(' ')]),signature,secret))
      .toBe(false);
  });

  it('rejects absent and malformed signatures', () => {
    expect(validMetaSignature(bytes,undefined,secret)).toBe(false);
    expect(validMetaSignature(bytes,'sha1=abc',secret)).toBe(false);
  });
});

describe('Instagram pilot webhook processing safety with mocked database', () => {
  const accountId = '17841400000000123';
  const companyId = '11111111-1111-4111-8111-111111111111';
  const integrationId = '22222222-2222-4222-8222-222222222222';
  const secret = 'pilot-webhook-test-secret-long-enough';
  const old = {
    mode: process.env.MW1_STAGING_MODE,
    receipt: process.env.MW1_STAGING_INSTAGRAM_RECEIVE_ENABLED,
    secret: process.env.META_INSTAGRAM_APP_SECRET,
  };

  beforeEach(() => {
    process.env.MW1_STAGING_MODE = 'true';
    process.env.MW1_STAGING_INSTAGRAM_RECEIVE_ENABLED = 'true';
    process.env.META_INSTAGRAM_APP_SECRET = secret;
  });

  afterAll(() => {
    if (old.mode === undefined) delete process.env.MW1_STAGING_MODE;
    else process.env.MW1_STAGING_MODE = old.mode;
    if (old.receipt === undefined) delete process.env.MW1_STAGING_INSTAGRAM_RECEIVE_ENABLED;
    else process.env.MW1_STAGING_INSTAGRAM_RECEIVE_ENABLED = old.receipt;
    if (old.secret === undefined) delete process.env.META_INSTAGRAM_APP_SECRET;
    else process.env.META_INSTAGRAM_APP_SECRET = old.secret;
  });

  function setup(payload: unknown, insertIds: Array<{id:string}> = [{id:'new-message'}]) {
    const body = Buffer.from(JSON.stringify(payload));
    const signature = 'sha256=' + createHmac('sha256',secret).update(body).digest('hex');
    const integration = {
      id: integrationId, company_id: companyId, status:'pending',
      config:{username:'chatpro_mw1',webhooks_subscribed:true},
    };
    const selectIntegration = jest.fn().mockReturnValue({
      eq: jest.fn().mockReturnThis(),
      limit: jest.fn().mockResolvedValue({data:[integration],error:null}),
    });
    const selectCompany = jest.fn().mockReturnValue({
      eq: jest.fn().mockReturnThis(),
      maybeSingle: jest.fn().mockResolvedValue({data:{slug:'piloto-mw1-prueba',status:'active'},error:null}),
    });
    const stored = jest.fn().mockResolvedValue({data:insertIds,error:null});
    const upsert = jest.fn().mockReturnValue({select:stored});
    const from = jest.fn((table:string) => {
      if(table === 'company_integrations') return {select:selectIntegration};
      if(table === 'companies') return {select:selectCompany};
      if(table === 'mw1_instagram_staging_inbox') return {upsert};
      throw Error('Unexpected table');
    });
    const controller = new StagingInstagramWebhookController({
      getClient: () => ({from}),
    } as unknown as SupabaseService);
    return {controller,request:{rawBody:body,body:payload} as unknown as RawBodyRequest<Request>,
      signature,from,upsert,stored};
  }

  const payload = {
    object:'instagram', entry:[{id:accountId,messaging:[{
      sender:{id:'9876543210123456'},recipient:{id:accountId},
      timestamp:1700000000000,message:{mid:'mid.test-1',text:'Hola desde la prueba'},
    }]}],
  };

  it('stores a valid signed text message in exactly the pilot tenant', async () => {
    const h=setup(payload);
    await expect(h.controller.receive(h.request,h.signature))
      .resolves.toEqual({ok:true,stored:1,duplicates:0});
    expect(h.upsert).toHaveBeenCalledWith(
      [expect.objectContaining({
        company_id:companyId,integration_id:integrationId,
        recipient_ig_id:accountId,provider_message_id:'mid.test-1',
        message_text:'Hola desde la prueba',
      })],
      {onConflict:'integration_id,provider_message_id',ignoreDuplicates:true},
    );
  });

  it('marks retransmissions as duplicates without claiming a new message', async () => {
    const h=setup(payload,[]);
    await expect(h.controller.receive(h.request,h.signature))
      .resolves.toEqual({ok:true,stored:0,duplicates:1});
  });

  it('rejects tampered signed payloads before any database access', async () => {
    const h=setup(payload);
    const altered={...h.request,rawBody:Buffer.concat([h.request.rawBody!,Buffer.from(' ')])};
    await expect(h.controller.receive(altered as unknown as RawBodyRequest<Request>,h.signature))
      .rejects.toMatchObject({status:403});
    expect(h.from).not.toHaveBeenCalled();
  });

  it('rejects multiple account recipients before accessing the database', async () => {
    const other=JSON.parse(JSON.stringify(payload));
    other.entry.push({...other.entry[0],id:'17841400000000999',messaging:[{
      ...other.entry[0].messaging[0],
      recipient:{id:'17841400000000999'},
    }]});
    const h=setup(other);
    await expect(h.controller.receive(h.request,h.signature))
      .rejects.toMatchObject({status:403});
    expect(h.from).not.toHaveBeenCalled();
  });

  it('does not store messages while receiving is disabled', async () => {
    process.env.MW1_STAGING_INSTAGRAM_RECEIVE_ENABLED = 'false';
    const h=setup(payload);
    await expect(h.controller.receive(h.request,h.signature))
      .rejects.toMatchObject({status:503});
    expect(h.upsert).not.toHaveBeenCalled();
  });
});
