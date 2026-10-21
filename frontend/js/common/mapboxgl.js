/**
 * mapbox-gl as every map module imports it (#5734), set up once: the stylesheet every map needs, and the CSP build,
 * whose Web Worker is a file of its own. The regular build makes its worker by stringifying its own code into a
 * classic-script blob, and once Vite has rewritten that code's dynamic imports to use `import.meta`, the worker fails
 * to parse and no tile ever arrives. Vite bundles the CSP build's worker from the package instead, and its URL is
 * handed to the library here.
 */

import mapboxgl from 'mapbox-gl/dist/mapbox-gl-csp.js';
import workerUrl from 'mapbox-gl/dist/mapbox-gl-csp-worker.js?worker&url';
import 'mapbox-gl/dist/mapbox-gl.css';

mapboxgl.workerUrl = workerUrl;

export default mapboxgl;
