/** @type {import('next').NextConfig} */
const nextConfig = {
  output: "standalone",
  experimental: {
    // 专利解析以 100MB 为单文件上限；预留 multipart 请求边界开销。
    proxyClientMaxBodySize: "110mb",
  },
  // PDF.js 运行时需要从包目录加载 pdf.worker.mjs，不能被服务端构建拆分。
  serverExternalPackages: ["pdf-parse", "pdfjs-dist", "@napi-rs/canvas"],
  typescript: {
    ignoreBuildErrors: true,
  },
  images: {
    unoptimized: true,
  },
};

export default nextConfig;
