/** Engraved plates in public/art. Generated with Codex and Antigravity; see public/art/README.md. */
const square = (name: string) => ({ src: `/art/${name}.webp`, width: 512, height: 512 });

export const art = {
  panorama: { src: "/art/panorama.webp", width: 1672, height: 941 },
  valley: { src: "/art/valley.webp", width: 1672, height: 941 },
  gates: { src: "/art/gates.webp", width: 1024, height: 1365 },
  seal: square("seal"),
  emblems: {
    depth: square("depth"),
    speed: square("speed"),
    atomic: square("atomic"),
    balance: square("balance"),
    shield: square("shield"),
    open: square("open"),
  },
} as const;
