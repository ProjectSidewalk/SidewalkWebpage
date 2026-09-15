// Globals that public/js/ code uses but tsc can't find a declaration for, such as vendor libraries and values set with
// `window.x = ...` (#5278). Loaded by jsconfig.json. Anything typed `any` here is unchecked at every use; swap in a
// real type as folders get cleaned up.

// The app namespaces. Each page's Twirl view creates its own with `var svl = {}` and the app fills it in.
declare var svl: any;
declare var svv: any;
declare var sg: any;
// Shared helpers, built up piece by piece across common/ with `window.util = window.util || {}`.
declare var util: any;

// Libraries loaded from public/vendor/ by <script> tag that have no type package installed.
declare const AsyncLock: any;
declare const bowser: any;
declare const Chart: any;
declare const FloatingUIDOM: any;
declare const i18next: any;
declare const i18nextHttpBackend: any;
declare const infra3dapi: any;
declare const Kinetic: any;
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
declare const mapillary: any;
declare const moment: any;
declare namespace moment {
  type Moment = any;
}
declare const pannellum: any;
declare const panzoom: any;
declare const PhotoSphereViewer: any;
declare const proj4: any;
declare const THREE: any;
declare const turf: any;
declare const vegaEmbed: any;

// jQuery plugins from Bootstrap, Magnific Popup, and Selectize.
interface JQuery {
  magnificPopup(...args: any[]): JQuery;
  modal(...args: any[]): JQuery;
  popover(...args: any[]): JQuery;
  selectize(...args: any[]): JQuery;
  tooltip(...args: any[]): JQuery;
}

// Values set on `window` by the site-wide layout (common/main.scala.html) or by AppManager from it.
interface Window {
  appManager: AppManager;
  assetDigests: Record<string, string>;
  cityId: string;
  cityName: string;
  cityNameShort: string;
  // Explore's rasterized label icons, by icon path. Set up by Label.js.
  labelIconCache: Record<string, HTMLCanvasElement>;
  // Stamped from LabelTypeEnum.pageStampJson.
  labelTypes: Array<{
    name: string;
    color: string;
    accessImpact: string;
    ratingScale: string;
    isPrimary: boolean;
    isPrimaryValidate: boolean;
  }>;
  localizeElement: (el: Element) => void;
  localizeSubtree: (root: ParentNode) => void;
  logWebpageActivity: (activity: string, async?: boolean) => void;
  panoramaxLicenses: Record<string, object>;
  psAuthModal: AuthModal;
  PsModal: typeof Modal;
}
declare function localizeElement(el: Element): void;
declare function localizeSubtree(root: ParentNode): void;

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
