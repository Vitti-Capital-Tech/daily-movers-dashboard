import type { Metadata } from "next";
import { Geist, Geist_Mono } from "next/font/google";
import "./globals.css";

import { Toaster } from "@/components/ui/sonner";

const geistSans = Geist({
  variable: "--font-geist-sans",
  subsets: ["latin"],
});

const geistMono = Geist_Mono({
  variable: "--font-geist-mono",
  subsets: ["latin"],
});

export const metadata: Metadata = {
  title: "Daily Movers — Vitti Capital",
  description:
    "Searchable archive of Vitti Capital Daily Mover research, by company.",
};

/**
 * Deliberately minimal — the signed-in chrome (sidebar, user menu) lives in
 * `(app)/layout.tsx` so /login renders without it.
 */
export default function RootLayout({ children }: LayoutProps<"/">) {
  return (
    // `dark` is set here deliberately: every mock-up for this dashboard is a
    // dark UI. Swap to a theme toggle later if it's wanted.
    <html
      lang="en"
      className={`dark ${geistSans.variable} ${geistMono.variable} h-full antialiased`}
    >
      <body className="min-h-full flex flex-col bg-background text-foreground">
        {children}
        <Toaster />
      </body>
    </html>
  );
}
