import type { Metadata } from "next";
import { Geist, Geist_Mono } from "next/font/google";
import "./globals.css";
import Link from "next/link";
import { ThemeProvider } from "@/components/theme-provider";
import { ThemeToggle } from "@/components/theme-switch";
import AuthProvider from "@/components/auth/auth-provider";
import { NavLinks } from "@/components/navigation/nav-links";
import { Sheet, SheetContent, SheetTrigger } from "@/components/ui/sheet";
import { Button } from "@/components/ui/button";
import { Menu } from "lucide-react";
import { CollapseButton } from "@/components/sidebar-collapse-button";

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
    <html lang="de" suppressHydrationWarning>
      <body
        className={`${geistSans.variable} ${geistMono.variable} antialiased min-h-screen bg-background`}
      >
        <AuthProvider>
          <ThemeProvider
            attribute="class"
            defaultTheme="system"
            enableSystem
            disableTransitionOnChange
          >
            <div className="flex min-h-screen">
              {/* Sidebar for desktop */}
              <aside className="hidden bg-background border-r border-border md:flex md:flex-col shadow-sm h-screen sticky top-0 w-64 transition-all duration-300">
                <div className="p-4 pb-4 flex items-center justify-between">
                  <Link href="/" className="text-xl font-bold text-foreground whitespace-nowrap overflow-hidden">
                    <img
                      src="/Bivaro_Logo.png"
                      alt="Bivaro Logo"
                      className="h-12 w-auto"
                    />
                  </Link>
                  <CollapseButton />
                </div>
                <nav className="flex-1 px-4 py-2 overflow-y-auto">
                  <NavLinks />
                </nav>
              </aside>

              {/* Mobile sidebar trigger */}
              <div className="md:hidden fixed top-4 left-4 z-50">
                <Sheet>
                  <SheetTrigger asChild>
                    <Button variant="outline" size="icon" className="bg-background/80 backdrop-blur-sm">
                      <Menu className="h-5 w-5" />
                    </Button>
                  </SheetTrigger>
                  <SheetContent side="left" className="w-64 p-0">
                    <div className="flex flex-col h-full bg-background">
                      <div className="p-6 pb-4 border-b border-border">
                        <Link href="/" className="flex items-center text-2xl font-bold text-foreground">
                          <img
                            src="/Bivaro_Logo.png"
                            alt="Bivaro Logo"
                            className="h-12 w-auto"
                          />
                        </Link>
                      </div>
                      <nav className="flex-1 px-4 py-4">
                        <NavLinks />
                      </nav>
                    </div>
                  </SheetContent>
                </Sheet>
              </div>

              {/* Main content */}
              <div className="flex-1 flex flex-col min-h-screen w-full">
                <header className="bg-background/80 backdrop-blur-sm border-b border-border md:hidden sticky top-0 z-40">
                  <div className="container mx-auto py-4 px-4 sm:px-6 lg:px-8">
                    <div className="flex justify-between items-center">
                      <div>
                        <Link href="/" className="text-lg font-bold text-foreground">
                          <span className="bg-gradient-to-r from-blue-600 to-indigo-600 bg-clip-text text-transparent">
                            Bivaro
                          </span>
                        </Link>
                      </div>
                    </div>
                  </div>
                </header>
                
                <main className="flex-grow bg-background">
                  <div className="container mx-auto px-4 sm:px-6 lg:px-8 py-8">
                    {children}
                  </div>
                </main>
                
                <footer className="bg-background border-t border-border py-6">
                  <div className="container mx-auto px-4 sm:px-6 lg:px-8">
                    <p className="text-center text-muted-foreground text-sm">
                      &copy; {new Date().getFullYear()} Bivaro | 
                      Alle Beträge werden in Euro (€) angezeigt
                    </p>
                  </div>
                </footer>
              </div>
            </div>
          </ThemeProvider>
        </AuthProvider>
      </body>
    </html>
  );
}
