/** Engraved plates in public/art, trimmed to their ink. Tools are credited in public/art/README.md. */
const plate = (name: keyof typeof SIZES) => ({
  src: `/art/${name}.webp`,
  width: SIZES[name][0],
  height: SIZES[name][1],
});

const SIZES = {
  panorama: [1559, 542],
  valley: [1672, 725],
  gates: [907, 1239],
  seal: [422, 422],
  depth: [400, 400],
  speed: [454, 454],
  atomic: [402, 402],
  balance: [482, 482],
  shield: [443, 443],
  open: [486, 486],
} as const;

export const art = {
  panorama: plate("panorama"),
  valley: plate("valley"),
  gates: plate("gates"),
  seal: plate("seal"),
  emblems: {
    depth: plate("depth"),
    speed: plate("speed"),
    atomic: plate("atomic"),
    balance: plate("balance"),
    shield: plate("shield"),
    open: plate("open"),
  },
} as const;
