import type { NextConfig } from 'next';

const nextConfig: NextConfig = {
  experimental: {
    serverComponentsExternalPackages: ['@napi-rs/canvas'],
  },
  transpilePackages: ['pdfjs-dist'],
};

export default nextConfig;
