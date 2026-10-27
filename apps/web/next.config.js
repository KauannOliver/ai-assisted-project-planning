/** @type {import('next').NextConfig} */
const nextConfig = {
  async rewrites() {
    const apiUrl = (process.env.INTERNAL_API_URL || 'http://localhost:4100').replace(/\/$/, '');

    return [
      {
        source: '/backend-api/:path*',
        destination: `${apiUrl}/:path*`,
      },
    ];
  },
};

module.exports = nextConfig;
