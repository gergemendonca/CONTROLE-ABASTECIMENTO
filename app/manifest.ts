import type { MetadataRoute } from 'next';

export default function manifest(): MetadataRoute.Manifest {
  return {
    name: 'Controle de Abastecimento',
    short_name: 'Abastecimento',
    description: 'Controle de abastecimento da frota',
    id: '/',
    start_url: '/',
    scope: '/',
    display: 'standalone',
    background_color: '#ffffff',
    theme_color: '#b91c1c',
    icons: [
      { src: '/icon.png', sizes: '1024x1024', type: 'image/png' },
    ],
  };
}
