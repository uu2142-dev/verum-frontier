/** @type {import('next').NextConfig} */
const nextConfig = {
  images: {
    unoptimized: true,
  },
  async redirects() {
    return [
      // The /audit copy became the homepage (Aug 2026). LinkedIn articles and
      // old shares still point here — keep them landing on the same content.
      { source: "/audit", destination: "/", permanent: true },
    ];
  },
};

module.exports = nextConfig;
