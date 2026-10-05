// Globals that frontend/js/ code uses but tsc can't find a declaration for, such as vendor libraries and values set with
// `window.x = ...` (#5278). Loaded by jsconfig.json. Anything typed `any` here is unchecked at every use; swap in a
// real type as folders get cleaned up.

// The dashboard pages hand their label popup to the contribution map through window: its click adapter resolves the
// popup lazily, so map setup can't race popup init.
interface Window {
  udLabelPopupReady: Promise<any>;
}

// Libraries loaded from public/vendor/ by <script> tag that have no type package installed.
declare const AsyncLock: any;
declare const bowser: any;
declare const Chart: any;
declare const DOMPurify: any;
declare const FloatingUIDOM: any;
declare const i18next: any;
declare const i18nextHttpBackend: any;
declare const infra3dapi: any;
declare const mapboxgl: any;
declare namespace mapboxgl {
  type GeoJSONSource = any;
  type LngLat = any;
  type LngLatBounds = any;
  type LngLatLike = any;
  type Map = any;
  type MapMouseEvent = any;
  type Marker = any;
  type Popup = any;
}
declare const MapboxLanguage: any;
declare const MapboxSearchBox: any;
// GraphDataProvider is spelled out because a class extending an `any` base gets a constructor that takes nothing.
declare const mapillary: { GraphDataProvider: new (options?: object) => any; [name: string]: any };
declare const pannellum: any;
declare namespace pannellum {
  type Viewer = any;
}
declare const panzoom: any;
declare const PhotoSphereViewer: any;
declare namespace PhotoSphereViewer {
  type Viewer = any;
}
declare const proj4: any;
declare const THREE: any;
declare const TomSelect: any;
declare const turf: any;
declare namespace turf {
  type Feature<G = any> = any;
  type LineString = any;
  type Point = any;
}
declare const vegaEmbed: any;
// GeoJSON shapes, named in JSDoc only.
declare namespace GeoJSON {
  type Feature<G = any> = any;
  type FeatureCollection<G = any> = any;
  type Geometry = any;
  type LineString = any;
}

// The Network Information API, which only Chromium browsers have, so TypeScript's DOM types leave it out.
interface Navigator {
  connection?: { saveData?: boolean };
}

// Values set on `window` by the site-wide layout (common/main.scala.html) or by AppManager from it.
interface Window {
  // The running AccessScore app, and the Explore, Validate and Gallery registries: console and browser-test handles
  // that each page entry sets. Nothing in the app reads them from window.
  accessScore?: Record<string, any>;
  svl?: Record<string, any>;
  svv?: Record<string, any>;
  sg?: Record<string, any>;
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
