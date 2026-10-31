"use client";
import { ArrowUpRight } from "lucide-react";
import type { ReactNode } from "react";
import { Magnetic } from "../../landing/magnetic";

/** The landing's primary pill and rolling arrow, as a button. */
export function ActionPill({ onClick, children }: { onClick: () => void; children: ReactNode }) {
  return (
    <Magnetic strength={0.22}>
      <button
        type="button"
        onClick={onClick}
        data-cursor="hover"
        className="group inline-flex h-14 items-center gap-5 rounded-full bg-fg pr-2 pl-6 text-[15px] font-medium text-inverse transition-transform duration-500 ease-expo active:scale-[0.97]"
      >
        <span>{children}</span>
        <span className="relative flex size-10 items-center justify-center overflow-hidden rounded-full bg-inverse text-fg">
          <ArrowUpRight
            aria-hidden
            className="size-[45%] transition-transform duration-500 ease-expo group-hover:translate-x-[180%] group-hover:-translate-y-[180%]"
          />
          <ArrowUpRight
            aria-hidden
            className="absolute size-[45%] -translate-x-[180%] translate-y-[180%] transition-transform duration-500 ease-expo group-hover:translate-x-0 group-hover:translate-y-0"
          />
        </span>
      </button>
    </Magnetic>
  );
}
