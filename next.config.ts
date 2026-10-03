import type { NextConfig } from "next";

const nextConfig: NextConfig = {
  allowedDevOrigins: ["192.168.18.7", "127.0.0.1"],
  agentRules: false,
  distDir: process.env.PONTO_QA === "true" ? ".next-qa" : ".next",
};

export default nextConfig;
