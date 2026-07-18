import type { MetadataRoute } from 'next';

export default function manifest(): MetadataRoute.Manifest {
  return {
    id: '/',
    name: 'ChatPro',
    short_name: 'ChatPro',
    description:
      'Bandeja multiempresa para atender WhatsApp y otros canales con asesores e inteligencia artificial.',
    start_url: '/',
    scope: '/',
    display: 'standalone',
    orientation: 'portrait',
    background_color: '#f5f6f8',
    theme_color: '#111111',
    lang: 'es',
    categories: ['business', 'productivity', 'communication'],
    icons: [
      {
        src: '/icons/chatpro-192.png',
        sizes: '192x192',
        type: 'image/png',
        purpose: 'any',
      },
      {
        src: '/icons/chatpro-512.png',
        sizes: '512x512',
        type: 'image/png',
        purpose: 'any',
      },
      {
        src: '/icons/chatpro-maskable-512.png',
        sizes: '512x512',
        type: 'image/png',
        purpose: 'maskable',
      },
    ],
  };
}
