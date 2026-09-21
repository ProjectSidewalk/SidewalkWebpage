// Globals that public/js/ code uses but tsc can't find a declaration for, such as vendor libraries and values set with
// `window.x = ...` (#5278). Loaded by jsconfig.json. Anything typed `any` here is unchecked at every use; swap in a
// real type as folders get cleaned up.

// The app namespaces. Each page's Twirl view creates its own with `var svl = {}` and the app fills it in.
declare var svl: any;
declare var svv: any;
declare var sg: any;
// Shared helpers, built up piece by piece across common/ with `window.util = window.util || {}`.
declare var util: any;

// Set by common/scoreRamp.js, which the api-docs and AccessScore pages load.
declare var ScoreRamp: any;

// The API docs helpers, and each endpoint's preview object that its Twirl view calls setup() and init() on.
declare var ApiDocsMap: any;
declare var ApiDocsTheme: { color(token: string, alpha?: number): string };
declare var createApiTableWrapper: (table: HTMLTableElement, label: string) => HTMLElement;
declare var AccessScoreIntersectionsPreview: any;
declare var PlacesPreview: any;
declare var AccessScoreRegionsPreview: any;
declare var AccessScoreStreetsPreview: any;
declare var AggregateStatsByDayPreview: any;
declare var AggregateStatsPreview: any;
declare var LabelClustersPreview: any;
declare var LabelTagsPreview: any;
declare var LabelTypesPreview: any;
declare var OverallStatsByDayPreview: any;
declare var OverallStatsPreview: any;
declare var RawLabelsPreview: any;
declare var RegionsPreview: any;
declare var SidewalkPresencePreview: any;
declare var StreetsPreview: any;
declare var StreetTypesPreview: any;
declare var UserStatsPreview: any;
declare var ValidationResultTypesPreview: any;
declare var ValidationsPreview: any;

// The homepage's count-up animations, created inline by index.scala.html.
declare var percentageAnim: { start(): void } | undefined;
declare var labelsAnim: { start(): void } | undefined;
declare var distanceAnim: { start(): void } | undefined;
declare var validationsAnim: { start(): void } | undefined;

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
declare const maplibregl: any;
declare namespace maplibregl {
  type LngLatBounds = any;
  type Map = any;
}
declare const MapboxLanguage: any;
declare const MapboxSearchBox: any;
// GraphDataProvider is spelled out because a class extending an `any` base gets a constructor that takes nothing.
declare const mapillary: { GraphDataProvider: new (options?: object) => any; [name: string]: any };
declare const moment: any;
declare namespace moment {
  type Moment = any;
}
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

// jQuery plugins from Bootstrap, Magnific Popup, and Selectize.
interface JQuery {
  magnificPopup(...args: any[]): JQuery;
  modal(...args: any[]): JQuery;
  popover(...args: any[]): JQuery;
  selectize(...args: any[]): JQuery;
  tooltip(...args: any[]): JQuery;
}

declare namespace JQuery {
  interface TriggeredEvent<TDelegateTarget = any, TData = any, TCurrentTarget = any, TTarget = any> {
    // jQuery sets this on events fired from code with .trigger() or .click(), but its type package leaves it out.
    isTrigger?: number;
  }
}

// The Network Information API, which only Chromium browsers have, so TypeScript's DOM types leave it out.
interface Navigator {
  connection?: { saveData?: boolean };
}

// Values set on `window` by the site-wide layout (common/main.scala.html) or by AppManager from it.
interface Window {
  // The AccessScore tool (access-score/src/main.js): the bootstrap its view calls, and the running app once the map
  // is scored, which the browser tests read. Both hold the tool's own classes as `any` because those are only
  // declared in the run that reads access-score/.
  AccessScoreApp: {
    start(options: {
      mapboxApiKey: string;
      viewerType: typeof PanoViewer;
      imageryAccessToken: string;
      username?: string | null;
    }): Promise<Record<string, any>>;
    formatScore(score: number): string;
  };
  accessScore?: Record<string, any>;
  // The admin dashboard's shell. `any` because AdminShell is only declared in the run that reads admin-dashboard/.
  adminShell?: any;
  appManager: AppManager;
  assetDigests: Record<string, string>;
  cityId: string;
  cityName: string;
  cityNameShort: string;
  // The landing page's neighborhood choropleth, kept here so the AccessScore Spotlight can light a row's region on
  // it. Optional: it is created on the visitor's first interaction, so it is absent for the first moments of a page.
  choropleth?: mapboxgl.Map;
  // The deployment sites map, kept here so the resize handler can reach it.
  citiesMap?: mapboxgl.Map;
  // Set by the jQuery script; @types/jquery only declares the bare `$` and `jQuery` globals.
  jQuery: JQueryStatic;
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
  // Assigned by Minimap.create from a dynamic import(): MapLibre 6 is an ES module, not a script-tag global.
  maplibregl: any;
  panoramaxLicenses: Record<string, { name: string; url: string }>;
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
