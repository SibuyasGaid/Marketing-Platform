import type { Metadata } from "next";
import localFont from "next/font/local";
import "./globals.css";

// Self-hosted (SIL OFL, see src/assets/fonts) so builds never depend on
// reaching Google Fonts. One variable family carries both UI and display type.
const schibstedGrotesk = localFont({
  src: "../assets/fonts/SchibstedGrotesk-Variable.woff2",
  variable: "--font-schibsted",
  weight: "400 900",
  display: "swap",
});

export const metadata: Metadata = {
  title: "Content Studio",
  description: "AI content generation and social publishing, with a human approval gate",
};

export default function RootLayout({
  children,
}: Readonly<{
  children: React.ReactNode;
}>) {
  return (
    <html lang="en" className={`${schibstedGrotesk.variable} h-full antialiased`}>
      <body className="min-h-full flex flex-col">{children}</body>
    </html>
  );
}
