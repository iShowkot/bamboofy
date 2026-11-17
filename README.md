# Bamboofy

**A free, open-source bamboo design lab: from a wild idea to a scale model to a site.**

Bamboofy helps anyone, anywhere, get started with bamboo. Shape a structure, see how it carries load, put it through the forces of a real hillside (monsoon, wind, earthquake, flash flood, landslide), watch exactly how it breaks, and then print a scale-model kit and a site cut list. It runs in any browser and keeps working offline.

> **Early prototype.** Bamboofy is young and growing in the open. Builders, teachers, engineers and students are warmly invited to shape it. See [Contributing](#contributing).

## What it does today

- **Parametric generators**: bundled arch vault (with twist and rise-wave), gridshell dome, hypar saddle, hyperboloid (Shukhov) tower, cantilever deck. Every slider re-solves the physics live.
- **Pole by pole**: draw culms on a work plane or straight onto the ground, and set species, bundle count, joints and foundations per pole and joint.
- **Materials**:
  - Bangladeshi and Balinese bamboo species (Borak, Muli, Dendrocalamus, Petung, Tali) and timber (Sal, Gamari).
  - Every value is editable and saved with the design.
- **Joints as real objects**: fish-mouth + bolt + mortar, pegs, lashing (bet / rattan), bundle clamps and steel plates, each with a capacity and build instructions. A no-metal mode is included.
- **Forces of the hills**:
  - self-weight, people, a waterlogged monsoon roof
  - wind from any compass direction with hill-crest exposure
  - an earthquake push
  - a flash flood with debris
  - a landslide (a plinth washes out or sinks)
- **Break it**: ramps every force until something gives, then replays the failure order through to collapse.
- **Views**:
  - Drafting-table mode and an atmospheric Presence mode (light, mist, rain).
  - A stress heat map that overlays either view.
  - Exaggerated sag and a first-person "walk inside" view.
- **Make it**:
  - a printable bamboo-stick model kit at 1:10–1:100 (plan, elevations, numbered poles, stick list, cut list in mm)
  - a site cut list (CSV)
  - a bill of materials with stock-culm optimisation (CSV)
  - a PNG snapshot
  - a `.bamboo.json` design file

## Where it's going

Bamboofy is growing into a full bamboo 3D application, built **form-first**: sculpt a form freely, *bamboofy* it into real culms, test it, build it and render it.

| Release | Focus |
|---|---|
| 2.0 | The true culm: taper, nodes, stock lengths, natural variation |
| 2.1 | Form tools (curves, revolve, loft) and bambooify (rib patterns, draw-your-own ribs, craft warnings), with shingle / thatch / culm-wall skins |
| 2.2 | Photoreal rendering in the browser |
| 2.3 | Hang-it form-finding (Gaudí-style) and force-suggested ribs |
| 2.4 | Spiral shells, sweeps, one-click Blender cinema export |
| Later | Sketch → structure, Rhino export, 3D-printed joint nodes, multi-building site mode, "Rebuild this" lessons |

## Honest physics

Bamboofy uses a linear-elastic 3D space-frame solver (6 DOF per joint, skyline Cholesky with reverse Cuthill–McKee ordering), with checks for crushing, tension, bending, Euler buckling, joint capacity and foundation capacity. It is **intuition-grade**: fast enough to explore bold forms in real time, and honest about where they're weak.

**It is not a code-compliant structural design tool.** Joints are modelled as stiff, member loads are lumped to the joints, and the material values are indicative. Before anything is built, a qualified structural engineer must verify the final design.

## Run it

It's a static site with no build step:

```sh
python3 -m http.server 8000
# open http://localhost:8000
npm test   # solver checks against beam theory
```

## Contributing

What Bamboofy needs most is **craft knowledge**:

- tested species properties and joint capacities from real tests
- feedback from builders and teachers on what feels wrong or is missing
- translations, lessons and example designs

Open an issue or a pull request, or just get in touch.

## Licence

- **Code:** [GNU AGPL-3.0](LICENSE). Free to use, study, change and share, including commercially. If you distribute Bamboofy or run a modified version as a service, share your improvements under the same licence, so everyone benefits.
- **Lessons, species and joint data:** CC BY-SA 4.0.
- **Your designs are yours.** Anything you design with Bamboofy belongs to you.

Created by [Showkot Shawon](https://showkotshawon.com) as a personal project, for everyone who wants to build with bamboo.
