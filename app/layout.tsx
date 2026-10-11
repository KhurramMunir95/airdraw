import type { Metadata } from "next";
import "./globals.css";

export const metadata: Metadata = {
  title: "AirDraw Studio — Create with gestures",
  description: "Draw in the air with your webcam. Hand and face tracking, neon brushes, handwriting recognition, and instant exports."
};

export default function RootLayout({ children }: Readonly<{ children: React.ReactNode }>) {
  return <html lang="en"><body>{children}</body></html>;
}
