/**
 * What Infra3dViewer fetches on demand (#5734): the Infra3d SDK and proj4, which turns a lat/lng into the Web
 * Mercator metres the SDK's spatial queries take; see sdk/mapillary.js for why this is a chunk of its own.
 */

export * as infra3dapi from '@inovitas/infra3dapi';
export { default as proj4 } from 'proj4';
