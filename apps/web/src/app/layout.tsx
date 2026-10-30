import "./globals.css";
import { Geist, Geist_Mono, Newsreader } from "next/font/google";
import { AnimatedFavicon } from "../components/animated-favicon";

const geist = Geist({
  subsets: ["latin"],
  variable: "--font-ui",
  display: "swap",
});

const geistMono = Geist_Mono({
  subsets: ["latin"],
  weight: ["400"],
  variable: "--font-data",
  display: "swap",
});

// Variable with its optical-size axis: hairlines stay delicate at display sizes, sturdy when small.
const newsreader = Newsreader({
  subsets: ["latin"],
  style: ["normal", "italic"],
  axes: ["opsz"],
  variable: "--font-editorial",
  display: "swap",
});

export default function RootLayout({ children }: { children: React.ReactNode }) {
  return (
    <html lang="en" className={`${geist.variable} ${geistMono.variable} ${newsreader.variable}`}>
      <body>
        <AnimatedFavicon />
        {children}
      </body>
    </html>
  );
}
