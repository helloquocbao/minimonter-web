import * as polygonClipping from "polygon-clipping";
import type { MultiPolygon, Polygon } from "polygon-clipping";

type UnionFn = (geom: Polygon | MultiPolygon, ...geoms: (Polygon | MultiPolygon)[]) => MultiPolygon;

/// polygon-clipping 0.15.7 ships a .d.ts advertising named exports (`union`, `difference`, ...),
/// but only its CJS build actually has them — the ESM and UMD builds end in
/// `export { index as default }` / `module.exports = index`, exposing just a default object. Vite
/// resolves the package's `browser` (UMD) field, so a plain `import { union }` typechecks and then
/// throws "does not provide an export named 'union'" in the browser, even though the same import
/// works fine under Node. Reach through whichever shape the bundler handed us, in one place.
const clipping = polygonClipping as unknown as { union?: UnionFn; default?: { union: UnionFn } };
const union: UnionFn | undefined = clipping.union ?? clipping.default?.union;

/// Merges polygons into their true geometric union. Inputs that don't touch stay separate rings
/// in the result, so callers can hand the output straight to a GeoJSON MultiPolygon.
///
/// Returns the inputs unmerged if the union can't be computed — a degenerate walked loop
/// (self-touching, or zero area after GPS simplification) can throw inside the clipper, and
/// showing a seam beats dropping territory off the map entirely.
export function unionPolygons(polygons: Polygon[]): MultiPolygon {
  if (polygons.length < 2 || !union) return polygons;
  try {
    const merged = union(polygons[0], ...polygons.slice(1));
    return merged.length > 0 ? merged : polygons;
  } catch {
    return polygons;
  }
}
