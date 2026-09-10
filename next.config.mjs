/** @type {import('next').NextConfig} */
const nextConfig = {
  serverExternalPackages: ['@prisma/client', 'bcryptjs', 'pino'],
  eslint: { ignoreDuringBuilds: true },
};

export default nextConfig;
