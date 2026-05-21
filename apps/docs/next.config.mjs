/** @type {import('next').NextConfig} */
const nextConfig = {
  reactStrictMode: true,
  // Bundle JSON is read at build time only; data is inlined into static HTML,
  // so no runtime fs access is needed in the deployed app.
  async redirects() {
    return [
      // Single-version site — fold all version-prefixed paths back to root.
      // Covers fresh links from before the restructure plus old ReadTheDocs
      // shapes (/en/stable/..., /en/latest/...).
      { source: '/latest', destination: '/', permanent: true },
      { source: '/latest/:path*', destination: '/:path*', permanent: true },
      { source: '/stable', destination: '/', permanent: true },
      { source: '/stable/:path*', destination: '/:path*', permanent: true },
      { source: '/nightly', destination: '/', permanent: true },
      { source: '/nightly/:path*', destination: '/:path*', permanent: true },
      { source: '/en/stable/:path*', destination: '/:path*', permanent: true },
      { source: '/en/latest/:path*', destination: '/:path*', permanent: true }
    ];
  }
};

export default nextConfig;
