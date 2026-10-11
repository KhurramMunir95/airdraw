/** @type {import('next').NextConfig} */
const nextConfig = {
  output: "export",
  basePath: "/airdraw",
  trailingSlash: true,
  images: { unoptimized: true }
};
export default nextConfig;
