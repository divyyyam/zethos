import { landing } from "../../content/landing";
import { PrimaryButton, Reveal, RiseHeading } from "./primitives";

/** The last window: moon and range above, the argument set on the water, one thing left to do. */
export function Cta() {
  const { cta, chapters } = landing;
  const [lead, accent] = cta.headline.split(" *");
  return (
    <section
      aria-label={chapters.cta}
      data-world="1,-0.05,0,1|1,-0.05,0,1"
      data-chapter={chapters.cta}
      className="relative sect overflow-clip pt-section"
    >
      <div className="world-window ink-light flex min-h-[calc(100svh-var(--spacing-chrome)-var(--spacing-edge))] flex-col justify-end overflow-clip">
        <div
          aria-hidden
          className="pointer-events-none absolute inset-x-0 bottom-0 h-[70%] bg-[linear-gradient(to_top,rgb(5_5_27/0.82),rgb(5_5_27/0.45)_55%,transparent)]"
        />
        <div className="relative p-inset ">
          <RiseHeading
            lines={[lead ?? "", `*${accent ?? ""}`]}
            className="display t-hero text-fg"
          />
          <Reveal
            index={2}
            className="mt-6 grid items-end gap-6 border-t border-line pt-6 md:grid-cols-[minmax(0,1fr)_minmax(0,1fr)_auto] md:gap-block"
          >
            <div>
              <p className="num text-[clamp(1.75rem,3vw,2.75rem)]">{cta.argument.value}</p>
              <p className="mt-2 text-[15px] text-fg-soft">
                {cta.argument.label}. {cta.argumentNote}
              </p>
            </div>
            <p className="lead max-w-[420px] text-fg-soft">{cta.sub}</p>
            <PrimaryButton href={cta.primary.href} size="lg">
              {cta.primary.label}
            </PrimaryButton>
          </Reveal>
        </div>
      </div>
    </section>
  );
}
