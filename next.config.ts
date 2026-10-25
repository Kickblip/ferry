import type { NextConfig } from "next"

const nextConfig: NextConfig = {
  images: {
    remotePatterns: [
      {
        protocol: "https",
        hostname: "*.ufs.sh",
        port: "",
        pathname: "/f/*",
        search: "",
      },
    ],
  },
}

export default nextConfig
