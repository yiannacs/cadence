import type { NextConfig } from "next";

const nextConfig: NextConfig = {
  // Spotify only accepts loopback IPs as redirect URIs, so the app runs on
  // 127.0.0.1. Without this, dev resources are blocked and pages never hydrate.
  allowedDevOrigins: ["127.0.0.1"],
};

export default nextConfig;
