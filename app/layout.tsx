import type { Metadata } from "next";
import { Geist, Geist_Mono } from "next/font/google";
import "./globals.css";
import Link from "next/link";

const geistSans = Geist({
  variable: "--font-geist-sans",
  subsets: ["latin"],
});

const geistMono = Geist_Mono({
  variable: "--font-geist-mono",
  subsets: ["latin"],
});

export const metadata: Metadata = {
  title: "Kleinunternehmer Buchhaltung",
  description: "Eine einfache Buchhaltungsanwendung für Kleinunternehmer",
};

export default function RootLayout({
  children,
}: Readonly<{
  children: React.ReactNode;
}>) {
  return (
    <html lang="de">
      <body
        className={`${geistSans.variable} ${geistMono.variable} antialiased min-h-screen bg-gray-50`}
      >
        <div className="flex flex-col min-h-screen">
          <header className="bg-white border-b border-gray-200">
            <div className="container mx-auto py-4 px-4 sm:px-6 lg:px-8">
              <div className="flex justify-between items-center">
                <div>
                  <Link href="/" className="text-lg font-bold text-gray-900">
                    Buchhaltung für Kleinunternehmer
                  </Link>
                </div>
                <nav>
                  <ul className="flex space-x-6">
                    <li>
                      <Link href="/" className="text-gray-600 hover:text-gray-900">
                        Start
                      </Link>
                    </li>
                    <li>
                      <Link href="/dashboard" className="text-gray-600 hover:text-gray-900">
                        Dashboard
                      </Link>
                    </li>
                  </ul>
                </nav>
              </div>
            </div>
          </header>
          
          <main className="flex-grow bg-gray-50">
            {children}
          </main>
          
          <footer className="bg-white border-t border-gray-200 py-6">
            <div className="container mx-auto px-4 sm:px-6 lg:px-8">
              <p className="text-center text-gray-500 text-sm">
                &copy; {new Date().getFullYear()} Buchhaltung für Kleinunternehmer | 
                Alle Beträge werden in Euro (€) angezeigt
              </p>
            </div>
          </footer>
        </div>
      </body>
    </html>
  );
}
