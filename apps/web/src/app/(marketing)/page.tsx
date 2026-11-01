import type { Metadata } from "next";
import { Boot } from "../../components/landing/boot";
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
import { LandingWorld } from "../../components/landing/world";
import { landing } from "../../content/landing";

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
  const preview = !process.env.NEXT_PUBLIC_ENGINE_URL;
  return (
    <LandingShell>
      <Boot />
      <LandingWorld />
      <Nav />
      <main>
        <Hero />
        <Proof />
        {preview ? (
          <>
            <HowItWorks />
            <Compare />
            <QuoteAnatomy />
          </>
        ) : (
          <section id="how-it-works" className="relative sect py-section">
            <h2 className="t-title">Inspect a real signed price</h2>
            <p className="lead mt-4">
              Open Desk to see the current venues, spread terms, vault limits and local signature
              checks for your own quote.
            </p>
            <a className="mt-6 inline-block underline" href="/desk#test-the-desk">
              Test the desk
            </a>
          </section>
        )}
        <Features />
        <Safety />
        <Cta showIllustration={preview} />
      </main>
      <Footer />
    </LandingShell>
  );
}
