import { readFileSync } from 'node:fs';
import { join } from 'node:path';

const ui = readFileSync(
  join(__dirname, '../../../app/page.tsx'),
  'utf8',
);

describe('MW1 chat media composer regression guards', () => {
  it('preserves up to ten images and the existing sequential image sending', () => {
    expect(ui).toContain('imageFiles.length + files.length > 10');
    expect(ui).toContain('setImageFiles((current) => [...current, ...files])');
    expect(ui).toContain('for (let index = 0; index < imageFiles.length; index += 1)');
    expect(ui).toContain('fetch("/api/inbox/image"');
    expect(ui).toContain('selectMediaFiles(event.target.files)');
  });

  it('detects drag-and-drop file payloads and accepts pasted screenshots', () => {
    expect(ui).toContain('selectMediaFilesRef.current(files)');
    expect(ui).toContain('onPaste={handleComposerPaste}');
    expect(ui).toContain('Array.from(event.clipboardData?.files ?? [])');
    expect(ui).toContain('window.addEventListener("drop", handleDrop)');
    expect(ui).toContain('window.removeEventListener("drop", handleDrop)');
  });

  it('retains video, document and audio upload routes without auto-sending on drop', () => {
    expect(ui).toContain('isAudioFile ? "/api/inbox/audio" : "/api/inbox/file"');
    expect(ui).toContain('fetch("/api/inbox/image"');
    expect(ui).toContain('selectMediaFiles(files)');
    expect(ui).toContain('attachmentFile');
    expect(ui).toContain('canSendMedia');
    expect(ui).toContain('canSendAudio');
    expect(ui).toContain('async function sendAudioRecording()');
    expect(ui).toContain('void startAudioRecording()');
  });

  it('keeps audio and video viewers available for incoming messages', () => {
    expect(ui).toContain('<AudioMessagePlayer item={item} />');
    expect(ui).toContain('<ImageMessageViewer item={item} />');
    expect(ui).toContain('<FileMessageViewer item={item} />');
  });
});
