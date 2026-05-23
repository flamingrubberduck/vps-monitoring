/** @type {import('next').NextConfig} */
const nextConfig = {
  reactStrictMode: true,
  output: 'standalone',
  experimental: {
    serverComponentsExternalPackages: ['mongoose', 'bcryptjs'],
    instrumentationHook: true,
  },
};

module.exports = nextConfig;
