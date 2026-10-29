# Zethos scenery

The page ships with original SVG/CSS fallbacks, so all of these images are optional.
Drop the final artwork here using these exact filenames, then restart the dev server
or rebuild. A missing or unreadable image retains its vector fallback.

| Filename         | Recommended size | Treatment                                               |
| ---------------- | ---------------- | ------------------------------------------------------- |
| `hero-day.webp`  | 2400 × 1200      | Daytime landscape. Fade the top third to pure white.    |
| `cloud-1.png`    | 800 × 360        | Peach/lavender cloud, transparent background.           |
| `cloud-2.png`    | 800 × 360        | A second cloud, transparent background.                 |
| `cloud-3.png`    | 800 × 360        | A smaller cloud variant, transparent background.        |
| `pines.png`      | 800 × 960        | Pine cluster on a grassy mound, transparent background. |
| `cta-night.webp` | 2400 × 1500      | Moonlit version of the same landscape.                  |

Keep the important landscape details in the central area so they survive mobile
cropping. Export WebP scenery at a quality that keeps each full-width image under
roughly 400 KB. Keep transparent PNG edges clean. Images are decorative and use
empty alt text. The hero image is preloaded; all other images load lazily.

The current files are original artwork generated for this project with the agy image generator.
Clouds and pines were generated on chroma-key backgrounds and keyed to transparent PNG;
the two landscapes were encoded to WebP with the top edge forced to white. Replace them freely.
