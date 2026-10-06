import type { MetadataRoute } from 'next';

// The web app manifest — what lets a phone "install" VRM Monitor to the Home
// Screen. Installing is not cosmetic: on iPhone, push notifications only work
// for an installed web app (iOS 16.4+), so this is what makes phone alerts
// possible there at all. Served at /manifest.webmanifest and linked from every
// page automatically.
//
// `start_url` is /app: signed-out visitors are sent to the login page and
// everyone else lands on their reports. Note that an installed iOS app keeps its
// own cookie jar, separate from Safari — the person signs in once inside it.
export default function manifest(): MetadataRoute.Manifest {
  return {
    name: 'VRM Monitor',
    short_name: 'VRM Monitor',
    description: 'Live status, alerts and weekly reports for your Victron system.',
    start_url: '/app',
    scope: '/',
    display: 'standalone',
    background_color: '#0b2231',
    theme_color: '#0b2231',
    icons: [
      { src: '/icons/icon-192.png', sizes: '192x192', type: 'image/png', purpose: 'any' },
      { src: '/icons/icon-512.png', sizes: '512x512', type: 'image/png', purpose: 'any' },
      { src: '/icons/icon-maskable-512.png', sizes: '512x512', type: 'image/png', purpose: 'maskable' },
    ],
  };
}
