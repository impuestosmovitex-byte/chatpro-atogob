import type { Metadata, Viewport } from 'next';
import { Geist, Geist_Mono } from 'next/font/google';
import './globals.css';

const geistSans = Geist({
  variable: '--font-geist-sans',
  subsets: ['latin'],
});

const geistMono = Geist_Mono({
  variable: '--font-geist-mono',
  subsets: ['latin'],
});

export const metadata: Metadata = {
  title: {
    default: 'ChatPro',
    template: '%s | ChatPro',
  },
  description:
    'Bandeja multiempresa para atender WhatsApp y otros canales con asesores e inteligencia artificial.',
  applicationName: 'ChatPro',
  manifest: '/manifest.webmanifest',
  appleWebApp: {
    capable: true,
    title: 'ChatPro',
    statusBarStyle: 'black-translucent',
  },
  formatDetection: {
    telephone: false,
  },
  icons: {
    icon: [
      {
        url: '/icons/chatpro-192.png',
        sizes: '192x192',
        type: 'image/png',
      },
      {
        url: '/icons/chatpro-512.png',
        sizes: '512x512',
        type: 'image/png',
      },
    ],
    apple: [
      {
        url: '/icons/chatpro-apple-180.png',
        sizes: '180x180',
        type: 'image/png',
      },
    ],
    shortcut: '/icons/chatpro-192.png',
  },
};

export const viewport: Viewport = {
  width: 'device-width',
  initialScale: 1,
  viewportFit: 'cover',
  themeColor: '#111111',
  colorScheme: 'light',
};

export default function RootLayout({
  children,
}: Readonly<{
  children: React.ReactNode;
}>) {
  return (
    <html
      lang="es"
      className={`${geistSans.variable} ${geistMono.variable} h-full antialiased`}
    >
      <body className="min-h-full flex flex-col">{children}</body>
    </html>
  );
}
