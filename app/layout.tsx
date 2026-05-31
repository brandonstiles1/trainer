import type { Metadata, Viewport } from "next";
import { headers } from "next/headers";
import { Hanken_Grotesk } from "next/font/google";
import { BottomNav } from "@/components/bottom-nav";
import "./globals.css";

const sans = Hanken_Grotesk({
  subsets: ["latin"],
  weight: ["400", "500"],
  variable: "--font-sans",
  display: "swap",
});

export const metadata: Metadata = {
  title: "Trainer",
  description: "Your personal Claude-powered coach.",
};

export const viewport: Viewport = {
  themeColor: "#ffffff",
  width: "device-width",
  initialScale: 1,
  maximumScale: 1,
  userScalable: false,
};

export default async function RootLayout({
  children,
}: {
  children: React.ReactNode;
}) {
  // Hide nav on unauthenticated routes. Proxy sets x-pathname via headers.
  const h = await headers();
  const pathname = h.get("x-pathname") ?? "";
  const hideNav = pathname.startsWith("/login") || pathname.startsWith("/auth");

  return (
    <html lang="en" className={sans.variable}>
      <body className="antialiased pb-16">
        <div className="min-h-dvh">{children}</div>
        {!hideNav && <BottomNav />}
      </body>
    </html>
  );
}
