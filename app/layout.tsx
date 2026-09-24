import type { Metadata } from "next";
import "./globals.css";

export const metadata: Metadata = {
  title: "Discord Slash Command Bot",
  description: "Discord Slash Command Bot application",
};

export default function RootLayout({
  children,
}: {
  children: React.ReactNode;
}) {
  return (
    <html lang="en">
      <body>{children}</body>
    </html>
  );
}
