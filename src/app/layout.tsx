import type { Metadata, Viewport } from "next";
import { Suspense } from "react";
import "./globals.css";
import PwaRegister from "@/components/PwaRegister";
import PullToRefresh from "@/components/PullToRefresh";
import AuthGuard from "@/components/AuthGuard";
import GlobalNavigationIndicator from "@/components/GlobalNavigationIndicator";

export const viewport: Viewport = {
  themeColor: "#0b0f19",
  width: "device-width",
  initialScale: 1,
  maximumScale: 1,
  viewportFit: "cover",
};

export const metadata: Metadata = {
  title: "Anihub",
  description: "Next.js Anime Player with Smart Auto-Skip & Subtitles",
  manifest: "/manifest.json",
  appleWebApp: {
    capable: true,
    statusBarStyle: "black-translucent",
    title: "Anihub",
  },
  icons: {
    icon: [
      { url: "/favicon-32x32.png", sizes: "32x32", type: "image/png" },
      { url: "/favicon-16x16.png", sizes: "16x16", type: "image/png" },
    ],
    apple: [
      { url: "/apple-touch-icon.png", sizes: "180x180", type: "image/png" },
    ],
  },
};

export default function RootLayout({
  children,
}: Readonly<{
  children: React.ReactNode;
}>) {
  return (
    <html lang="ko">
      <head>
        <meta name="mobile-web-app-capable" content="yes" />
        <meta name="apple-mobile-web-app-capable" content="yes" />
        <meta name="apple-mobile-web-app-status-bar-style" content="black-translucent" />
      </head>
      <body className="antialiased bg-[#0b0f19] text-slate-100 min-h-screen">
        <Suspense fallback={null}>
          <GlobalNavigationIndicator />
        </Suspense>
        <PullToRefresh />
        <AuthGuard />
        {children}
        <PwaRegister />
      </body>
    </html>
  );
}
