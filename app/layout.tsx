import type { Metadata } from "next";
import { Geist, Geist_Mono } from "next/font/google";
import "./globals.css";
import Link from "next/link";
import { ThemeProvider } from "@/components/theme-provider";
import { ThemeToggle } from "@/components/theme-switch";

const geistSans = Geist({
  variable: "--font-geist-sans",
  subsets: ["latin"],
});

const geistMono = Geist_Mono({
  variable: "--font-geist-mono",
  subsets: ["latin"],
});

export const metadata: Metadata = {
  title: "Bivaro – Rechnungen und Belege im Griff",
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
        className={`${geistSans.variable} ${geistMono.variable} antialiased min-h-screen bg-background`}
      >
        <ThemeProvider
          attribute="class"
          defaultTheme="system"
          enableSystem
          disableTransitionOnChange
        >
          <div className="flex flex-col min-h-screen">
            <header className="bg-background border-b border-input">
              <div className="container mx-auto py-4 px-4 sm:px-6 lg:px-8">
                <div className="flex justify-between items-center">
                  <div>
                    <Link href="/" className="text-lg font-bold text-foreground">
                      Bivaro
                    </Link>
                  </div>
                  <nav className="flex items-center">
                    <ul className="flex space-x-6 mr-4">
                      <li>
                        <Link href="/" className="text-muted-foreground hover:text-foreground">
                          Start
                        </Link>
                      </li>
                      <li>
                        <Link href="/dashboard" className="text-muted-foreground hover:text-foreground">
                          Dashboard
                        </Link>
                      </li>
                    </ul>
                    <ThemeToggle />
                  </nav>
                </div>
              </div>
            </header>
            
            <main className="flex-grow bg-background">
              {children}
            </main>
            
            <footer className="bg-background border-t border-input py-6">
              <div className="container mx-auto px-4 sm:px-6 lg:px-8">
                <p className="text-center text-muted-foreground text-sm">
                  &copy; {new Date().getFullYear()} Bivaro | 
                  Alle Beträge werden in Euro (€) angezeigt
                </p>
              </div>
            </footer>
          </div>
        </ThemeProvider>
      </body>
    </html>
  );
}
