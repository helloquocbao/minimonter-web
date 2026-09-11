import { useEffect, useRef } from "react";
import type { MapRef } from "react-map-gl";
import {
  AmbientLight,
  DirectionalLight,
  Group,
  type Material,
  Mesh,
  OrthographicCamera,
  Scene,
  WebGLRenderer,
} from "three";
import type { LatLng } from "../lib/geo";
import { buildPlayerModel } from "../lib/playerModel";

interface PlayerAvatarLayerProps {
  /** The player's position — driven by GPS, or by the on-screen joystick during a demo. */
  center: LatLng;
  /** The live map. Passed in rather than pulled from `useMap()`, which only resolves a `current`
   *  map underneath a `<MapProvider>` — this app renders a bare `<Map>`, so `useMap().current` is
   *  always undefined here and the effect below would silently never run. */
  map: MapRef | null;
}

/** On-screen height of the avatar, in CSS pixels.
 *
 *  A real 1.8m human is about one pixel tall at zoom 16, so the avatar is drawn at a fixed screen
 *  size rather than a fixed world size — the way a game's player character stays the same size
 *  regardless of camera distance.
 *
 *  Tuned by eye: big enough that the figure reads as a person and its limbs are visibly moving,
 *  small enough not to cover the territory and street detail it is standing on. */
const AVATAR_HEIGHT_PX = 45;
const MODEL_HEIGHT_METERS = 1.8;

/** Below this the player counts as standing still. GPS noise alone moves a stationary phone by a
 *  metre or two, so the threshold sits above that to stop the avatar sprinting on the spot. */
const MOVING_SPEED_THRESHOLD = 0.6; // metres per second

/** Stride frequency at a walking pace, and how much faster the legs turn over as speed rises.
 *  Cadence following real speed is the reason for animating procedurally rather than playing a
 *  baked clip: a stroll and a jog should not look the same. */
const BASE_STRIDE_HZ = 1.1;
const STRIDE_HZ_PER_MPS = 0.45;

const METERS_PER_DEGREE = 111_320;

/** Renders the player as an animated 3D figure over the map.
 *
 *  **Why a separate canvas and not a Mapbox custom layer.** The obvious implementation shares the
 *  map's WebGL context (`new WebGLRenderer({ context: gl })` inside a `type: "custom"` layer), which
 *  is what Mapbox's own three.js example does. Against GL JS v3 it does not work: v3 draws the
 *  basemap through its own framebuffers and keeps its own cache of bound programs and buffers, so
 *  once three.js has drawn, later Mapbox passes render into the wrong target and the whole basemap
 *  goes blank. Saving and restoring the framebuffer, viewport and scissor was not enough — that
 *  only appeared to work while a scale bug was rendering the model sub-pixel, and the blanking
 *  returned the moment the figure had real size.
 *
 *  An overlay canvas with its own context cannot corrupt anything. The cost is that the avatar is
 *  always drawn on top, so a 3D building can no longer occlude it — which for a player marker is
 *  arguably the better behaviour.
 *
 *  Position and heading are derived here from how `center` moves rather than taken as props, so the
 *  avatar animates the same whether movement came from real GPS or the joystick, and keeps facing
 *  its direction of travel even outside a recording session when no path exists yet. */
export function PlayerAvatarLayer({ center, map }: PlayerAvatarLayerProps) {
  // The animation loop runs on requestAnimationFrame, not React's render cycle, so it reads the
  // live position through a ref rather than closing over a stale prop.
  const target = useRef(center);
  target.current = center;

  useEffect(() => {
    if (!map) return;
    const mapbox = map.getMap();
    const container = mapbox.getCanvasContainer();

    const canvas = document.createElement("canvas");
    canvas.style.position = "absolute";
    canvas.style.top = "0";
    canvas.style.left = "0";
    // The avatar must never eat map gestures — pan, zoom and the joystick all live underneath it.
    canvas.style.pointerEvents = "none";
    // Above the map's markers and popups, which Mapbox leaves at `z-index: auto` — without this
    // a Base's owner label lands on top of the player and hides the figure's head, which is
    // exactly where the visor showing its facing is. Still below the map controls (z-index 2)
    // and the app's own HUD buttons (20).
    canvas.style.zIndex = "1";
    // Appended to the canvas container (not the map container) so the map's own controls still
    // stack above it. Sized in explicit pixels rather than 100%, because that container reports a
    // height of 0 here — a percentage would collapse the overlay to nothing.
    container.appendChild(canvas);

    const renderer = new WebGLRenderer({ canvas, alpha: true, antialias: true });
    renderer.setClearColor(0x000000, 0);

    const scene = new Scene();
    const model = buildPlayerModel();

    // Three nested transforms, because each one has to happen in a specific order:
    //   pivot — placed at the player's screen position and scaled to pixels
    //   tilt  — leans the figure back so it is seen from above, at the map's own camera angle
    //   root  — yawed to face the direction of travel
    //
    // The tilt is what makes facing legible at all. Seen dead-on, a standing figure's forward
    // vector points straight at the viewer, so yawing it can only ever turn it left or right —
    // "facing north" and "facing south" look identical. Leaning it back gives that forward vector
    // a vertical component on screen, so a heading of north actually reads as walking up the map.
    const tilt = new Group();
    const pivot = new Group();
    tilt.add(model.root);
    pivot.add(tilt);
    scene.add(pivot);

    // The overlay inherits no basemap lighting, so the avatar carries its own: ambient to keep the
    // shadowed side off pure black, and a directional light from the upper left roughly matching
    // the Standard style's "day" preset.
    scene.add(new AmbientLight(0xffffff, 1.9));
    const sun = new DirectionalLight(0xffffff, 2.4);
    sun.position.set(-0.5, 1, 0.9);
    scene.add(sun);

    // Pixel-space orthographic camera: one world unit is one CSS pixel, the origin is the canvas
    // centre and +y is up. The model can then simply be placed at the screen coordinate Mapbox
    // projects the player to, with no projection matrix juggling — and it keeps the figure
    // standing upright instead of shearing with the map's 45° pitch.
    const camera = new OrthographicCamera(-1, 1, 1, -1, -2000, 2000);
    camera.position.z = 1000;

    let width = 0;
    let height = 0;
    function resize() {
      // Measured off the map's own canvas — that is the element whose box actually matches the
      // rendered map.
      const rect = mapbox.getCanvas().getBoundingClientRect();
      if (rect.width === width && rect.height === height) return;
      width = rect.width;
      height = rect.height;
      canvas.style.width = `${width}px`;
      canvas.style.height = `${height}px`;
      renderer.setPixelRatio(window.devicePixelRatio);
      renderer.setSize(width, height, false);
      camera.left = -width / 2;
      camera.right = width / 2;
      camera.top = height / 2;
      camera.bottom = -height / 2;
      camera.updateProjectionMatrix();
    }
    resize();
    const resizeObserver = new ResizeObserver(resize);
    resizeObserver.observe(mapbox.getCanvas());

    // Smoothed motion state. `pos` chases `target` rather than snapping to it: GPS arrives in
    // discrete jumps and the map camera eases between them, so an unsmoothed model would visibly
    // skate over the ground it is standing on.
    const pos = { lat: center.lat, lng: center.lng };
    let heading = 0; // radians, clockwise from north
    let speed = 0; // metres per second, smoothed
    let runBlend = 0; // 0 = idle, 1 = running
    let phase = 0; // stride phase, radians
    let frame = 0;
    const startedAt = performance.now();
    let lastFrame = startedAt;

    /** Shortest-path angle interpolation — without the wrap, turning from 350° to 10° sends the
     *  avatar spinning the long way round. */
    function lerpAngle(from: number, to: number, t: number): number {
      let delta = ((to - from + Math.PI) % (Math.PI * 2)) - Math.PI;
      if (delta < -Math.PI) delta += Math.PI * 2;
      return from + delta * t;
    }

    function tick() {
      frame = requestAnimationFrame(tick);

      const now = performance.now();
      // Clamped: a backgrounded tab hands back a dt of many seconds on its first frame.
      const dt = Math.min((now - lastFrame) / 1000, 0.1);
      lastFrame = now;
      const elapsed = (now - startedAt) / 1000;

      const dLat = target.current.lat - pos.lat;
      const dLng = target.current.lng - pos.lng;
      const latScale = Math.cos((pos.lat * Math.PI) / 180);
      const distance = Math.hypot(dLat, dLng * latScale) * METERS_PER_DEGREE;

      if (distance > 0.01) {
        // Exponential approach — quick enough to track the joystick, slow enough to absorb a GPS
        // jump. Written against dt so it behaves identically at 30fps and 120fps.
        const follow = 1 - Math.exp(-dt * 6);
        pos.lat += dLat * follow;
        pos.lng += dLng * follow;
        heading = lerpAngle(heading, Math.atan2(dLng * latScale, dLat), 1 - Math.exp(-dt * 8));
      }

      const instantSpeed = dt > 0 ? (distance * (1 - Math.exp(-dt * 6))) / dt : 0;
      speed += (instantSpeed - speed) * (1 - Math.exp(-dt * 4));

      // Blended rather than switched, so setting off and stopping ease instead of popping.
      const wantRun = speed > MOVING_SPEED_THRESHOLD ? 1 : 0;
      runBlend += (wantRun - runBlend) * (1 - Math.exp(-dt * 7));
      phase += dt * (BASE_STRIDE_HZ + speed * STRIDE_HZ_PER_MPS) * Math.PI * 2 * runBlend;
      model.pose(phase, runBlend, elapsed);

      // Ask Mapbox where this coordinate lands on screen, then place the model there. Doing it
      // every frame is what keeps the avatar planted while the map pans, zooms and rotates.
      const screen = mapbox.project([pos.lng, pos.lat]);
      pivot.scale.setScalar(AVATAR_HEIGHT_PX / MODEL_HEIGHT_METERS);
      pivot.position.set(screen.x - width / 2, height / 2 - screen.y, 0);

      // How far the map's camera is from straight-down: Mapbox pitch 0 looks vertically down, 45
      // looks in at 45°. Tracking it keeps the avatar sitting in the same perspective as the
      // buildings around it. Clamped, because at a true top-down pitch the figure would be seen
      // from directly overhead and flatten into a disc.
      const lookDown = Math.min(Math.PI / 2 - (mapbox.getPitch() * Math.PI) / 180, (70 * Math.PI) / 180);
      tilt.rotation.x = -lookDown;

      // A compass heading is clockwise from north, and three.js yaw about +Y turns the model's
      // forward (+Z, where the visor faces) toward +X — which is screen-right, i.e. east. So the
      // heading maps straight onto the yaw with no sign flip. The map's own bearing comes off it,
      // or the avatar stops pointing down the street it is walking along the moment the player
      // rotates the map.
      model.root.rotation.y = heading - (mapbox.getBearing() * Math.PI) / 180;

      renderer.render(scene, camera);
    }
    tick();

    return () => {
      cancelAnimationFrame(frame);
      resizeObserver.disconnect();
      scene.traverse((object) => {
        if (object instanceof Mesh) {
          object.geometry.dispose();
          (object.material as Material).dispose();
        }
      });
      // This renderer owns its context and canvas (unlike the shared-context approach), so both
      // must be torn down here or a remount leaks a WebGL context.
      renderer.dispose();
      canvas.remove();
    };
    // Mounted once per map: `center` is read through `target`, so it must not rebuild the scene.
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [map]);

  return null;
}
