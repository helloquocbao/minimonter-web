import { useCallback, useEffect, useMemo, useRef, useState } from "react";
import { useTranslation } from "react-i18next";
import Map, { Source, Layer, Marker, Popup, NavigationControl, type MapRef, type MapEvent } from "react-map-gl";
import { formatEther } from "ethers";
import type { MultiPolygon, Polygon } from "polygon-clipping";
import type { FeatureCollection, Point } from "geojson";
import "mapbox-gl/dist/mapbox-gl.css";
import { MAPBOX_TOKEN } from "../config";
import { unionPolygons } from "../lib/polygonUnion";
import { PlayerAvatarLayer } from "./PlayerAvatarLayer";
import type { LatLng } from "../lib/geo";
import type { BaseInfo, ZoneInfo } from "../hooks/useGameState";

interface GameMapProps {
  center: LatLng;
  bases: BaseInfo[];
  zones: ZoneInfo[];
  currentPath: LatLng[];
  myAddress: string | null;
}

function colorForOwner(owner: string, myAddress: string | null): string {
  if (myAddress && owner.toLowerCase() === myAddress.toLowerCase()) return "#22c55e"; // your bases: green
  // Deterministic color per address so the same opponent always shows the same color.
  let hash = 0;
  for (const char of owner) hash = (hash * 31 + char.charCodeAt(0)) >>> 0;
  const hue = hash % 360;
  return `hsl(${hue}, 70%, 50%)`;
}

/** `0x1234...cdef` — an owner's address, short enough to sit in a map label without covering
 *  the territory underneath it. Bases are labelled by owner rather than by their on-chain id,
 *  since who holds the ground is what a player actually reads off the map. */
function shortAddress(address: string): string {
  return `${address.slice(0, 6)}...${address.slice(-4)}`;
}

/** Merges a Base's chunks into their true geometric union, so a Base extended over several
 *  Claims renders as one continuous territory instead of showing a seam wherever two adjacent
 *  chunks meet. A Base is a single thing to the player, so the map shouldn't draw its internal
 *  joins — the contract deliberately keeps the chunks separate on-chain (an exact union is
 *  prohibitively expensive in Solidity, see "Real polygons, not circles" in the README), which
 *  makes this a purely visual merge and not a change to any game state.
 *
 *  Chunks that don't actually touch stay separate islands — the union returns a MultiPolygon,
 *  so each island keeps its own outline. */
function baseTerritoryCoordinates(base: BaseInfo): MultiPolygon {
  // GeoJSON polygons must be explicitly closed (last point == first) and are (lng, lat) ordered.
  const chunkPolygons: Polygon[] = base.chunks.map((chunk) => [
    [
      ...chunk.points.map((p) => [p.lng, p.lat] as [number, number]),
      [chunk.points[0].lng, chunk.points[0].lat] as [number, number],
    ],
  ]);
  return unionPolygons(chunkPolygons);
}

/** Centroid of a Base's overall territory — averages each chunk's own centroid (not a true
 *  area-weighted centroid, but good enough to place the Base's id label/tooltip somewhere
 *  reasonably central across its chunks). */
function baseLabelPosition(base: BaseInfo): LatLng {
  const centroids = base.chunks.map((chunk) => {
    const sum = chunk.points.reduce((acc, p) => ({ lat: acc.lat + p.lat, lng: acc.lng + p.lng }), {
      lat: 0,
      lng: 0,
    });
    return { lat: sum.lat / chunk.points.length, lng: sum.lng / chunk.points.length };
  });
  const sum = centroids.reduce((acc, p) => ({ lat: acc.lat + p.lat, lng: acc.lng + p.lng }), { lat: 0, lng: 0 });
  return { lat: sum.lat / centroids.length, lng: sum.lng / centroids.length };
}

/** Builds a circular polygon (in GeoJSON, WGS84) for a Sponsored Zone's boundary — zones are
 *  always genuinely circular (radiusMeters around a center), unlike Bases which use real walked
 *  polygons, so this approximation is exact for them. Same flat-earth approximation the
 *  contract itself uses for zone containment checks. */
function circlePolygon(center: LatLng, radiusMeters: number, points = 48): number[][] {
  const metersPerDegreeLat = 111_320;
  const metersPerDegreeLng = 111_320 * Math.cos((center.lat * Math.PI) / 180);
  const coords: number[][] = [];
  for (let i = 0; i <= points; i++) {
    const angle = (i / points) * 2 * Math.PI;
    const dLat = (radiusMeters * Math.sin(angle)) / metersPerDegreeLat;
    const dLng = (radiusMeters * Math.cos(angle)) / metersPerDegreeLng;
    coords.push([center.lng + dLng, center.lat + dLat]);
  }
  return coords;
}

export function GameMap({ center, bases, zones, currentPath, myAddress }: GameMapProps) {
  const { t } = useTranslation();
  const mapRef = useRef<MapRef | null>(null);
  // The 3D avatar needs the map object but not its style, so it can't hang off `styleLoaded` —
  // and a ref alone wouldn't re-render to hand it over. A callback ref into state does both, but
  // it has to be stable: an inline `ref={(i) => ...}` is a fresh function every render, so React
  // detaches it with null and re-attaches it each time, and the setState here turns that into an
  // endless teardown/rebuild of the map — which is exactly what a blank basemap looked like.
  const [mapInstance, setMapInstance] = useState<MapRef | null>(null);
  const handleMapRef = useCallback((instance: MapRef | null) => {
    mapRef.current = instance;
    setMapInstance((previous) => (previous === instance ? previous : instance));
  }, []);
  // Mapbox Standard (v3) takes noticeably longer to finish loading its style than classic
  // styles — addSource/addLayer calls issued before that finishes throw "Style is not done
  // loading". Gate all Source/Layer/Marker rendering behind this instead of firing eagerly.
  const [styleLoaded, setStyleLoaded] = useState(false);

  const baseFillCollection = useMemo(() => {
    return {
      type: "FeatureCollection",
      // One feature per Base, carrying the union of its chunks (drawing the Base's real walked
      // shape instead of a circle approximation) — so a Base extended over multiple Claims
      // reads as one territory, with no outline where its chunks join.
      features: bases.map((base) => {
        const healthPct =
          base.initialAreaMeters > 0 ? Math.round((base.currentAreaMeters / base.initialAreaMeters) * 100) : 100;

        return {
          type: "Feature" as const,
          properties: {
            id: base.id,
            color: colorForOwner(base.owner, myAddress),
            opacity: healthPct < 50 ? 0.2 : 0.32,
            tooltip: t("map.baseTooltip", {
              id: base.id,
              owner: shortAddress(base.owner),
              current: base.currentAreaMeters,
              initial: base.initialAreaMeters,
              pct: healthPct,
            }),
          },
          geometry: {
            type: "MultiPolygon" as const,
            coordinates: baseTerritoryCoordinates(base),
          },
        };
      }),
    };
  }, [bases, myAddress, t]);

  const zoneCollection = useMemo(() => {
    const now = Date.now() / 1000;
    return {
      type: "FeatureCollection",
      features: zones
        .filter((z) => !z.withdrawn && z.endsAt > now)
        .map((zone) => ({
          type: "Feature" as const,
          properties: {
            id: zone.id,
            tooltip: t("map.zoneTooltip", {
              name: zone.name,
              sponsor: shortAddress(zone.sponsor),
              remaining: formatEther(zone.remainingPool),
              total: formatEther(zone.totalPool),
              paid: zone.sessionsPaid,
              expected: zone.expectedSessions,
            }),
          },
          geometry: {
            type: "Polygon" as const,
            coordinates: [circlePolygon(zone, zone.radiusMeters)],
          },
        })),
    };
  }, [zones, t]);

  const pathCollection = useMemo(() => {
    return {
      type: "FeatureCollection",
      features:
        currentPath.length > 1
          ? [
              {
                type: "Feature" as const,
                properties: {},
                geometry: {
                  type: "LineString" as const,
                  coordinates: currentPath.map((p) => [p.lng, p.lat]),
                },
              },
            ]
          : [],
    };
  }, [currentPath]);

  // The map view is uncontrolled (initialViewState only) so the player can freely pan/zoom
  // without fighting prop updates — but while actively recording a session we still want the
  // camera to follow along, so nudge it via the imperative API instead of a controlled prop.
  useEffect(() => {
    const map = mapRef.current;
    if (!map || !Number.isFinite(center.lat) || !Number.isFinite(center.lng)) return;
    map.easeTo({ center: [center.lng, center.lat], duration: 500 });
  }, [center.lat, center.lng]);

  if (!MAPBOX_TOKEN) {
    return (
      <div style={{ display: "flex", alignItems: "center", justifyContent: "center", height: "100%", padding: "1rem" }}>
        <p className="error">Missing VITE_MAPBOX_TOKEN — set it in your .env to render the map.</p>
      </div>
    );
  }

  return (
    <Map
      ref={handleMapRef}
      mapboxAccessToken={MAPBOX_TOKEN}
      initialViewState={{ longitude: center.lng, latitude: center.lat, zoom: 16, pitch: 45 }}
      style={{ width: "100%", height: "100%" }}
      // Mapbox Standard (v3): built-in 3D buildings/terrain/sky, no extra terrain source needed.
      mapStyle="mapbox://styles/mapbox/standard"
      onLoad={(e: MapEvent) => {
        // Standard style config knobs (v3): dusk/dawn/day/night lighting and whether 3D
        // buildings render — both built into the style itself, no custom layers required.
        const map = e.target;
        // These are cosmetic knobs on the Standard style, and their names are style-version
        // specific. Guard them: if a key is rejected the throw used to escape this handler and
        // `setStyleLoaded(true)` never ran, which silently took every Source, Layer and label
        // below down with it — a blank map with nothing in the console.
        try {
          map.setConfigProperty("basemap", "lightPreset", "day");
          map.setConfigProperty("basemap", "show3dObjects", true);
        } catch (err) {
          console.warn("Standard style config not applied:", err);
        }
        setStyleLoaded(true);
      }}
    >
      <NavigationControl position="top-left" />

      {/* Avatar: an animated 3D figure drawn on its own canvas over the map — a player character
          standing in the world rather than a flat icon. It derives its own heading and stride
          cadence from how `center` moves, which is why it takes no heading prop. Deliberately
          outside the `styleLoaded` gate below: it adds no Source or Layer, so it only needs the
          map object, and gating it on the style would make the player vanish whenever style
          loading hiccups. See PlayerAvatarLayer / playerModel. */}
      <PlayerAvatarLayer center={center} map={mapInstance} />

      {styleLoaded && (
        <>
          <Source id="base-territories" type="geojson" data={baseFillCollection as FeatureCollection}>
            <Layer
              id="base-fill"
              type="fill"
              paint={{
                "fill-color": ["get", "color"],
                "fill-opacity": ["get", "opacity"],
              }}
            />
            <Layer
              id="base-outline"
              type="line"
              // Rounded joins/caps keep a walked loop's corners looking like a traced route
              // rather than a hard-edged polygon, which is most of what makes territory read as
              // "drawn along the street" instead of "a shape stamped on the map".
              layout={{ "line-join": "round", "line-cap": "round" }}
              paint={{
                "line-color": ["get", "color"],
                "line-width": 3,
                "line-opacity": 0.95,
              }}
            />
          </Source>

          {/* Sponsored Zones — dashed gold circles distinct from Base fills, so a business's
              paid-for area reads as a separate overlay layer rather than territory itself. */}
          <Source id="sponsored-zones" type="geojson" data={zoneCollection as FeatureCollection}>
            <Layer
              id="zone-fill"
              type="fill"
              paint={{
                "fill-color": "#f59e0b",
                "fill-opacity": 0.08,
              }}
            />
            <Layer
              id="zone-outline"
              type="line"
              paint={{
                "line-color": "#f59e0b",
                "line-width": 2,
                "line-dasharray": [2, 2],
              }}
            />
          </Source>

          <Source id="walk-path" type="geojson" data={pathCollection as FeatureCollection}>
            <Layer
              id="walk-path-line"
              type="line"
              // Same rounding as the territory outline so the live trail being recorded looks
              // like the shape it's about to become.
              layout={{ "line-join": "round", "line-cap": "round" }}
              paint={{
                "line-color": "#3b82f6",
                "line-width": 4,
              }}
            />
          </Source>

          {bases.map((base) => {
            const labelPos = baseLabelPosition(base);
            return (
              <Popup
                key={base.id}
                longitude={labelPos.lng}
                latitude={labelPos.lat}
                closeButton={false}
                closeOnClick={false}
                anchor="bottom"
                offset={12}
                className="base-label-popup"
              >
                {shortAddress(base.owner)}
              </Popup>
            );
          })}

          {zones
            .filter((z) => !z.withdrawn && z.endsAt > Date.now() / 1000)
            .map((zone) => (
              <Popup
                key={`zone-${zone.id}`}
                longitude={zone.lng}
                latitude={zone.lat}
                closeButton={false}
                closeOnClick={false}
                anchor="bottom"
                // Sits a full chip-height above a Base's label (offset 12, chips are 28px tall):
                // a Sponsored Zone is normally drawn right on top of claimed territory, so at a
                // similar offset the two chips land on the same pixels and shred each other's text.
                offset={46}
                className="zone-label-popup"
              >
                {t("map.zoneLabel", { name: zone.name })}
              </Popup>
            ))}

          {/* The pulsing ring stays as a 2D marker underneath the figure: at a distance the
              silhouette alone is easy to lose against building roofs, and the ring is what makes
              "where am I" answerable at a glance. */}
          <Marker longitude={center.lng} latitude={center.lat}>
            <div className="player-avatar" aria-label="You">
              <span className="player-avatar-pulse" />
            </div>
          </Marker>
        </>
      )}
    </Map>
  );
}
