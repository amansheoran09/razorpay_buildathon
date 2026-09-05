import type { NextConfig } from "next";

const nextConfig: NextConfig = {
  // better-sqlite3 is a native module; the bundler must not try to trace it.
  serverExternalPackages: ['better-sqlite3'],
  /* config options here */
};

export default nextConfig;
