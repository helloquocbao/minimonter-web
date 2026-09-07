// Vite doesn't resolve Leaflet's default marker icon URLs the way webpack does — without this,
// the map's position marker renders as a broken image.
import L from "leaflet";
import markerIcon from "leaflet/dist/images/marker-icon.png";
import markerIcon2x from "leaflet/dist/images/marker-icon-2x.png";
import markerShadow from "leaflet/dist/images/marker-shadow.png";

type IconDefaultWithPrivate = typeof L.Icon.Default & {
  prototype: { _getIconUrl?: unknown };
};

delete (L.Icon.Default as IconDefaultWithPrivate).prototype._getIconUrl;

L.Icon.Default.mergeOptions({
  iconUrl: markerIcon,
  iconRetinaUrl: markerIcon2x,
  shadowUrl: markerShadow,
});
