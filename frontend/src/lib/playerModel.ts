import {
  BoxGeometry,
  CapsuleGeometry,
  Group,
  Mesh,
  MeshBasicMaterial,
  MeshLambertMaterial,
  type Object3D,
  SphereGeometry,
} from "three";

/// The player's 3D avatar, built in code rather than loaded from a glTF file.
///
/// Why procedural: a rigged character asset would mean shipping a binary (and its license) with
/// the app, an extra network fetch before the player can see themselves on the map, and a loader
/// dependency — for a figure that is only ever ~64px tall on screen. Building a low-poly runner
/// out of boxes and capsules costs a few KB of code, needs no fetch, and animates from a formula
/// instead of a baked clip, so the run cadence can follow the player's actual speed.
///
/// It is deliberately shaped so swapping in a glTF later is a local change: `buildPlayerModel`
/// returns the same `{ root, pose }` contract either way, and nothing outside this file knows
/// how the limbs are made. See ROADMAP.md if the art direction moves to real character assets.
///
/// Authored **Y-up, in metres, origin between the feet** — the Mapbox custom layer converts that
/// to the map's Z-up mercator space, so nothing here needs to know about map projections.

/** Matches the cyan HUD accent used by the rest of the app (see `.player-avatar` in index.css),
 *  so the avatar reads as part of the same interface rather than a dropped-in 3D asset. */
const ACCENT = 0x34e0ff;
const BODY = 0x0e2233;
const BODY_DARK = 0x081724;

const HEIGHT = 1.8;
const HIP_Y = 0.9 * (HEIGHT / 1.8);
const SHOULDER_Y = 1.45 * (HEIGHT / 1.8);

/** A limb segment that rotates about its top end. Three.js rotates around a group's origin, so
 *  each joint is a group positioned *at* the joint with its mesh hanging below — otherwise a
 *  thigh would pivot around its own middle and the leg would scissor instead of swing. */
function joint(parent: Object3D, atY: number): Group {
  const g = new Group();
  g.position.y = atY;
  parent.add(g);
  return g;
}

function segment(parent: Object3D, length: number, radius: number, color: number): Mesh {
  const mesh = new Mesh(
    new CapsuleGeometry(radius, Math.max(0, length - radius * 2), 4, 8),
    new MeshLambertMaterial({ color })
  );
  // Hang the segment below its joint so the joint's origin is the pivot.
  mesh.position.y = -length / 2;
  parent.add(mesh);
  return mesh;
}

export interface PlayerModel {
  /** Add this to the scene. Y-up, metres, origin between the feet. */
  root: Group;
  /**
   * Drive the animation.
   *
   * @param phase   Stride phase in radians — advanced by the caller from real elapsed time and
   *                the player's speed, so the legs turn over faster when they actually move faster.
   * @param run     0 = idle, 1 = full run. Blended rather than switched, so starting and stopping
   *                eases in and out instead of popping between two poses.
   * @param elapsed Seconds since the layer was added, for the idle breathing cycle.
   */
  pose(phase: number, run: number, elapsed: number): void;
}

export function buildPlayerModel(): PlayerModel {
  const root = new Group();

  // `bob` carries the vertical bounce and forward lean so they don't fight the heading rotation
  // that the layer applies to `root`.
  const bob = new Group();
  root.add(bob);

  const torso = new Mesh(
    new CapsuleGeometry(0.17, 0.34, 4, 10),
    new MeshLambertMaterial({ color: BODY })
  );
  torso.position.y = (HIP_Y + SHOULDER_Y) / 2;
  bob.add(torso);

  const head = new Mesh(
    new SphereGeometry(0.15, 14, 10),
    new MeshLambertMaterial({ color: BODY })
  );
  head.position.y = SHOULDER_Y + 0.22;
  bob.add(head);

  // A cyan visor band: at 64px the face is a couple of pixels, but the band survives at that size
  // and is what makes the figure read as facing a direction.
  const visor = new Mesh(
    new BoxGeometry(0.2, 0.06, 0.16),
    new MeshBasicMaterial({ color: ACCENT })
  );
  visor.position.set(0, SHOULDER_Y + 0.23, 0.09);
  bob.add(visor);

  const legL = joint(bob, HIP_Y);
  const legR = joint(bob, HIP_Y);
  legL.position.x = -0.1;
  legR.position.x = 0.1;
  segment(legL, 0.45, 0.075, BODY);
  segment(legR, 0.45, 0.075, BODY);
  const shinL = joint(legL, -0.45);
  const shinR = joint(legR, -0.45);
  segment(shinL, 0.45, 0.06, BODY_DARK);
  segment(shinR, 0.45, 0.06, BODY_DARK);

  const armL = joint(bob, SHOULDER_Y);
  const armR = joint(bob, SHOULDER_Y);
  armL.position.x = -0.2;
  armR.position.x = 0.2;
  segment(armL, 0.3, 0.055, BODY);
  segment(armR, 0.3, 0.055, BODY);
  const foreL = joint(armL, -0.3);
  const foreR = joint(armR, -0.3);
  segment(foreL, 0.3, 0.045, BODY_DARK);
  segment(foreR, 0.3, 0.045, BODY_DARK);

  function pose(phase: number, run: number, elapsed: number): void {
    const idle = 1 - run;

    // Legs swing in opposition; arms mirror the legs (opposite side forward), which is what makes
    // a stick figure read as running rather than hopping.
    legL.rotation.x = Math.sin(phase) * 0.85 * run;
    legR.rotation.x = Math.sin(phase + Math.PI) * 0.85 * run;
    armR.rotation.x = Math.sin(phase) * 0.7 * run;
    armL.rotation.x = Math.sin(phase + Math.PI) * 0.7 * run;

    // Knees only bend one way. Taking the negative half of the swing (offset slightly late) gives
    // the trailing leg a bent knee and the leading leg a straight one, instead of both flexing.
    shinL.rotation.x = -Math.max(0, -Math.sin(phase - 0.5)) * 1.3 * run;
    shinR.rotation.x = -Math.max(0, -Math.sin(phase + Math.PI - 0.5)) * 1.3 * run;
    foreL.rotation.x = -0.9 * run;
    foreR.rotation.x = -0.9 * run;

    // Two bounces per stride (one per footfall), plus a forward lean that scales with the run
    // blend so the figure looks like it's carrying momentum.
    bob.position.y = Math.abs(Math.sin(phase)) * 0.07 * run + Math.sin(elapsed * 1.6) * 0.012 * idle;
    bob.rotation.x = -0.18 * run;

    // At rest the arms hang slightly out from the body — zero rotation everywhere reads as a
    // mannequin, and a shallow breathing cycle is enough to look alive while standing still.
    armL.rotation.z = 0.12 * idle;
    armR.rotation.z = -0.12 * idle;
  }

  pose(0, 0, 0);
  return { root, pose };
}
