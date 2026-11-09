/**
 * MW1: opt-in, REAL OpenAI quality check, with exclusively fictitious data.
 *
 * NEVER uses OPENAI_API_KEY, Shopify, Meta, Supabase or a real company.
 * Run ONLY with MW1_EVAL_RUN_LIVE=true and a separate dedicated
 * MW1_STAGING_OPENAI_API_KEY credential. Default CI runs prompt checks only.
 * store:false; capped output, calls and timeouts. No customer PII or media.
 *
 * The actual ChatAgentService.reply/buildInstructions/classification methods
 * run; CRM, order lookup, model routing and outbound integrations are stubbed.
 * This measures text/policy quality, not real delivery or tool execution.
 */
import OpenAI from 'openai';
import { ChatAgentService } from './chat-agent.service';

type Tenant = 'moda-ficticia' | 'academia-ficticia';
type Category = 'sales' | 'service';

const fashion = {
  id: '00000000-0000-4000-8000-000000000111',
  slug: 'moda-ficticia',
  name: 'Moda Ficticia',
  assistantName: 'Sofía',
  aiInstructions: [
    'Eres Sofía, asesora virtual de Moda Ficticia. No afirmes que eres una persona humana.',
    'Responde de forma cercana, natural y breve: entre 1 y 3 frases.',
    'Cuando está en Ventas, las preguntas generales sobre cambios, envíos o garantías',
    'se responden sin transferir y se conserva la conversación comercial.',
    'Cambios voluntarios: sí, conforme a las condiciones de compra.',
    'El 90% de los pedidos se DESPACHA entre 24 y 72 horas hábiles.',
    'Despacho no significa entrega; no prometas fecha de llegada sin seguimiento.',
    'REGLA PRIORITARIA: SOLICITUDES ECONÓMICAS Y CANCELACIONES EXPRESAS.',
    'Si piden expresamente reembolso, recuperar el dinero, anular crédito',
    'o cancelar un pedido ya realizado, transfiere realmente a un asesor.',
    'No ofrezcas dinero, compensación, reembolso ni cancelación espontáneamente.',
    'Si dicen "quiero devolver la prenda" sin pedir dinero, aclara la gestión de',
    'forma neutral sin enumerar alternativas económicas.',
    'No inventes pedidos, estados, guías, precios, inventarios, promociones ni',
    'acciones ejecutadas. Nunca narres herramientas o procesos internos.',
  ].join(' '),
  settings: {
    economic_handoff_policy: 'required',
    ai_tone: 'cercana, clara y breve',
    commercial_flow: {
      sales_instructions: 'Ayuda con la compra de prendas; evita repetir datos ya dados.',
      shipping_instructions:
        'El 90% de pedidos se despacha en 24 a 72 horas hábiles; no implica entrega.',
      service_instructions:
        'Consulta un pedido solo después de verificar dos identificadores reales.',
    },
    knowledge_base: {
      exchanges_returns: 'Sí se hacen cambios voluntarios conforme a la política de la empresa.',
      policies_faq: 'Las dudas generales sobre políticas no requieren atención humana.',
    },
  },
} as any;

const academy = {
  id: '00000000-0000-4000-8000-000000000222',
  slug: 'academia-ficticia',
  name: 'Academia Ficticia',
  assistantName: 'Asistente',
  aiInstructions: [
    'Asesora sobre cursos y matrículas en línea, no sobre ropa.',
    'No existe una promesa configurada de despachos físicos.',
    'No copies políticas, tiempos ni catálogos de ninguna otra empresa.',
    'No inventes acceso a cursos ni confirmes una matrícula no verificada.',
  ].join(' '),
  settings: {
    economic_handoff_policy: 'disabled',
    commercial_flow: {
      sales_instructions: 'Ofrece información de cursos sin inventar precios.',
    },
  },
} as any;

function testSession(profile: any, category: Category = 'sales') {
  return {
    id: 'offline:' + profile.slug,
    companyId: profile.id,
    customerPhone: 'fictional-eval-contact',
    stage: category,
    context: { conversation_category: category, channel: 'offline-evaluation' },
    lastMessageAt: '2026-11-09T00:00:00.000Z',
    pendingCount: 0,
    pendingSince: null,
    attentionStatus: 'ai' as 'ai' | 'waiting',
    assignedToUserId: null,
    assignedToName: null,
    takenAt: null,
    closedAt: null,
  };
}

function previewPrompt(profile: any, category: Category = 'sales'): string {
  const agent = Object.create(ChatAgentService.prototype) as any;
  return agent.buildInstructions(profile, testSession(profile, category), false);
}

describe('MW1 fictional-company prompt construction (offline)', () => {
  it('makes FAQ, shipping and policy instructions available during sales', () => {
    const prompt = previewPrompt(fashion);
    expect(prompt).toContain('Moda Ficticia');
    expect(prompt).toContain('se despacha en 24 a 72 horas');
    expect(prompt).toContain('Sí se hacen cambios');
    expect(prompt).toContain('SOLICITUDES ECONÓMICAS');
  });

  it('does not inject any fashion policies into an unrelated company', () => {
    const prompt = previewPrompt(academy);
    expect(prompt).toContain('Academia Ficticia');
    expect(prompt).not.toContain('Moda Ficticia');
    expect(prompt).not.toContain('24 a 72 horas');
    expect(prompt).not.toContain('Sí se hacen cambios');
  });
});

const live = process.env.MW1_EVAL_RUN_LIVE === 'true';
const liveCheck = live ? it : it.skip;

liveCheck('uses REAL OpenAI with isolated fixtures and reports quality', async () => {
  const key = process.env.MW1_STAGING_OPENAI_API_KEY?.trim();
  if (!key || key.length < 20) {
    throw new Error(
      'LIVE TEST NOT RUN: configure a dedicated MW1_STAGING_OPENAI_API_KEY. ' +
      'Never reuse a production key. No real AI call was made.',
    );
  }
  if (process.env.OPENAI_API_KEY?.trim()) {
    throw new Error('Live evaluation is isolated: remove OPENAI_API_KEY from the runner.');
  }

  const client = new OpenAI({ apiKey: key, maxRetries: 0, timeout: 30000 });
  const model = process.env.MW1_STAGING_AI_MODEL?.trim() || 'gpt-4o-mini';
  let modelCalls = 0;
  let humanHandoffs = 0;
  const maxCalls = 14;

  function agentFixture(profile: any) {
    const agent = Object.create(ChatAgentService.prototype) as any;
    const session = testSession(profile);
    const history: Array<{ sender: string; message: string }> = [];
    agent.getClient = () => ({
      responses: {
        create: async (request: any) => {
          modelCalls += 1;
          if (modelCalls > maxCalls) throw new Error('Evaluation call budget exceeded.');
          const { tools, tool_choice, ...rest } = request;
          return client.responses.create({
            ...rest,
            model,
            store: false,
            max_output_tokens: 350,
            ...(Array.isArray(tools) && tools.length > 0
              ? { tools, tool_choice }
              : {}),
          });
        },
      },
    });
    agent.getModel = () => model;
    agent.getContextStatus = () => ({ is_within_context_window: true });
    agent.prepareSessionForIncomingActivity = async (_p: unknown, s: any) => s;
    agent.resolveMessageRouting = async () => ({
      source: 'offline-live-eval',
      messageOrigin: 'customer',
      understanding: 'clear',
      intent: 'other',
    });
    agent.applyMessageUnderstanding = async () => null;
    agent.rememberConversationCategory = async (s: any, category: Category) => {
      s.context.conversation_category = category;
      return s;
    };
    agent.getCollectionsForSession = async () => [];
    agent.getActiveRecoveryContext = () => null;
    agent.getRecentMessages = async () => history.slice(-8);
    agent.getTools = () => [];
    agent.recordStagingAiUsage = async () => undefined;
    agent.clearTechnicalFailureState = async () => undefined;
    agent.handleTechnicalFailure = async (_id: string, detail: string) => {
      throw new Error('Live AI call failed: ' + detail.slice(0, 100));
    };
    agent.agentSessionRuntimeService = {
      requestHumanAttention: async () => {
        humanHandoffs += 1;
        session.attentionStatus = 'waiting';
        return session;
      },
      updateSession: async (_id: string, patch: any) => {
        if (patch.context) session.context = patch.context;
        if (patch.stage) session.stage = patch.stage;
        return session;
      },
      getSessionById: async () => session,
    };

    async function send(text: string) {
      if (session.attentionStatus !== 'ai') return null;
      const answer = (await agent.reply(profile, session, text)).trim();
      history.push({ sender: 'customer', message: text });
      history.push({ sender: 'assistant', message: answer });
      return answer;
    }
    return { send, session, agent };
  }

  // No names, numbers, orders or credentials from a real customer or company.
  const moda = agentFixture(fashion);
  const product = await moda.send('Estoy mirando una blusa negra talla M.');
  expect(product).toBeTruthy();
  const exchange = await moda.send('¿Hacen cambios?');
  expect(exchange).toMatch(/cambio/i);
  expect(moda.session.context.conversation_category).toBe('sales');
  const shipping = await moda.send('¿Cuánto demora el envío?');
  expect(shipping).toMatch(/24|72/);
  expect(shipping).toMatch(/despach|env[ií]a|sale/i);
  expect(shipping).not.toMatch(/te llega (en|entre) 24|entrega garantizada/i);

  const informational = await moda.send('¿Puedo cambiar una blusa si no me quedó?');
  expect(informational).toMatch(/cambio|talla/i);
  const ambiguous = await moda.send('Quiero devolver la prenda.');
  expect(ambiguous).not.toMatch(/reembolso|devoluci[oó]n de dinero|cancelar pedido/i);
  expect(humanHandoffs).toBe(0);

  const order = agentFixture(fashion);
  const orderReply = await order.send('¿Dónde está mi pedido #45999?');
  expect(orderReply).toBeTruthy();
  expect(orderReply).not.toMatch(/ya (fue|est[aá]) entregado|est[aá] en camino|n[uú]mero de gu[ií]a es/i);
  expect(order.session.context.conversation_category).toBe('service');

  const cancellation = agentFixture(fashion);
  const handoff = await cancellation.send('Quiero cancelar mi pedido');
  expect(handoff).toMatch(/asesor/i);
  expect(humanHandoffs).toBe(1);
  expect(cancellation.session.attentionStatus).toBe('waiting');
  expect(await cancellation.send('¿Hay alguien?')).toBeNull();

  const courses = agentFixture(academy);
  const academyReply = await courses.send('¿Cuánto demora el envío de mi curso?');
  expect(academyReply).toBeTruthy();
  expect(academyReply).not.toMatch(/24\s*(a|y|\/|-)\s*72\s*horas/i);
  expect(academyReply).not.toMatch(/Moda Ficticia|Sof[ií]a/i);

  console.log('MW1 LIVE QA: passed; cases=8; providerCalls=' + modelCalls +
    '; humanTransfers=' + humanHandoffs + '; model=' + model);
}, 240000);
