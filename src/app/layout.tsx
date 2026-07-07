import type { Metadata } from "next";
import { Geist, Fraunces, JetBrains_Mono } from "next/font/google";
import "./globals.css";

// White Rabbit typography (PRD §3 / §13): Fraunces (serif display/headings) +
// JetBrains Mono (mono/code), with a sans body set to `font-sans antialiased`.
const fontSans = Geist({
  variable: "--font-rr-sans",
  subsets: ["latin"],
});

const fontSerif = Fraunces({
  variable: "--font-rr-serif",
  subsets: ["latin"],
});

const fontMono = JetBrains_Mono({
  variable: "--font-rr-mono",
  subsets: ["latin"],
});

export const metadata: Metadata = {
  title: "Rogue Raise",
  description:
    "White Rabbit's community build event — raise something that lasts.",
};

export default function RootLayout({
  children,
}: Readonly<{
  children: React.ReactNode;
}>) {
  return (
    <html
      lang="en"
      className={`${fontSans.variable} ${fontSerif.variable} ${fontMono.variable} h-full antialiased`}
    >
      <body className="min-h-full font-sans">{children}</body>
    </html>
  );
}
