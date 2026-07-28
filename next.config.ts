import type { NextConfig } from "next";

const nextConfig: NextConfig = {
  experimental: {
    serverActions: {
      // Intake supporting documents are capped at 10 MB (see intake/uploads.ts)
      // and arrive through a Server Action, whose default body limit is 1 MB.
      // The headroom covers multipart overhead; the real limit is enforced in
      // `validateUpload`, which is what returns a human error message.
      bodySizeLimit: "12mb",
    },
  },
};

export default nextConfig;
