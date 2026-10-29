/** @type {import('next').NextConfig} */
const nextConfig = {
  /* config options here */
  cacheComponents: true,
  // The browser calls /api/… on this same site and Next.js forwards it to the backend. Same address
  // as the page, so the API's CORS list (which sites may call it from a browser) never gets in the
  // way, wherever the site runs (localhost, a tunnel, Vercel).
  async rewrites() {
    const api = (process.env.NEXT_PUBLIC_API_URL || 'http://localhost:4000').replace(/\/$/, '');
    return [{ source: '/api/:path*', destination: `${api}/api/:path*` }];
  },
  partialPrefetching: true,
  turbopack: {
    rules: {
      "*.css": {
        // Tailwind for normal stylesheets only. CSS Modules (*.module.css) are plain CSS; running them
        // through this loader renames them and Next.js stops treating them as modules.
        condition: { not: { path: /\.module\.css$/ } },
        loaders: ["@tailwindcss/turbopack"],
        as: "*.css",
      },
    },
  },
};

export default nextConfig;
