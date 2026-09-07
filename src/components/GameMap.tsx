import { useMemo } from "react";
import { useTranslation } from "react-i18next";
import { MapContainer, TileLayer, Circle, Polyline, Marker, Tooltip } from "react-leaflet";
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

export function GameMap({ center, bases, currentPath, myAddress }: GameMapProps) {
  const { t } = useTranslation();
  const polylinePositions = useMemo(() => currentPath.map((p) => [p.lat, p.lng] as [number, number]), [currentPath]);

  return (
    <MapContainer center={[center.lat, center.lng]} zoom={16} style={{ height: "100%", width: "100%" }}>
      <TileLayer
        attribution='&copy; <a href="https://www.openstreetmap.org/copyright">OpenStreetMap</a> contributors &copy; <a href="https://carto.com/attributions">CARTO</a>'
        url="https://{s}.basemaps.cartocdn.com/light_all/{z}/{x}/{y}{r}.png"
        subdomains="abcd"
      />

      {bases.map((base) => {
        const healthPct = base.initialAreaMeters > 0
          ? Math.round((base.currentAreaMeters / base.initialAreaMeters) * 100)
          : 100;
        // Shrink the drawn radius to reflect damaged territory: area scales with r^2, so the
        // displayed radius scales with sqrt(currentArea / initialArea).
        const displayRadius = base.initialAreaMeters > 0
          ? base.radiusMeters * Math.sqrt(base.currentAreaMeters / base.initialAreaMeters)
          : base.radiusMeters;

        return (
          <Circle
            key={base.id}
            center={[base.lat, base.lng]}
            radius={Math.max(displayRadius, 5)}
            pathOptions={{
              color: colorForOwner(base.owner, myAddress),
              fillOpacity: healthPct < 50 ? 0.15 : 0.25,
              weight: 2,
              dashArray: healthPct < 100 ? "6 4" : undefined,
            }}
          >
            <Tooltip>
              {t("map.baseTooltip", {
                id: base.id,
                owner: `${base.owner.slice(0, 6)}...${base.owner.slice(-4)}`,
                current: base.currentAreaMeters,
                initial: base.initialAreaMeters,
                pct: healthPct,
              })}
            </Tooltip>
          </Circle>
        );
      })}

      {polylinePositions.length > 1 && <Polyline positions={polylinePositions} pathOptions={{ color: "#3b82f6" }} />}

      <Marker position={[center.lat, center.lng]} />
    </MapContainer>
  );
}
