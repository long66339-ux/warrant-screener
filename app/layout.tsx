import type { Metadata } from "next";
import "./globals.css";

export const metadata: Metadata = {
  title: "台股權證篩選器",
  description: "台股權證初篩、IV／Delta 評分與造市品質比較工具",
  icons: {
    icon: "/favicon.svg",
    shortcut: "/favicon.svg",
  },
};

export default function RootLayout({
  children,
}: Readonly<{
  children: React.ReactNode;
}>) {
  return (
    <html lang="zh-Hant">
      <body className="antialiased">{children}</body>
    </html>
  );
}
