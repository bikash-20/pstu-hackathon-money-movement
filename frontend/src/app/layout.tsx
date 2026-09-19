import type { Metadata } from "next";
import { Fira_Sans, Fira_Code } from "next/font/google";
import "./globals.css";

const firaSans = Fira_Sans({
  variable: "--font-fira-sans",
  subsets: ["latin"],
  weight: ["300", "400", "500", "600", "700"],
});

const firaCode = Fira_Code({
  variable: "--font-fira-code",
  subsets: ["latin"],
  weight: ["400", "500", "600", "700"],
});

export const metadata: Metadata = {
  title: "PSTU Wallet — Money Movement",
  description: "Reliable, concurrent digital wallet for the PSTU IT Carnival 2026 hackathon",
};

export default function RootLayout({ children }: { children: React.ReactNode }) {
  return (
    <html
      lang="en"
      className={`${firaSans.variable} ${firaCode.variable} antialiased`}
    >
      <body className="min-h-full flex flex-col bg-[#020617] text-[#F8FAFC]">{children}</body>
    </html>
  );
}