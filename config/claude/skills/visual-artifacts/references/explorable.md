# Explorable: learn by manipulating a model

Declare `<meta name="va:format" content="explorable">`, so `render_check.py` knows the page is not a Guide or a lesson.

Before reaching for 3D, apply "When to use 3D" in SKILL.md. Most explorables are
2D: a simulation on a canvas, a chart, a step-through diagram.

The reader changes inputs, watches a model respond, forms an intuition, then
reads why it happens. The mechanism is the content. Prose supports it.

## Page structure

1. **Top bar.** The name, a one-line "what this shows", and Reset.
2. **Map strip** above the lab: the whole pipeline in one row of named blocks
   and wires (what the model is, why it exists, what it feeds), with the part
   the lab simulates highlighted. Map before mechanics.
3. **The lab: the first screen.** The stage (3D canvas, simulation or chart)
   takes about two thirds of the width. A control rail takes the rest and
   stacks under the stage below 900 px. The stage opens already running in an
   interesting state, never empty.
   - **Control rail.** At most six visible controls, grouped. Each shows its
     live value and a one-line hint about what it does. Put scenario presets
     in a segmented control at the top ("Bowl / Ravine / Saddle").
   - **Readouts.** Two to four live numbers (`.stat`) that the story is
     about, such as step count, current loss, or distance to the minimum.
   - **Transport.** Play/Pause, Step, Reset, and an optional speed control.
4. **Guided tour** beside or directly under the stage: four to six steps
   (`.tour`), one idea each, climbing the ladder. Each step:
   - sets the lab state (preset + parameters) **but does not run it yet**;
   - asks **"Your call"** first: a `.decide data-kind="decide"` prediction
     ("Set η = 0.09 on the Ravine. What will SGD do?");
   - runs once he has chosen, and says "Notice: …" next to the result;
   - ends with one check question (`.decide`) on the idea, ideally on a
     different case than the one just shown.
   Mark tour buttons done / current / locked with `Kit.mark(button, state)`
   (a check or lock icon plus a screen-reader word, as in the docs sidebar),
   with "Open anyway". Free play always stays available.
5. **Live chart(s)** under the stage: the quantity over time (loss by step),
   one series per compared thing, at most four lines (`Kit.lineChart`, which
   adds a dash pattern per series).
6. **Below the lab:** the ladder card, two to four short explanation blocks
   with KaTeX math (`.tex`), and, for a systems topic, a Go counterpart
   (`.pair`) beside the primitive.

## Interaction rules

- **Let the eye move in one direction.** Show a process as one timeline read
  top to bottom (or one pipeline read left to right), with lanes for the
  places things happen and one plain-English sentence per step. A grid of
  separate panels (queue card, log card, memory card…) makes the reader hunt
  for what changed; Sean found that hard to follow. Put meters and status in
  one strip above the timeline.

- Prefer direct manipulation over forms: drag the start point, orbit the
  camera, scrub through time.
- Respond within 100 ms. Debounce expensive recomputes by about 120 ms, and
  show the stale state dimmed meanwhile.
- When a control changes something, name what changed. Use an inline note or
  a highlight on the affected element.
- Keyboard: Space plays or pauses, R resets, ← and → step. Show the keys once
  in a hint row.
- Under `prefers-reduced-motion`, start paused and advance only on Step.
- Remember the last preset and parameters with `Kit.store` (a convenience,
  never required).
- Simulation code is pure and deterministic: seed any randomness, so a tour
  step always shows the same thing.

## 3D with three.js

Use an import map pinned to one version and render on demand:

```html
<script type="importmap">{"imports": {
  "three": "https://cdn.jsdelivr.net/npm/three@0.170.0/build/three.module.min.js",
  "three/addons/": "https://cdn.jsdelivr.net/npm/three@0.170.0/examples/jsm/"
}}</script>
<script data-va="kit.js"></script>
<script type="module">
import * as THREE from 'three';
import { OrbitControls } from 'three/addons/controls/OrbitControls.js';

const stage = document.getElementById('stage');          // a sized box: aspect-ratio or explicit height
// Probe first: constructing a renderer without a context logs three.js errors even inside try/catch.
const probe = document.createElement('canvas');
const hasGL = !!(probe.getContext('webgl2') || probe.getContext('webgl'));
let renderer = null;
if (hasGL) { try { renderer = new THREE.WebGLRenderer({ antialias: true, alpha: true }); } catch (e) { /* no WebGL */ } }
if (renderer) init3D(renderer); else drawFallback(stage);  // fallback: the flat view + one line saying why

function init3D(renderer) {
  renderer.setPixelRatio(Math.min(devicePixelRatio, 2));
  stage.appendChild(renderer.domElement);
  renderer.domElement.style.cssText = 'width:100%;height:100%;display:block;touch-action:none';

  const scene = new THREE.Scene();                         // transparent background: the .fig surface shows through
  const camera = new THREE.PerspectiveCamera(38, 1, 0.1, 200);
  camera.position.set(7, 6, 7);
  const controls = new OrbitControls(camera, renderer.domElement);
  controls.enableDamping = true;

  let queued = false;
  const requestRender = () => {
    if (queued) return; queued = true;
    requestAnimationFrame(() => { queued = false; controls.update(); renderer.render(scene, camera); });
  };
  controls.addEventListener('change', requestRender);      // damping keeps firing 'change' until it settles

  // a lost context (GPU reset, tab in background) gets 2 s to come back, then the flat view takes over
  renderer.domElement.addEventListener('webglcontextlost', e => {
    e.preventDefault();
    const t = setTimeout(() => drawFallback(stage), 2000);
    renderer.domElement.addEventListener('webglcontextrestored', () => { clearTimeout(t); requestRender(); }, { once: true });
  });

  scene.add(new THREE.HemisphereLight(0xffffff, 0x8a8478, 1.2));
  const sun = new THREE.DirectionalLight(0xffffff, 1.5); sun.position.set(5, 9, 4); scene.add(sun);

  // Colours come from tokens, so the scene follows the viewer's theme.
  const tok = name => new THREE.Color(Kit.css(name));
  const applyTheme = () => { /* e.g. surfaceMat.color = tok('--d-sky'); line.material.color = tok('--s2'); */ };
  applyTheme();
  Kit.onTheme(() => { applyTheme(); requestRender(); });

  new ResizeObserver(() => {
    const w = stage.clientWidth, h = stage.clientHeight;
    renderer.setSize(w, h, false); camera.aspect = w / h; camera.updateProjectionMatrix(); requestRender();
  }).observe(stage);
}
</script>
```

- **Render on demand.** Run a continuous loop (`Kit.loop`) only while the
  simulation plays. Otherwise render on control change.
- **Surfaces.** Use `MeshStandardMaterial` with roughness around 0.85 and no
  metalness. Colour by height with a one-hue ramp that stays light: from
  `--d-sky` at the minimum to about a 55% mix toward `--s1` at the maximum. A
  ramp that ends at a series colour hides the line drawn in that colour. Draw
  contour lines or a wireframe overlay in `--line-strong`, and give every
  trajectory a thin `--surface` halo underneath. Avoid rainbow maps.
- **Thick lines.** WebGL lines draw 1 px wide. For trajectories, use `Line2`
  with `LineMaterial` (`three/addons/lines/…`; set `resolution` on resize), or
  a thin `TubeGeometry`. Mark the current position with a small sphere that
  wears the series colour, and the start point with a ring.
- **Labels.** Use HTML overlays positioned with `vector.project(camera)`, or
  `CSS2DRenderer`, styled with claude.css classes. Never put text in a texture.
- **Fallback.** If WebGL fails, show a 2D canvas version (a top-down contour
  map works for surfaces) and one line explaining why.
- **Orientation.** Show axis labels with units, and a "drag to orbit · scroll
  to zoom" hint that fades after the first interaction.

## 2D simulations on canvas

Size the canvas by `devicePixelRatio`, read colours with `Kit.css` on every
redraw, and repaint on `Kit.onTheme`. Draw at 60 fps only while playing.

## Data in explorables

Follow `dataviz`. A time series uses `Kit.lineChart` with at most four series
(`--s1`–`--s4`), the legend on, and the series the story is about drawn last
so it sits on top. Readouts are stat tiles, not charts.

## Checklist

- [ ] A map strip shows the whole pipeline before the lab.
- [ ] Each tour step asks for a prediction before running, and ends with a check question.
- [ ] Tour steps show done / current / locked.
- [ ] The first screen shows the model running in an interesting state.
- [ ] Every control changes something the tour or a hint tells you to notice.
- [ ] The tour has four to six steps that set the lab state and climb the ladder.
- [ ] Play, Step, Reset and keyboard controls work; reduced motion starts paused.
- [ ] 3D: the camera orbits, the scene re-themes, the fallback exists, and labels carry units.
- [ ] The chart uses s1–s4, has a legend, and hover shows exact values.
- [ ] At 390 px the rail stacks under the stage and nothing scrolls sideways.
