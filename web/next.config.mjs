/** @type {import('next').NextConfig} */
const nextConfig = {
  reactStrictMode: true,
  // Emit a self-contained server bundle (.next/standalone/server.js) for a slim Docker image.
  output: "standalone",
  // The frontend talks to the Go backend server-side; expose only the base via server env.
  env: {
    LORE_BASE: process.env.LORE_BASE || "http://127.0.0.1:8080",
  },
};
export default nextConfig;
