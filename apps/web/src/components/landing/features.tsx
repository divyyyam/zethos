import { ArrowUpRight } from "lucide-react";
import Image from "next/image";
import { art } from "../../content/art";
import { landing } from "../../content/landing";
import { Reveal, RiseHeading } from "./primitives";

/** A set-in-type index rather than a card grid, each row headed by its engraved emblem. */
export function Features() {
  const { features, chapters } = landing;
  const [lead, accent] = features.headline.split(" *");
  return (
    <section
      aria-label={chapters.features}
      data-world="0.84,0,0,1|0.88,0,0,1"
      data-chapter={chapters.features}
      className="relative sect bg-white pt-section"
    >
      <Reveal>
        <p className="eyebrow text-fg-soft">{features.kicker}</p>
      </Reveal>
      <RiseHeading
        lines={[lead ?? "", `*${accent ?? ""}`]}
        className="display t-section mt-4 text-fg"
      />
      <ol className="mt-head border-b border-line">
        {features.items.map((item) => {
          const link = "link" in item ? item.link : null;
          const emblem = art.emblems[item.art];
          return (
            <li key={item.title}>
              <Reveal y={16}>
                <div className="group grid grid-cols-[72px_1fr] items-center gap-x-5 gap-y-2 border-t border-line py-6 md:grid-cols-[112px_minmax(0,1.2fr)_minmax(0,1fr)] md:gap-x-10">
                  <Image
                    src={emblem.src}
                    width={emblem.width}
                    height={emblem.height}
                    sizes="112px"
                    alt=""
                    className="plate size-[72px] transition-transform duration-700 ease-expo group-hover:scale-110 group-hover:-rotate-3 md:size-[112px]"
                  />
                  <h3 className="display text-[max(2rem,calc(var(--cw)*0.039))] text-fg transition-transform duration-700 ease-expo group-hover:translate-x-2 group-hover:italic">
                    {item.title}
                  </h3>
                  <p className="col-span-2 text-fg-soft md:col-span-1 md:text-[18px]">
                    {item.body}
                    {link && (
                      <a
                        href={link.href}
                        data-cursor="hover"
                        className="ml-2 inline-flex items-center gap-1 font-medium whitespace-nowrap text-fg underline decoration-line underline-offset-4 transition-colors hover:decoration-current"
                      >
                        {link.label}
                        <ArrowUpRight aria-hidden className="size-4" />
                      </a>
                    )}
                  </p>
                </div>
              </Reveal>
            </li>
          );
        })}
      </ol>
    </section>
  );
}
