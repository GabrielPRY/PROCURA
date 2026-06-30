import type { Metadata } from "next";
import "./globals.css";

export const metadata: Metadata = {
  title: "Procura AI Frontend Dev",
  description: "Frontend experimental para Procura AI"
};

export default function RootLayout({ children }: Readonly<{ children: React.ReactNode }>) {
  return (
    <html lang="es">
      <body>{children}</body>
    </html>
  );
}
