import { Test } from '@nestjs/testing';
import { INestApplication } from '@nestjs/common';
import request from 'supertest';
import { MediaLabModule } from './media-lab.module';

describe('isolated MW1 media lab read-only HTTP routes', () => {
  let app: INestApplication;
  const secret = 'synthetic-only-lab-secret-32-bytes-minimum';
  const oldSecret = process.env.MW1_MEDIA_LAB_AUTH_SECRET;
  const oldTenant = process.env.MW1_MEDIA_LAB_DATASET_ID;
  const originalFetch = global.fetch;

  beforeAll(async () => {
    process.env.MW1_MEDIA_LAB_AUTH_SECRET = secret;
    process.env.MW1_MEDIA_LAB_DATASET_ID = 'qa-synthetic-one';
    // A test must never make external network requests.
    global.fetch = jest.fn(async () => { throw new Error('Network not allowed'); }) as typeof fetch;
    const module = await Test.createTestingModule({
      imports: [MediaLabModule],
    }).compile();
    app = module.createNestApplication();
    await app.init();
  });

  afterAll(async () => {
    await app?.close();
    global.fetch = originalFetch;
    if (oldSecret === undefined) delete process.env.MW1_MEDIA_LAB_AUTH_SECRET;
    else process.env.MW1_MEDIA_LAB_AUTH_SECRET = oldSecret;
    if (oldTenant === undefined) delete process.env.MW1_MEDIA_LAB_DATASET_ID;
    else process.env.MW1_MEDIA_LAB_DATASET_ID = oldTenant;
  });

  const validHeaders = {
    Authorization: 'Bearer ' + secret,
    'x-mw1-lab-tenant': 'qa-synthetic-one',
  };

  it('has a synthetic-only health route', async () => {
    const result = await request(app.getHttpServer()).get('/health');
    expect(result.status).toBe(200);
    expect(result.body).toMatchObject({ syntheticOnly: true });
  });

  it('serves static synthetic bytes only with a valid lab token and tenant', async () => {
    const result = await request(app.getHttpServer())
      .get('/lab/media/synthetic-image').set(validHeaders);
    expect(result.status).toBe(200);
    expect(result.headers['cache-control']).toBe('no-store');
    expect(result.headers['content-type']).toMatch(/^image\/png/);
    expect(Buffer.isBuffer(result.body)).toBe(true);
    expect(result.body.length).toBeGreaterThan(10);
  });

  it('rejects calls without token', async () => {
    const result = await request(app.getHttpServer())
      .get('/lab/media/synthetic-document').set('x-mw1-lab-tenant', 'qa-synthetic-one');
    expect(result.status).toBe(401);
  });

  it('rejects foreign tenant even with a valid token', async () => {
    const result = await request(app.getHttpServer())
      .get('/lab/media/synthetic-document')
      .set({ ...validHeaders, 'x-mw1-lab-tenant': 'qa-foreign' });
    expect(result.status).toBe(401);
  });

  it('rejects nonexistent fixture IDs', async () => {
    const result = await request(app.getHttpServer())
      .get('/lab/media/customer-actual-image').set(validHeaders);
    expect(result.status).toBe(404);
  });

  it.each([
    ['/lab/media/synthetic-image', 'post'],
    ['/lab/media/synthetic-image', 'put'],
    ['/lab/media/synthetic-image', 'delete'],
    ['/inbox', 'post'],
    ['/webhook/instagram', 'post'],
    ['/webhook/messenger', 'post'],
    ['/automations', 'get'],
    ['/clients', 'get'],
    ['/api/auth/login', 'post'],
  ] as const)('does not expose operational endpoint %s %s', async (path, method) => {
    const result = await request(app.getHttpServer())[method](path).set(validHeaders);
    expect(result.status).toBe(404);
  });

  it('never tries to fetch external media', async () => {
    const result = await request(app.getHttpServer())
      .get('/lab/media/https://127.0.0.1/latest/meta-data').set(validHeaders);
    expect(result.status).toBe(404);
    expect(global.fetch).not.toHaveBeenCalled();
  });
});
