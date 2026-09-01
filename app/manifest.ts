import { MetadataRoute } from 'next';

export default function manifest(): MetadataRoute.Manifest {
  return {
    name: 'LiftField',
    short_name: 'LiftField',
    description: '엘리베이터 현장 관리 시스템',
    icons: [
      { src: '/icon-192.png', sizes: '192x192', type: 'image/png' },
      { src: '/icon-512.png', sizes: '512x512', type: 'image/png' },
    ],
    start_url: '/',
    display: 'standalone',
    theme_color: '#1e3a8a',
    background_color: '#ffffff',
  };
}
