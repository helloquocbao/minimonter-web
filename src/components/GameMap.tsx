import { useMemo } from "react";
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
  const polylinePositions = useMemo(() => currentPath.map((p) => [p.lat, p.lng] as [number, number]), [currentPath]);

  return (
    <MapContainer center={[center.lat, center.lng]} zoom={16} style={{ height: "100%", width: "100%" }}>
      <TileLayer
        attribution='&copy; <a href="https://www.openstreetmap.org/copyright">OpenStreetMap</a>'
        url="https://{s}.tile.openstreetmap.org/{z}/{x}/{y}.png"
      />

      {bases.map((base) => (
        <Circle
          key={base.id}
          center={[base.lat, base.lng]}
          radius={Math.max(base.radiusMeters, 5)}
          pathOptions={{ color: colorForOwner(base.owner, myAddress), fillOpacity: 0.25, weight: 2 }}
        >
          <Tooltip>
            Base #{base.id} — chủ: {base.owner.slice(0, 6)}...{base.owner.slice(-4)} — power:{" "}
            {base.powerMeters}m
          </Tooltip>
        </Circle>
      ))}

      {polylinePositions.length > 1 && <Polyline positions={polylinePositions} pathOptions={{ color: "#3b82f6" }} />}

      <Marker position={[center.lat, center.lng]} />
    </MapContainer>
  );
}
