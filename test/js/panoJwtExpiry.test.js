/**
 * Tests for util.pano.jwtExpiryMs in frontend/js/common/pano-viewer/panoUtilities.js, which Infra3dViewer reads its
 * token's expiry from to plan the renewal. Anything it can't read has to come back null, never NaN or a throw: null is
 * what makes the viewer report the token as unreadable instead of scheduling a renewal for a nonsense time. (#5840)
 */

import { loadModules } from './loader.js';

const { util } = await loadModules('frontend/js/common/pano-viewer/panoUtilities.js',
  'frontend/js/common/utilities.js');

/**
 * A JWT-shaped token around the given payload, base64url-encoded and unpadded like Cognito's.
 * @param {object} payload - The claims.
 * @returns {string} The token.
 */
const tokenWith = (payload) => {
  const body = btoa(JSON.stringify(payload)).replace(/\+/g, '-').replace(/\//g, '_').replace(/=+$/, '');
  return `hdr.${body}.sig`;
};

describe('util.pano.jwtExpiryMs', () => {
  it("reads the exp claim as epoch milliseconds, whatever padding the payload's length needs", () => {
    // Three payload lengths, so each of the padding remainders is exercised.
    for (const extra of ['', 'a', 'ab']) {
      expect(util.pano.jwtExpiryMs(tokenWith({ exp: 1790000000, sub: extra }))).toBe(1790000000000);
    }
  });

  it('answers null for a missing token or one with no payload section', () => {
    expect(util.pano.jwtExpiryMs(undefined)).toBeNull();
    expect(util.pano.jwtExpiryMs('opaque-session-token')).toBeNull();
  });

  it('answers null for a payload without a numeric expiry', () => {
    expect(util.pano.jwtExpiryMs(tokenWith({ sub: 'user' }))).toBeNull();
    expect(util.pano.jwtExpiryMs(tokenWith({ exp: 'tomorrow' }))).toBeNull();
  });

  it('answers null, rather than throwing, for a payload that is not base64 JSON', () => {
    expect(util.pano.jwtExpiryMs('hdr.!!not-base64!!.sig')).toBeNull();
    expect(util.pano.jwtExpiryMs(`hdr.${btoa('not json')}.sig`)).toBeNull();
  });
});
