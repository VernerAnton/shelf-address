import type { NextConfig } from "next";
import { initOpenNextCloudflareForDev } from "@opennextjs/cloudflare";

const nextConfig: NextConfig = {};

export default nextConfig;

// Gives `next dev` the same D1/R2 bindings as the Worker, backed by the local
// database in .wrangler/ (npm run db:migrate:local). No-op outside dev.
initOpenNextCloudflareForDev();
