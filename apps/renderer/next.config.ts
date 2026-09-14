import type { NextConfig } from "next";

const nextConfig: NextConfig = {
  allowedDevOrigins: ["127.0.0.1"],
  reactStrictMode: true,
  // Electron serves exported files directly; production has no Next.js request server.
  output: "export",
  assetPrefix: process.env.NODE_ENV === "production" ? "." : undefined,
  trailingSlash: true,
  images: { unoptimized: true },
};

export default nextConfig;
