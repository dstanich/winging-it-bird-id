import type { Metadata } from "next";
import { GeistSans } from "geist/font/sans";
import { GeistMono } from "geist/font/mono";
import "./globals.css";
import Script from "next/script";
import { SiteHeader } from "@/components/site-header";

export const metadata: Metadata = {
  title: "Winging-It Bird ID",
  description: "Bird species identified from camera clips",
  icons: {
    icon: "/images/winging-it-32x32.png",
    apple: "/images/winging-it-512x512.png",
  },
};

export default function RootLayout({
  children,
}: Readonly<{
  children: React.ReactNode;
}>) {
  const cfToken = process.env.CLOUDFLARE_ANALYTICS_TOKEN;

  return (
    <html lang="en">
      <body
        className={`${GeistSans.variable} ${GeistMono.variable} antialiased min-h-screen bg-zinc-50 dark:bg-zinc-950`}
      >
        <SiteHeader />
        {children}
        {cfToken && (
          <Script
            defer
            src="https://static.cloudflareinsights.com/beacon.min.js"
            data-cf-beacon={`{"token": "${cfToken}"}`}
            strategy="afterInteractive"
          />
        )}
      </body>
    </html>
  );
}
