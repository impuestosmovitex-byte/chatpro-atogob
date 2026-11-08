import {
  resolveInboxMediaFilename,
  resolveInboxMediaMimeType,
} from './inbox-media-content.util';

describe('Inbox incoming WhatsApp media metadata', () => {
  it('keeps stored video and audio content types for correct playback', () => {
    expect(resolveInboxMediaMimeType('video', 'video/mp4', null)).toBe('video/mp4');
    expect(resolveInboxMediaMimeType('audio', 'audio/ogg', null)).toBe('audio/ogg');
    expect(resolveInboxMediaMimeType('image', 'image/png', null)).toBe('image/png');
    expect(resolveInboxMediaMimeType('document', 'application/pdf', null))
      .toBe('application/pdf');
  });

  it('uses persisted mime when storage omits content-type', () => {
    expect(resolveInboxMediaMimeType('video', '', 'video/3gpp')).toBe('video/3gpp');
    expect(resolveInboxMediaMimeType('audio', '', 'audio/mpeg')).toBe('audio/mpeg');
    expect(resolveInboxMediaMimeType('document', null, 'application/pdf'))
      .toBe('application/pdf');
  });

  it('never mislabels video or audio as a JPEG if mime is missing', () => {
    expect(resolveInboxMediaMimeType('video')).toBe('video/mp4');
    expect(resolveInboxMediaMimeType('audio')).toBe('audio/ogg');
    expect(resolveInboxMediaMimeType('image')).toBe('image/jpeg');
    expect(resolveInboxMediaMimeType('document')).toBe('application/octet-stream');
  });

  it('keeps original stored file names rather than renaming every file image', () => {
    expect(resolveInboxMediaFilename('video', 'company/session/video.mp4'))
      .toBe('video.mp4');
    expect(resolveInboxMediaFilename('audio', 'company/session/nota.ogg'))
      .toBe('nota.ogg');
    expect(resolveInboxMediaFilename('document', 'company/session/contrato.pdf'))
      .toBe('contrato.pdf');
    expect(resolveInboxMediaFilename('video', 'company/session/')).toBe('video.mp4');
  });
});
