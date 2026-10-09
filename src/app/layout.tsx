import type { Metadata } from "next";
import { TooltipProvider } from "@/components/ui/tooltip";
import "./globals.css";

export const metadata: Metadata = {
  title: "PnL Replayer · Birdeye Data",
  description: "Replay any Solana wallet's trades and audit its PnL, built entirely on the Birdeye Data API.",
};

export default function RootLayout({ children }: Readonly<{ children: React.ReactNode }>) {
  return (
    <html lang="en" className="dark">
      <head>
        <link rel="preload" href="/brand/fonts/Geist-VariableFont_wght.ttf" as="font" type="font/ttf" crossOrigin="anonymous" />
      </head>
      <body>
        <TooltipProvider delayDuration={250}>{children}</TooltipProvider>
      </body>
    </html>
  );
}
