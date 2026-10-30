import { LogoMark } from "./logo-mark";

/** Opening curtain. CSS-only and self-dismissing: see `.boot` in globals.css. */
export function Boot() {
  return (
    <div aria-hidden className="boot">
      <div className="boot-inner flex items-center gap-5">
        <LogoMark className="size-14" motion="live" />
        <span className="num text-2xl">
          <span className="boot-count" />
        </span>
      </div>
    </div>
  );
}
