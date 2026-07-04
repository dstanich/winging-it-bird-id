import type { NextConfig } from "next";
import path from "path";

const nextConfig: NextConfig = {
  output: "export", // Enable static export, we are going to serve the files from S3
  trailingSlash: true,
  outputFileTracingRoot: path.join(__dirname, ".."), // To allow symlinks to resolve
};

export default nextConfig;
