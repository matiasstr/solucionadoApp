import type { NextConfig } from 'next';

// Origen de la API, solo del lado servidor. Web y API quedan en el mismo origen (/api),
// así la cookie de refresh es first-party (ADR 0003 y 0007). Sin API configurada en
// producción no se crea el rewrite y el cliente informa que el servicio no está disponible.
const apiOrigin = process.env.API_ORIGIN ?? (process.env.NODE_ENV === 'production' ? undefined : 'http://127.0.0.1:3001');

const nextConfig: NextConfig = {
  poweredByHeader: false,
  reactStrictMode: true,
  transpilePackages: ['@tusofertas/ui', '@tusofertas/shared'],
  async rewrites() {
    return apiOrigin ? [{ source: '/api/:path*', destination: `${apiOrigin}/api/:path*` }] : [];
  },
  async headers() {
    return [{
      source: '/:path*',
      headers: [
        { key: 'X-Content-Type-Options', value: 'nosniff' },
        { key: 'Referrer-Policy', value: 'strict-origin-when-cross-origin' },
        { key: 'X-Frame-Options', value: 'DENY' },
      ],
    }];
  },
};

export default nextConfig;
