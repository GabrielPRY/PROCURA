import type { Metadata } from "next";
import "./globals.css";

export const metadata: Metadata = {
  title: "Proyelec Int — Sistema de Procura",
  description: "Frontend para Sistema de Procura"
};

export default function RootLayout({ children }: Readonly<{ children: React.ReactNode }>) {
  return (
    <html lang="es">
      <body>{children}</body>
    </html>
  );
}
