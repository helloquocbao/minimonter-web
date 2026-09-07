import { useMemo, useRef } from "react";
import { useTranslation } from "react-i18next";
import Map, { Source, Layer, Marker, Popup, NavigationControl, type MapRef, type MapEvent } from "react-map-gl";
import type { FeatureCollection, Point } from "geojson";
import "mapbox-gl/dist/mapbox-gl.css";
import { MAPBOX_TOKEN } from "../config";
import type { LatLng } from "../lib/geo";
import type { BaseInfo } from "../hooks/useGameState";

interface GameMapProps {
  center: LatLng;
  bases: BaseInfo[];
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

/** Bearing in degrees (0 = north) from point `a` to point `b` — used to rotate the walking
 *  avatar so it visually faces the direction of travel instead of always facing north. */
function bearingDegrees(a: LatLng, b: LatLng): number {
  const toRad = (deg: number) => (deg * Math.PI) / 180;
  const toDeg = (rad: number) => (rad * 180) / Math.PI;
  const lat1 = toRad(a.lat);
  const lat2 = toRad(b.lat);
  const dLng = toRad(b.lng - a.lng);
  const y = Math.sin(dLng) * Math.cos(lat2);
  const x = Math.cos(lat1) * Math.sin(lat2) - Math.sin(lat1) * Math.cos(lat2) * Math.cos(dLng);
  return (toDeg(Math.atan2(y, x)) + 360) % 360;
}

/** Builds a circular polygon (in GeoJSON, WGS84) approximating a Base's territory — same flat-
 *  earth approximation the contract itself uses (see METERS_PER_DEGREE in TerraChainGame.sol),
 *  so the drawn shape matches what's actually claimed on-chain. Rendering real polygons (instead
 *  of Mapbox's pixel-based circle-radius paint property) keeps the circle's real-world size
 *  correct across zoom levels and latitudes. */
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

export function GameMap({ center, bases, currentPath, myAddress }: GameMapProps) {
  const { t } = useTranslation();
  const mapRef = useRef<MapRef | null>(null);

  const baseFillCollection = useMemo(() => {
    return {
      type: "FeatureCollection",
      features: bases.map((base) => {
        const healthPct = base.initialAreaMeters > 0
          ? Math.round((base.currentAreaMeters / base.initialAreaMeters) * 100)
          : 100;
        // Shrink the drawn radius to reflect damaged territory: area scales with r^2, so the
        // displayed radius scales with sqrt(currentArea / initialArea).
        const displayRadius = base.initialAreaMeters > 0
          ? base.radiusMeters * Math.sqrt(base.currentAreaMeters / base.initialAreaMeters)
          : base.radiusMeters;

        return {
          type: "Feature" as const,
          properties: {
            id: base.id,
            color: colorForOwner(base.owner, myAddress),
            opacity: healthPct < 50 ? 0.15 : 0.25,
            tooltip: t("map.baseTooltip", {
              id: base.id,
              owner: `${base.owner.slice(0, 6)}...${base.owner.slice(-4)}`,
              current: base.currentAreaMeters,
              initial: base.initialAreaMeters,
              pct: healthPct,
            }),
          },
          geometry: {
            type: "Polygon" as const,
            coordinates: [circlePolygon(base, Math.max(displayRadius, 5))],
          },
        };
      }),
    };
  }, [bases, myAddress, t]);

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

  // Face the avatar toward the direction of the last recorded step; default to north (0) at rest.
  const heading = useMemo(() => {
    if (currentPath.length < 2) return 0;
    return bearingDegrees(currentPath[currentPath.length - 2], currentPath[currentPath.length - 1]);
  }, [currentPath]);

  if (!MAPBOX_TOKEN) {
    return (
      <div style={{ display: "flex", alignItems: "center", justifyContent: "center", height: "100%", padding: "1rem" }}>
        <p className="error">Missing VITE_MAPBOX_TOKEN — set it in your .env to render the map.</p>
      </div>
    );
  }

  return (
    <Map
      ref={mapRef}
      mapboxAccessToken={MAPBOX_TOKEN}
      initialViewState={{ longitude: center.lng, latitude: center.lat, zoom: 16, pitch: 45 }}
      longitude={undefined}
      latitude={undefined}
      style={{ width: "100%", height: "100%" }}
      // Mapbox Standard (v3): built-in 3D buildings/terrain/sky, no extra terrain source needed.
      mapStyle="mapbox://styles/mapbox/standard"
      onLoad={(e: MapEvent) => {
        // Standard style config knobs (v3): dusk/dawn/day/night lighting and whether 3D
        // buildings render — both built into the style itself, no custom layers required.
        const map = e.target;
        map.setConfigProperty("basemap", "lightPreset", "day");
        map.setConfigProperty("basemap", "show3dObjects", true);
      }}
    >
      <NavigationControl position="top-left" />

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
          paint={{
            "line-color": ["get", "color"],
            "line-width": 2,
          }}
        />
      </Source>

      <Source id="walk-path" type="geojson" data={pathCollection as FeatureCollection}>
        <Layer
          id="walk-path-line"
          type="line"
          paint={{
            "line-color": "#3b82f6",
            "line-width": 4,
          }}
        />
      </Source>

      {bases.map((base) => (
        <Popup
          key={base.id}
          longitude={base.lng}
          latitude={base.lat}
          closeButton={false}
          closeOnClick={false}
          anchor="bottom"
          offset={12}
          className="base-label-popup"
        >
          #{base.id}
        </Popup>
      ))}

      {/* Avatar: a simple person glyph, always rendered at the player's current/last known
          position, rotated to face the direction of the most recent GPS step. Kept as a 2D
          HTML marker (cheap, crisp at any zoom) rather than a 3D glTF model — plenty legible
          against the Standard style's 3D buildings underneath it. */}
      <Marker longitude={center.lng} latitude={center.lat} rotation={heading} rotationAlignment="map">
        <div className="player-avatar" aria-label="You">
          <svg width="34" height="34" viewBox="0 0 34 34" xmlns="http://www.w3.org/2000/svg">
            <circle cx="17" cy="17" r="16" fill="#2563eb" stroke="white" strokeWidth="2" />
            <path
              d="M17 8a3.2 3.2 0 1 1 0 6.4A3.2 3.2 0 0 1 17 8Zm0 8c-3.6 0-6.5 2.1-6.5 4.7v1.1c0 .6.5 1.2 1.2 1.2h10.6c.7 0 1.2-.6 1.2-1.2v-1.1c0-2.6-2.9-4.7-6.5-4.7Z"
              fill="white"
            />
          </svg>
        </div>
      </Marker>
    </Map>
  );
}
