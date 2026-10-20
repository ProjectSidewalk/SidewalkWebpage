// Globals that frontend/js/ code uses but tsc can't find a declaration for, such as values set with `window.x = ...`
// (#5278). Loaded by jsconfig.json. Anything typed `any` here is unchecked at every use; swap in a
// real type as folders get cleaned up.

// The dashboard pages hand their label popup to the contribution map through window: its click adapter resolves the
// popup lazily, so map setup can't race popup init.
interface Window {
  udLabelPopupReady: Promise<any>;
}

// mapbox-gl's and GeoJSON's types under the bare names JSDoc uses (`mapboxgl.Map`, `GeoJSON.Feature<GeoJSON.Point>`),
// so a comment need not spell out an import().
declare module 'mapbox-gl/dist/mapbox-gl-csp.js' {
  import mapboxgl from 'mapbox-gl';
  export default mapboxgl;
}
declare namespace mapboxgl {
  type ControlPosition = import('mapbox-gl').ControlPosition;
  type GeoJSONSource = import('mapbox-gl').GeoJSONSource;
  type LngLat = import('mapbox-gl').LngLat;
  type LngLatBounds = import('mapbox-gl').LngLatBounds;
  type LngLatBoundsLike = import('mapbox-gl').LngLatBoundsLike;
  type LngLatLike = import('mapbox-gl').LngLatLike;
  type Map = import('mapbox-gl').Map;
  type MapMouseEvent = import('mapbox-gl').MapMouseEvent;
  type Marker = import('mapbox-gl').Marker;
  type NavigationControl = import('mapbox-gl').NavigationControl;
  type Popup = import('mapbox-gl').Popup;
}
declare namespace GeoJSON {
  type Geometry = import('geojson').Geometry;
  type GeometryCollection = import('geojson').GeometryCollection;
  type LineString = import('geojson').LineString;
  type MultiLineString = import('geojson').MultiLineString;
  type Point = import('geojson').Point;
  type Polygon = import('geojson').Polygon;
  type MultiPolygon = import('geojson').MultiPolygon;
  type Position = import('geojson').Position;
  type Feature<G extends Geometry = Geometry, P = import('geojson').GeoJsonProperties> = import('geojson').Feature<G, P>;
  type FeatureCollection<G extends Geometry = Geometry, P = import('geojson').GeoJsonProperties> =
    import('geojson').FeatureCollection<G, P>;
}

// The Network Information API, which only Chromium browsers have, so TypeScript's DOM types leave it out.
interface Navigator {
  connection?: { saveData?: boolean };
}

// Values set on `window` by the site-wide layout (common/main.scala.html) or by AppManager from it.
interface Window {
  // The running AccessScore app, and the Explore and Validate registries: console and browser-test handles that
  // each page entry sets. Nothing in the app reads them from window.
  accessScore?: Record<string, any>;
  svl?: Record<string, any>;
  svv?: Record<string, any>;
  // The admin dashboard's shell. `any` because AdminShell is only declared in the run that reads admin-dashboard/.
  adminShell?: any;
  appManager: import('../../../frontend/js/common/AppManager.js').AppManager;
  assetDigests: Record<string, string>;
  cityId: string;
  cityName: string;
  cityNameShort: string;
  // The landing page's neighborhood choropleth, kept here so the AccessScore Spotlight can light a row's region on
  // it. Optional: it is created on the visitor's first interaction, so it is absent for the first moments of a page.
  choropleth?: mapboxgl.Map;
  // The deployment sites map, kept here so the resize handler can reach it.
  citiesMap?: mapboxgl.Map;
  // Explore's rasterized label icons, by icon path. Set up by Label.js.
  labelIconCache: Record<string, HTMLCanvasElement>;
  // Stamped from LabelType.pageStampJson.
  labelTypes: Array<{
    name: string;
    color: string;
    accessImpact: string;
    ratingScale: string;
    isPrimary: boolean;
    isPrimaryValidate: boolean;
  }>;
  logWebpageActivity: (activity: string, async?: boolean) => void;
  // Pannellum is a classic script that puts itself here; sdk/pannellum.js reads it back.
  pannellum: any;
  panoramaxLicenses: Record<string, { name: string; url: string }>;
  psAuthModal: import('../../../frontend/js/common/AuthModal.js').AuthModal;
}

// A selector lookup returns HTMLElement rather than TypeScript's plain Element. Every page we query is HTML, so the
// strict default would only mean a cast at nearly every lookup; a class or id selector that finds SVG needs one.
// These overloads take priority over the built-in ones, so the tag-name forms (`'input'`, `'svg'`) are repeated first
// to keep their exact element types.
interface ParentNode {
  querySelector<K extends keyof HTMLElementTagNameMap>(selectors: K): HTMLElementTagNameMap[K] | null;
  querySelector<K extends keyof SVGElementTagNameMap>(selectors: K): SVGElementTagNameMap[K] | null;
  querySelector<E extends Element = HTMLElement>(selectors: string): E | null;
  querySelectorAll<K extends keyof HTMLElementTagNameMap>(selectors: K): NodeListOf<HTMLElementTagNameMap[K]>;
  querySelectorAll<K extends keyof SVGElementTagNameMap>(selectors: K): NodeListOf<SVGElementTagNameMap[K]>;
  querySelectorAll<E extends Element = HTMLElement>(selectors: string): NodeListOf<E>;
}
interface Element {
  closest<K extends keyof HTMLElementTagNameMap>(selector: K): HTMLElementTagNameMap[K] | null;
  closest<K extends keyof SVGElementTagNameMap>(selector: K): SVGElementTagNameMap[K] | null;
  closest<E extends Element = HTMLElement>(selectors: string): E | null;
}

// A stylesheet import (`import './x.css'`) only tells Vite which styles the module needs (#5651); it has no exports.
declare module '*.css';
// Vite's `?worker&url` import: the URL of the file, bundled as a Web Worker (the minimap's MapLibre worker, #5734).
declare module '*?worker&url' {
  const url: string;
  export default url;
}
