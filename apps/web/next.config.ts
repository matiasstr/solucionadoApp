import type { NextConfig } from 'next';

const nextConfig: NextConfig = {
  poweredByHeader: false,
  reactStrictMode: true,
  transpilePackages: ['@tusofertas/ui', '@tusofertas/shared'],
};

export default nextConfig;
