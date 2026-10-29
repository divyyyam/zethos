import type { Metadata } from "next";
import { Compare } from "../../components/landing/compare";
import { Cta } from "../../components/landing/cta";
import { Features } from "../../components/landing/features";
import { Footer } from "../../components/landing/footer";
import { Hero } from "../../components/landing/hero";
import { HowItWorks } from "../../components/landing/how-it-works";
import { LandingShell } from "../../components/landing/landing-shell";
import { Nav } from "../../components/landing/nav";
import { Proof } from "../../components/landing/proof";
import { QuoteAnatomy } from "../../components/landing/quote-anatomy";
import { Safety } from "../../components/landing/safety";
import { landing } from "../../content/landing";
import { getStats } from "../../content/stats.mock";
import { getScenery } from "../../lib/scenery";

const { meta } = landing;

export const metadata: Metadata = {
  metadataBase: new URL(meta.siteUrl),
  title: meta.title,
  description: meta.description,
  openGraph: {
    type: "website",
    title: meta.title,
    description: meta.description,
    siteName: "Zethos",
    images: [{ url: meta.ogImage, width: 1200, height: 630, alt: meta.title }],
  },
  twitter: {
    card: "summary_large_image",
    title: meta.title,
    description: meta.description,
    images: [meta.ogImage],
  },
};

export default async function LandingPage() {
  const [stats, scenery] = [await getStats(), getScenery()];
  return (
    <LandingShell>
      <Nav />
      <main className="relative z-10 mb-[var(--footer-h)] bg-canvas">
        <Hero scenery={scenery} />
        <Proof stats={stats} scenery={scenery} />
        <Compare />
        <HowItWorks scenery={scenery} />
        <QuoteAnatomy />
        <Features />
        <Safety />
        <Cta scenery={scenery} />
      </main>
      <Footer />
    </LandingShell>
  );
}
