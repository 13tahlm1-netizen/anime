import type { NextConfig } from "next";

const nextConfig: NextConfig = {
  reactStrictMode: false,
  images: {
    remotePatterns: [
      {
        protocol: "https",
        hostname: "**",
      },
      {
        protocol: "http",
        hostname: "**",
      },
    ],
  },
  async headers() {
    // 보안 헤더 (전 경로 공통)
    // - X-Content-Type-Options: MIME 스니핑 차단
    // - X-Frame-Options: 클릭재킹(iframe 임베딩) 차단
    // - Referrer-Policy: 외부 요청 시 전체 URL 유출 방지
    // - Permissions-Policy: 미사용 브라우저 센서 권한 비활성화
    // (CSP는 ArtPlayer의 인라인 스타일/동적 주입에 의존도가 높아 별도 검토 필요)
    return [
      {
        source: "/libass/:path*",
        headers: [
          { key: "Cache-Control", value: "public, max-age=31536000, immutable" },
        ],
      },
      {
        source: "/js/:path*",
        headers: [
          { key: "Cache-Control", value: "public, max-age=31536000, immutable" },
        ],
      },
      {
        source: "/icons/:path*",
        headers: [
          { key: "Cache-Control", value: "public, max-age=31536000, immutable" },
        ],
      },
      {
        source: "/:path*",
        headers: [
          { key: "X-Content-Type-Options", value: "nosniff" },
          { key: "X-Frame-Options", value: "DENY" },
          { key: "Referrer-Policy", value: "strict-origin-when-cross-origin" },
          { key: "Permissions-Policy", value: "camera=(), microphone=(), geolocation=(), payment=(), usb=()" },
        ],
      },
    ];
  },
};

export default nextConfig;
