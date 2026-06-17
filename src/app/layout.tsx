import type { Metadata } from "next";
import "./globals.css";

export const metadata: Metadata = {
  title: "0Gate · Decentralized Fortress Arena",
  description:
    "Forge a password fortress, stake a bounty on-chain, and outsmart the AI siege. Built on 0G.",
};

export default function RootLayout({ children }: { children: React.ReactNode }) {
  return (
    <html lang="en">
      <head>
        <link rel="preconnect" href="https://fonts.googleapis.com" />
        <link
          href="https://fonts.googleapis.com/css2?family=Space+Grotesk:wght@400;500;600;700&family=JetBrains+Mono:wght@400;500;700&family=Sora:wght@600;700;800&display=swap"
          rel="stylesheet"
        />
      </head>
      <body>{children}</body>
    </html>
  );
}
