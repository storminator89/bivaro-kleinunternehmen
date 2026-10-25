import type { Metadata } from "next";
import { Suspense } from "react";
import { headers } from 'next/headers';
import "./fonts.css";
import "./globals.css";
import { ThemeProvider } from "@/components/theme-provider";
import AuthProvider from "@/components/auth/auth-provider";
import { AppShell } from "@/components/app-shell";
import { Toaster } from "@/components/ui/toaster";
import { RouteProgress } from "@/components/route-progress";
import { IncomingReviewHistoryBoundary } from "@/components/purchases/incoming-review-history-boundary";
import { RecordListSearchProvider } from "@/components/record-search/record-list-search-provider";

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
    <html lang="de" className="ui-fonts" suppressHydrationWarning>
      <head>
        <link
          rel="preload"
          href="/fonts/ui/inter/latin-c940764593d0fe5d.woff2"
          as="font"
          type="font/woff2"
          crossOrigin=""
          nonce={nonce}
        />
        <link
          rel="preload"
          href="/fonts/ui/geist-mono/latin-5f3d6ad60f29d6cb.woff2"
          as="font"
          type="font/woff2"
          crossOrigin=""
          nonce={nonce}
        />
        <link
          rel="preload"
          href="/fonts/ui/newsreader/latin-2a69ec1c0fb79a46.woff2"
          as="font"
          type="font/woff2"
          crossOrigin=""
          nonce={nonce}
        />
      </head>
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
            <Suspense fallback={null}>
              <RecordListSearchProvider><AppShell>{children}</AppShell></RecordListSearchProvider>
            </Suspense>
            <Toaster />
          </ThemeProvider>
        </AuthProvider>
      </body>
    </html>
  );
}
