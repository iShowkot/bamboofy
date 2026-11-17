# Banshala · বাঁশালা

**A realtime lab for bamboo and local-material architecture: from a wild idea to a scale model to a site.**

*Banshala* = *bansh* (বাঁশ, bamboo) + *chala* (চালা, the curved Bengal hut roof that became monumental architecture), and also *shala* (শালা, hall / workshop).

Design a structure with parametric generators or pole by pole, set it on a real hillside with a jhiri (hill stream), throw the forces of the hills at it, and watch where it works, where it struggles and how it breaks. Then print a scale-model kit and a site cut list.

## What it does

- **Parametric generators**: bundled arch vault (with twist and rise-wave), gridshell dome, hypar saddle, hyperboloid (Shukhov) tower, cantilever deck. Every slider re-solves the physics live.
- **Pole by pole**: draw culms on a work plane or straight onto the ground, set species, bundle count, joints and foundations per member and node.
- **Materials**:
  - Bangladeshi and Balinese bamboo (Borak, Muli, Dendrocalamus, Petung, Tali) and timber (Sal, Gamari).
  - Every value is editable and saved with the design, so field-test numbers can replace the defaults.
- **Joints as real objects**: fish-mouth + bolt + mortar, pegs, lashing (bet / rattan), bundle clamps and steel plates, each with a capacity and build instructions. A no-metal mode is included.
- **Forces of the hills**:
  - self-weight, people, a waterlogged monsoon roof
  - wind from any compass direction with hill-crest exposure
  - an earthquake push
  - a jhiri flash flood with debris
  - a landslide (a plinth washes out or sinks)
- **Break it**: ramps every force until something gives, then replays the failure order through to collapse.
- **Views**:
  - Drafting-table mode and an atmospheric Presence mode (light, mist, rain).
  - A stress heat map that overlays either view.
  - Exaggerated sag and a first-person "walk inside" view.
- **Make it**:
  - a printable bamboo-skewer model kit at 1:10–1:100 (plan, two elevations, numbered poles, stick shopping list, cut list in mm)
  - a site cut list (CSV)
  - a bill of materials with stock-culm optimisation (CSV)
  - a PNG snapshot
  - a `.bamboo.json` design file
- **Works offline** once loaded, for hillsides with no signal.

## Honest physics

Banshala uses a linear-elastic 3D space-frame solver (6 DOF per joint, skyline Cholesky with reverse Cuthill–McKee ordering), with checks for crushing, tension, bending, Euler buckling, joint capacity and foundation capacity. It is **intuition-grade**: fast enough to explore "impossible" forms in real time, and honest about where they're weak.

It is **not** a code-compliant structural design tool. Joints are modelled as stiff, member loads are lumped to the joints, and the material values are indicative. Before anything is built, a structural engineer must verify the final design.

## Run it

It's a static site with no build step:

```sh
python3 -m http.server 8000
# open http://localhost:8000
```

## Design files

Designs are plain JSON (`format: "banshala/1"`). Each structure carries its own site placement, ready for multi-building site mode later.

## Roadmap

- **v1.5:** STL export (printable joint nodes plus real sticks).
- **v2:**
  - sketch → structure (photograph a drawing, get generators)
  - blueprint sets
  - animated build sequence
  - engineer export package
  - multi-building site mode

## Licence

MIT. Built for the bamboo community. Contributions of tested species data and joint capacities are very welcome.
