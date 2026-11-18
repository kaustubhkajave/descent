# Descent: An Interactive Dive to the Bottom of the Ocean

A scroll-driven 3D experience built with three.js. Scrolling **is** the dive: you start above the waves at golden hour, break through the surface, and sink through the five zones of the ocean to the bottom of the Mariana Trench, 10,935 m down.

## The experience

| Zone | Depth | What happens on screen |
|---|---|---|
| Surface | 0 m | Animated shader ocean with a sun path on the water, under a dusk sky |
| Sunlight | 0–200 m | God rays from the surface, a school of fish, Snell's window glowing overhead |
| Twilight | 200–1,000 m | Light fades to blue; pulsing jellyfish with drifting tentacles |
| Midnight | 1,000–4,000 m | Total darkness. Bioluminescent particles light up around your cursor |
| Abyss | 4,000–6,000 m | Marine snow, anglerfish with flickering lures |
| Hadal | 6,000–10,935 m | Your torch switches on and sweeps the trench floor as you move the mouse |

A live depth gauge tracks metres, approximate pressure and the current zone the whole way down.

## How it's built

- **three.js r160** via ES modules from a CDN. No build step, no frameworks.
- **Custom GLSL shaders**: animated ocean surface (seen from above *and* below), volumetric-style god rays, jellyfish with Fresnel rims and pulsing bells, cursor-reactive bioluminescence, and an infinite wrapping marine-snow field
- **Procedural everything**: instanced fish, CPU-animated tentacles, a noise-displaced trench with scattered rocks. No downloaded models or textures.
- **Post-processing**: Unreal bloom whose strength rises with depth, ACES tone mapping, plus a custom film-grain and vignette pass
- **Scroll mapping**: section positions in the page are mapped to world depth, so the copy and the 3D always line up, at any screen size
- **Lighting by depth**: fog colour and density, sunlight, and the torch are interpolated through keyframes
- Editorial type (Fraunces), sticky story cards, a custom blend-mode cursor, a preloader and reveal animations
- Responsive, respects `prefers-reduced-motion`, uses lower particle counts on small or low-power devices, and falls back to a CSS gradient if WebGL is unavailable

## Files

```
index.html     story, sections and HUD markup
styles.css     layout, typography, cursor, gauge, reveals
js/main.js     renderer, post-processing, scroll-to-depth mapping, lighting keyframes, HUD
js/world.js    sky, water, rays, snow, fish, jellyfish, bioluminescence, anglerfish, trench
```

## Run locally

ES modules need a web server. From this folder:

```bash
npx serve .
```

## Host for free

**GitHub Pages:** push to a public repo, then go to **Settings → Pages**, choose **Deploy from a branch**, set the branch to `main` and the folder to `/ (root)`, and save.
**Netlify Drop:** drag the folder onto https://app.netlify.com/drop.

## Notes

Depth figures are approximate. Pressure is estimated as 1 atm plus 1 atm per 10 m of seawater. Add `?debug` to the URL to get `window.__descent` helpers for rendering frames on demand.
