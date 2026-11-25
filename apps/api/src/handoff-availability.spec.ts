import { ChatAgentService } from './chat-agent.service';
import { ConversationMemoryService } from './conversation-memory.service';

function session(attentionStatus: string, status: string) {
  return {
    id: 'session-1',
    companyId: 'company-a',
    attentionStatus,
    assignedToName: attentionStatus === 'human' ? 'Asesora de prueba' : null,
    context: { handoff: { status } },
  } as any;
}

describe('MW1 handoff message reflects actual backend status', () => {
  const agent = Object.create(ChatAgentService.prototype) as any;

  it('confirms handoff briefly only after human assignment', () => {
    const message = agent.humanAttentionMessage(session('human', 'assigned'));
    expect(message).toContain('Ya te transfiero');
    expect(message).not.toMatch(/horario|ocupados/);
  });

  it('keeps a queued in-hours conversation without claiming transfer', () => {
    const message = agent.humanAttentionMessage(session('waiting', 'waiting_no_advisor'));
    expect(message).toContain('ocupados');
    expect(message).not.toMatch(/horario|te transfiero/);
  });

  it('does not falsely report advisors as busy when outside hours', () => {
    const message = agent.humanAttentionMessage(session('waiting', 'waiting_outside_hours'));
    expect(message).toContain('próximo horario');
    expect(message).not.toMatch(/ocupados|te transfiero/);
  });
});

describe('MW1 tenant-specific support schedule', () => {
  it('reads only its company and formats the configured weekly timetable', async () => {
    const eq = jest.fn(async (_column: string, _id: string) => ({
      data: [1, 2, 3, 4, 5, 6].map((day_of_week) => ({
        day_of_week,
        is_open: true,
        start_time: '09:00:00',
        end_time: '18:00:00',
      })),
      error: null,
    }));
    const select = jest.fn(() => ({ eq }));
    const from = jest.fn(() => ({ select }));
    const memory = Object.create(ConversationMemoryService.prototype) as any;
    memory.supabaseService = { getClient: () => ({ from }) };

    const label = await memory.getHumanAttentionHoursLabel('company-a');
    expect(from).toHaveBeenCalledWith('company_support_hours');
    expect(eq).toHaveBeenCalledWith('company_id', 'company-a');
    expect(label).toBe('lunes a sábado de 9:00 a. m. a 6:00 p. m.');
  });

  it('does not invent a weekly schedule when hours are unavailable', async () => {
    const memory = Object.create(ConversationMemoryService.prototype) as any;
    memory.supabaseService = {
      getClient: () => ({
        from: () => ({ select: () => ({ eq: async () => ({
          data: null,
          error: { message: 'service unavailable' },
        }) }) }),
      }),
    };
    expect(await memory.getHumanAttentionHoursLabel('company-b')).toBeNull();
  });

  it('does not reassign a conversation already in human attention', async () => {
    const memory = Object.create(ConversationMemoryService.prototype) as any;
    memory.getSessionById = jest.fn(async () => session('human', 'assigned'));
    memory.conversationEventsService = { record: jest.fn() };
    const current = await memory.requestHumanAttention('session-1');
    expect(current.attentionStatus).toBe('human');
    expect(memory.conversationEventsService.record).not.toHaveBeenCalled();
  });

  it('preserves already queued handoffs without recording duplicates', async () => {
    const memory = Object.create(ConversationMemoryService.prototype) as any;
    memory.getSessionById = jest.fn(async () => session('waiting', 'waiting_no_advisor'));
    memory.conversationEventsService = { record: jest.fn() };
    const current = await memory.requestHumanAttention('session-1');
    expect(current.attentionStatus).toBe('waiting');
    expect(memory.conversationEventsService.record).not.toHaveBeenCalled();
  });
});
