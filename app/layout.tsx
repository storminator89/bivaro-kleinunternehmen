import type { Metadata } from "next";
import { Suspense } from "react";
import { headers } from 'next/headers';
import { Inter, Geist_Mono, Newsreader } from "next/font/google";
import "./globals.css";
import { ThemeProvider } from "@/components/theme-provider";
import AuthProvider from "@/components/auth/auth-provider";
import { AppShell } from "@/components/app-shell";
import { Toaster } from "@/components/ui/toaster";
import { RouteProgress } from "@/components/route-progress";
import { IncomingReviewHistoryBoundary } from "@/components/purchases/incoming-review-history-boundary";

const inter = Inter({
  variable: "--font-inter",
  subsets: ["latin"],
});

const geistMono = Geist_Mono({
  variable: "--font-geist-mono",
  subsets: ["latin"],
});

const newsreader = Newsreader({
  variable: "--font-newsreader",
  subsets: ["latin"],
  style: "normal",
  weight: ["500", "600"],
});

export const metadata: Metadata = {
  title: "Bivaro – Rechnungen und Belege im Griff",
  description: "Eine einfache Buchhaltungsanwendung für Kleinunternehmer",
};

export default async function RootLayout({
  children,
}: Readonly<{
  children: React.ReactNode;
}>) {
  const nonce = (await headers()).get('x-nonce') ?? undefined;
  return (
    <html lang="de" className={`${inter.variable} ${geistMono.variable} ${newsreader.variable}`} suppressHydrationWarning>
      <body
        className="min-h-screen bg-background antialiased"
      >
        <IncomingReviewHistoryBoundary />
        <AuthProvider>
          <ThemeProvider
            nonce={nonce}
            attribute="class"
            defaultTheme="system"
            enableSystem
            disableTransitionOnChange
          >
            <Suspense fallback={null}>
              <RouteProgress />
            </Suspense>
            <AppShell>{children}</AppShell>
            <Toaster />
          </ThemeProvider>
        </AuthProvider>
      </body>
    </html>
  );
}
