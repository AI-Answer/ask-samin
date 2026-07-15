import type { Metadata } from "next";
import "./globals.css";

export const metadata: Metadata = {
  title: "Community Knowledge MCP",
  description: "Open read-only MCP server for course community knowledge."
};

export default function RootLayout({ children }: { children: React.ReactNode }) {
  return (
    <html lang="en">
      <body>{children}</body>
    </html>
  );
}
