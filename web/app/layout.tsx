import type { Metadata } from "next";
import { Newsreader, Fraunces, Spline_Sans_Mono } from "next/font/google";
import "./globals.css";

const newsreader = Newsreader({ subsets: ["latin"], display: "swap", variable: "--font-newsreader", style: ["normal", "italic"] });
const fraunces = Fraunces({ subsets: ["latin"], display: "swap", variable: "--font-fraunces", axes: ["opsz"], style: ["normal", "italic"] });
const splineMono = Spline_Sans_Mono({ subsets: ["latin"], display: "swap", variable: "--font-spline-mono" });

export const metadata: Metadata = {
  title: "LORE — Learning Orchestration Runtime Engine",
  description: "A headless LMS where the runtime owns progression. Frontend in the LECTURE design language.",
};

export default function RootLayout({ children }: { children: React.ReactNode }) {
  return (
    <html lang="en" className={`${newsreader.variable} ${fraunces.variable} ${splineMono.variable}`}>
      <body>{children}</body>
    </html>
  );
}
