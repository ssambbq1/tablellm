import type { NextConfig } from 'next';

const nextConfig: NextConfig = {
  serverExternalPackages: ['@napi-rs/canvas'],
  transpilePackages: ['pdfjs-dist'],
};

export default nextConfig;
