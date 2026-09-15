/** @type {import('next').NextConfig} */
const nextConfig = {
  reactStrictMode: true,
  // Images are served from Supabase Storage via signed URLs; no Next image optimization needed.
  images: { unoptimized: true },
  async headers() {
    return [
      { source: "/sw.js", headers: [{ key: "Service-Worker-Allowed", value: "/" }] },
    ];
  },
};
export default nextConfig;
