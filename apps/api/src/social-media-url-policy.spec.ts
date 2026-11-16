import { parseTrustedSocialMediaUrl } from './social-media-url-policy';

describe('Meta social media remote URL policy', () => {
  test.each([
    'https://graph.facebook.com/v22.0/123',
    'https://graph.instagram.com/media/123',
    'https://lookaside.facebook.com/123',
    'https://lookaside.instagram.com/123',
    'https://scontent.cdninstagram.com/abc?oh=example',
    'https://scontent.xx.fbcdn.net/v/t1.0-9/img.jpg',
    'https://cdn.fbsbx.com/file.pdf',
    'https://graph.facebook.com:443/v22.0/123',
    // Synthetic signed/CDN-shaped URLs; no real user tokens or media.
    'https://scontent.xx.fbcdn.net/v/t39.30808-6/example.jpg?oh=synthetic&oe=synthetic',
    'https://scontent-lhr8-2.cdninstagram.com/v/t51.2885-15/example.jpg?stp=synthetic',
    'https://lookaside.facebook.com/instagram-image/123?synthetic=1',
  ])('accepts trusted HTTPS media URL %s', (url) => {
    expect(parseTrustedSocialMediaUrl(url)?.protocol).toBe('https:');
  });

  test.each([
    '',
    'not-a-url',
    'http://graph.facebook.com/media',
    'https://evil.example/media',
    'https://facebook.com.evil.example/file',
    'https://evilfbcdn.net/file',
    'https://fbcdn.net/file',
    'https://graph.facebook.com.evil.test/asset',
    'https://127.0.0.1:8080/admin',
    'https://localhost/latest/meta-data',
    'https://169.254.169.254/latest/meta-data',
    'https://user:pass@graph.facebook.com/media',
    'https://graph.facebook.com:8443/media',
    'https://graph.facebook.com@unsafe.example/media',
    'https://scontent.xx.fbcdn.net.unsafe.example/photo',
    'http://scontent.xx.fbcdn.net/asset',
    'https://fbcdn.net.unsafe.example/file',
    'file:///etc/passwd',
  ])('rejects unsafe URL %s', (url) => {
    expect(parseTrustedSocialMediaUrl(url)).toBeNull();
  });
});
