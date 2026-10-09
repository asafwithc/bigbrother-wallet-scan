import type { Metadata } from "next";
import "./globals.css";
import { Header } from "@/components/header";
import { Main } from "@/components/main";
import { MatrixRain } from "@/components/matrix-rain";

export const metadata: Metadata = {
  title: "BigBrother — Check the dev before you ape",
  description:
    "See who is behind a pump.fun coin before you buy. Every dev we track gets a rank from their record: the ones who ship, and the ones who farm you.",
};

export default function RootLayout({
  children,
}: {
  children: React.ReactNode;
}) {
  return (
    <html lang="en">
      <body>
        <MatrixRain />
        <Header />
        <Main>{children}</Main>
      </body>
    </html>
  );
}
