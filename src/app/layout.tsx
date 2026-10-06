import type { Metadata } from "next";
import "./globals.css";
import { Header } from "@/components/header";

export const metadata: Metadata = {
  title: "BigBrother — Who launched it?",
  description:
    "Every new coin on pump.fun, tagged by the dev's track record.",
};

export default function RootLayout({
  children,
}: {
  children: React.ReactNode;
}) {
  return (
    <html lang="en">
      <body>
        <Header />
        <main className="mx-auto max-w-[1400px] px-6 pb-16 pt-9">
          {children}
        </main>
      </body>
    </html>
  );
}
