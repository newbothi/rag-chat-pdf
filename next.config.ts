import type { NextConfig } from 'next';

const nextConfig: NextConfig = {
  // unpdf trae su propio build de pdf.js; se carga en el servidor sin empaquetar
  serverExternalPackages: ['unpdf'],
};

export default nextConfig;
