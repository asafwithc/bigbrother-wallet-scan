import type { Metadata } from "next";
import "./globals.css";
import { Header } from "@/components/header";
import { Main } from "@/components/main";

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
        <Main>{children}</Main>
      </body>
    </html>
  );
}
