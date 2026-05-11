import type { MetadataRoute } from 'next';

export default function manifest(): MetadataRoute.Manifest {
  const appUrl = process.env.NEXT_PUBLIC_APP_URL?.replace(/\/$/, '');

  // The self-referenced related_applications entry lets Chromium's
  // navigator.getInstalledRelatedApps() report this PWA as already installed.
  // It requires an absolute URL pointing at the deployed manifest, which is
  // only known when NEXT_PUBLIC_APP_URL is set at build time.
  const relatedApps = appUrl
    ? {
        related_applications: [
          { platform: 'webapp', url: `${appUrl}/manifest.webmanifest` },
        ],
        prefer_related_applications: false,
      }
    : {};

  return {
    name: 'Mind Organizer',
    short_name: 'MO',
    description: 'Flashcards, notes, and spaced repetition for effective studying',
    icons: [
      {
        src: '/icons/icon-192x192.png',
        sizes: '192x192',
        type: 'image/png',
        purpose: 'maskable',
      },
      {
        src: '/icons/icon-512x512.png',
        sizes: '512x512',
        type: 'image/png',
      },
    ],
    theme_color: '#0a0a0a',
    background_color: '#0a0a0a',
    start_url: '/dashboard',
    display: 'standalone',
    orientation: 'portrait',
    ...relatedApps,
  };
}
