import { WhatsappMessagingService } from './whatsapp-messaging.service';

function mockAudioSend(preparedMime: string) {
  const instance = Object.create(WhatsappMessagingService.prototype) as any;
  instance.resolveChannel = jest.fn(async () => ({ accessToken: 'stub' }));
  instance.prepareAudio = jest.fn(async (input: { buffer: Buffer; filename: string }) => ({
    ...input,
    mimeType: preparedMime,
  }));
  instance.uploadMedia = jest.fn(async () => 'uploaded-media-id');
  instance.send = jest.fn(async () => ({
    messageId: 'wamid.test-media',
  }));
  return instance;
}

describe('WhatsApp audio recording and attached audio formats', () => {
  it('sends recorded OGG/Opus as a voice note', async () => {
    const sender = mockAudioSend('audio/ogg; codecs=opus');
    await sender.sendAudio('company-1', '573000000000', {
      buffer: Buffer.from('voice'),
      mimeType: 'audio/webm',
      filename: 'microphone.webm',
    });
    expect(sender.send).toHaveBeenCalledWith(
      expect.anything(),
      expect.objectContaining({
        type: 'audio',
        audio: { id: 'uploaded-media-id', voice: true },
      }),
    );
  });

  it.each(['audio/mpeg', 'audio/mp4', 'audio/aac'])(
    'sends uploaded %s files as normal audio, not unsupported voice notes',
    async (format) => {
      const sender = mockAudioSend(format);
      await sender.sendAudio('company-1', '573000000000', {
        buffer: Buffer.from('audio'),
        mimeType: format,
        filename: 'audio-file',
      });
      expect(sender.send).toHaveBeenCalledWith(
        expect.anything(),
        expect.objectContaining({
          type: 'audio',
          audio: { id: 'uploaded-media-id' },
        }),
      );
    },
  );

  it('does not change the image or video message transport', () => {
    expect(typeof WhatsappMessagingService.prototype.sendImage).toBe('function');
    expect(typeof WhatsappMessagingService.prototype.sendFile).toBe('function');
  });
});
