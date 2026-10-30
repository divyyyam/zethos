"use client";

import { useEffect, useRef } from "react";
import { FRAG, paletteAt, VERT } from "./world-shader";

/** Everything the page can ask of the world. Mutated in place by its owner; read once per frame. */
export interface WorldState {
  /** Time of day, 0 dawn to 1 night. */
  day: number;
  /** Camera height: positive lifts the horizon out of frame. */
  cam: number;
  /** 0 ridgelines, 1 order-book depth curve. */
  morph: number;
  /** 0 no water, 1 full lake. */
  lake: number;
  /** Nothing can see the canvas right now: skip drawing. */
  idle?: boolean;
}

const UNIFORMS = [
  "uRes",
  "uTime",
  "uCam",
  "uMorph",
  "uNight",
  "uLake",
  "uPointer",
  "uSunPos",
  "uSkyTop",
  "uSkyMid",
  "uSkyLow",
  "uFar",
  "uNear",
  "uSun",
  "uBid",
  "uAsk",
] as const;

function compile(gl: WebGL2RenderingContext, type: number, source: string) {
  const shader = gl.createShader(type);
  if (!shader) return null;
  gl.shaderSource(shader, source);
  gl.compileShader(shader);
  return gl.getShaderParameter(shader, gl.COMPILE_STATUS) ? shader : null;
}

/**
 * Fixed full-screen renderer. The owner passes a state ref and this draws it every frame, easing
 * toward the target so scroll scrubbing never reads as stepped. Resolution adapts to the machine:
 * if frames run long the internal scale drops, which a soft painted scene hides well. Pauses when
 * the tab is hidden; draws one still frame under prefers-reduced-motion. No WebGL2 leaves the
 * CSS fallback behind the canvas untouched.
 */
export function WorldCanvas({
  state,
  className,
}: {
  state: React.RefObject<WorldState>;
  className?: string;
}) {
  const ref = useRef<HTMLCanvasElement>(null);

  useEffect(() => {
    const canvas = ref.current;
    if (!canvas) return;
    const gl = canvas.getContext("webgl2", {
      antialias: false,
      alpha: false,
      depth: false,
      stencil: false,
      powerPreference: "high-performance",
    });
    if (!gl) return;
    const vert = compile(gl, gl.VERTEX_SHADER, VERT);
    const frag = compile(gl, gl.FRAGMENT_SHADER, FRAG);
    const program = gl.createProgram();
    if (!vert || !frag || !program) return;
    gl.attachShader(program, vert);
    gl.attachShader(program, frag);
    gl.linkProgram(program);
    if (!gl.getProgramParameter(program, gl.LINK_STATUS)) return;
    // biome-ignore lint/correctness/useHookAtTopLevel: WebGL's useProgram, not a React hook.
    gl.useProgram(program);

    const buffer = gl.createBuffer();
    gl.bindBuffer(gl.ARRAY_BUFFER, buffer);
    gl.bufferData(gl.ARRAY_BUFFER, new Float32Array([-1, -1, 3, -1, -1, 3]), gl.STATIC_DRAW);
    const position = gl.getAttribLocation(program, "aPos");
    gl.enableVertexAttribArray(position);
    gl.vertexAttribPointer(position, 2, gl.FLOAT, false, 0, 0);
    const u = Object.fromEntries(
      UNIFORMS.map((name) => [name, gl.getUniformLocation(program, name)]),
    ) as Record<(typeof UNIFORMS)[number], WebGLUniformLocation | null>;

    const reduced = window.matchMedia("(prefers-reduced-motion: reduce)").matches;
    let scale = Math.min(window.devicePixelRatio || 1, 1.5);
    const resize = () => {
      const width = Math.max(1, Math.round(canvas.clientWidth * scale));
      const height = Math.max(1, Math.round(canvas.clientHeight * scale));
      if (canvas.width !== width || canvas.height !== height) {
        canvas.width = width;
        canvas.height = height;
      }
      gl.viewport(0, 0, width, height);
    };
    resize();
    const observer = new ResizeObserver(resize);
    observer.observe(canvas);

    const pointerTarget = { x: 0, y: 0 };
    const onPointer = (event: PointerEvent) => {
      if (event.pointerType !== "mouse") return;
      pointerTarget.x = (event.clientX / window.innerWidth) * 2 - 1;
      pointerTarget.y = -((event.clientY / window.innerHeight) * 2 - 1);
    };
    window.addEventListener("pointermove", onPointer, { passive: true });

    const live = { ...state.current };
    const pointer = { x: 0, y: 0 };
    let raf = 0;
    let last = 0;
    let slow = 0;
    let fast = 0;
    const start = performance.now();

    const draw = (now: number) => {
      const dt = Math.min(0.05, last ? (now - last) / 1000 : 0.016);
      const ease = reduced ? 1 : 1 - Math.exp(-dt * 7);
      const target = state.current;
      live.day += (target.day - live.day) * ease;
      live.cam += (target.cam - live.cam) * ease;
      live.morph += (target.morph - live.morph) * ease;
      live.lake += (target.lake - live.lake) * ease;
      pointer.x += (pointerTarget.x - pointer.x) * (reduced ? 0 : 1 - Math.exp(-dt * 3));
      pointer.y += (pointerTarget.y - pointer.y) * (reduced ? 0 : 1 - Math.exp(-dt * 3));

      if (target.idle) {
        last = 0;
        raf = requestAnimationFrame(draw);
        return;
      }

      const p = paletteAt(live.day);
      gl.uniform2f(u.uRes, canvas.width, canvas.height);
      gl.uniform1f(u.uTime, reduced ? 12 : (now - start) / 1000 + 12);
      gl.uniform1f(u.uCam, live.cam);
      gl.uniform1f(u.uMorph, live.morph);
      gl.uniform1f(u.uLake, live.lake);
      gl.uniform1f(u.uNight, p.night);
      gl.uniform2f(u.uPointer, pointer.x, pointer.y);
      gl.uniform2fv(u.uSunPos, p.sunPos);
      gl.uniform3fv(u.uSkyTop, p.skyTop);
      gl.uniform3fv(u.uSkyMid, p.skyMid);
      gl.uniform3fv(u.uSkyLow, p.skyLow);
      gl.uniform3fv(u.uFar, p.far);
      gl.uniform3fv(u.uNear, p.near);
      gl.uniform3fv(u.uSun, p.sun);
      gl.uniform3fv(u.uBid, p.bid);
      gl.uniform3fv(u.uAsk, p.ask);
      gl.drawArrays(gl.TRIANGLES, 0, 3);

      // Adaptive resolution, judged over about a second of frames so one hitch doesn't trigger it.
      if (last) {
        const ms = now - last;
        slow = ms > 24 ? slow + 1 : Math.max(0, slow - 1);
        fast = ms < 18 ? fast + 1 : 0;
        if (slow > 30 && scale > 0.5) {
          scale = Math.max(0.5, scale * 0.8);
          slow = 0;
          resize();
        } else if (fast > 360 && scale < Math.min(window.devicePixelRatio || 1, 1.5)) {
          scale = Math.min(Math.min(window.devicePixelRatio || 1, 1.5), scale * 1.1);
          fast = 0;
          resize();
        }
      }
      last = now;
      canvas.dataset.ready = "true";
      raf = requestAnimationFrame(draw);
    };

    const onVisibility = () => {
      cancelAnimationFrame(raf);
      last = 0;
      if (!document.hidden) raf = requestAnimationFrame(draw);
    };
    document.addEventListener("visibilitychange", onVisibility);
    raf = requestAnimationFrame(draw);

    return () => {
      cancelAnimationFrame(raf);
      observer.disconnect();
      window.removeEventListener("pointermove", onPointer);
      document.removeEventListener("visibilitychange", onVisibility);
    };
  }, [state]);

  return <canvas ref={ref} aria-hidden className={className} />;
}
