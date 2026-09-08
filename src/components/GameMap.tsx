import { useEffect, useMemo, useRef, useState } from "react";
import { useTranslation } from "react-i18next";
import Map, { Source, Layer, Marker, Popup, NavigationControl, type MapRef, type MapEvent } from "react-map-gl";
import { formatEther } from "ethers";
import type { FeatureCollection, Point } from "geojson";
import "mapbox-gl/dist/mapbox-gl.css";
import { MAPBOX_TOKEN } from "../config";
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
  // Mapbox Standard (v3) takes noticeably longer to finish loading its style than classic
  // styles — addSource/addLayer calls issued before that finishes throw "Style is not done
  // loading". Gate all Source/Layer/Marker rendering behind this instead of firing eagerly.
  const [styleLoaded, setStyleLoaded] = useState(false);

  const baseFillCollection = useMemo(() => {
    return {
      type: "FeatureCollection",
      // Each chunk is its own GeoJSON feature (drawing a Base's real walked shape(s) instead
      // of a circle approximation) — a Base extended over multiple Claims just ends up as
      // several adjacent/overlapping polygons sharing the same color and tooltip.
      features: bases.flatMap((base) => {
        const healthPct =
          base.initialAreaMeters > 0 ? Math.round((base.currentAreaMeters / base.initialAreaMeters) * 100) : 100;

        return base.chunks.map((chunk) => ({
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
            // GeoJSON polygons must be explicitly closed (last point == first) and are
            // (lng, lat) ordered.
            coordinates: [[...chunk.points.map((p) => [p.lng, p.lat]), [chunk.points[0].lng, chunk.points[0].lat]]],
          },
        }));
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
              id: zone.id,
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

  // Face the avatar toward the direction of the last recorded step; default to north (0) at rest.
  const heading = useMemo(() => {
    if (currentPath.length < 2) return 0;
    return bearingDegrees(currentPath[currentPath.length - 2], currentPath[currentPath.length - 1]);
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
      ref={mapRef}
      mapboxAccessToken={MAPBOX_TOKEN}
      initialViewState={{ longitude: center.lng, latitude: center.lat, zoom: 16, pitch: 45 }}
      style={{ width: "100%", height: "100%" }}
      // Mapbox Standard (v3): built-in 3D buildings/terrain/sky, no extra terrain source needed.
      mapStyle="mapbox://styles/mapbox/standard"
      onLoad={(e: MapEvent) => {
        // Standard style config knobs (v3): dusk/dawn/day/night lighting and whether 3D
        // buildings render — both built into the style itself, no custom layers required.
        const map = e.target;
        map.setConfigProperty("basemap", "lightPreset", "day");
        map.setConfigProperty("basemap", "show3dObjects", true);
        setStyleLoaded(true);
      }}
    >
      <NavigationControl position="top-left" />

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
              paint={{
                "line-color": ["get", "color"],
                "line-width": 2,
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
                #{base.id}
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
                offset={12}
                className="zone-label-popup"
              >
                {t("map.zoneLabel", { id: zone.id })}
              </Popup>
            ))}

          {/* Avatar: a directional "radar beacon" — pulsing ring under a heading arrow, matching
              the cyan HUD theme, rotated to face the direction of the most recent GPS step. Reads
              more like a tactical-map player marker than a literal person glyph. Kept as a 2D
              HTML marker (cheap, crisp at any zoom) rather than a 3D glTF model — plenty legible
              against the Standard style's 3D buildings underneath it. */}
          <Marker longitude={center.lng} latitude={center.lat} rotation={heading} rotationAlignment="map">
            <div className="player-avatar" aria-label="You">
              <span className="player-avatar-pulse" />
              <svg width="34" height="34" viewBox="0 0 34 34" xmlns="http://www.w3.org/2000/svg">
                <circle cx="17" cy="17" r="15" fill="rgba(6,14,24,0.85)" stroke="#34e0ff" strokeWidth="2" />
                <path
                  d="M17 6.5 L23.5 21 L17 17.8 L10.5 21 Z"
                  fill="#34e0ff"
                  stroke="#eafaff"
                  strokeWidth="0.75"
                  strokeLinejoin="round"
                />
              </svg>
            </div>
          </Marker>
        </>
      )}
    </Map>
  );
}
