# --- !Ups
-- #4959: convert the labels evolution 179 could not reach, and bring their positions onto the current estimator.
--
-- 179 rewrote every label's horizon-centred sv_image_x/sv_image_y into today's top-left pano_x/pano_y, but its
-- UPDATE joined `AND width IS NOT NULL AND height IS NOT NULL AND camera_heading <> 'NaN' AND camera_pitch <> 'NaN'`,
-- so a label whose pano was missing any of those was skipped and still holds legacy coordinates. Prod-wide that is
-- 3,654 labels on 1,998 panos across six cities. Their markers render in the wrong place everywhere a label is drawn
-- on its panorama -- Validate, Gallery, label popups -- off by the ratio between the assumed 13312x6656 and the real
-- pano, about 3.25x. 352 skipped the same population for the same reason, so they are also the only non-tutorial
-- labels left on 'approximation2'.
--
-- Every blocking pano is missing width/height ONLY: prod-wide not one lacks camera angles or a position. That is not
-- luck. 179 filled those fields from the same per-label columns old_label_metadata preserved, so a pano missing
-- angles is one where every label on it held NaN, and the backup holds NaN too. Dimensions were never recorded per
-- label, which is why they alone are missing. Panos that lack angles exist, but carry no labels, so they are left
-- alone permanently rather than backfilled -- nothing reads them.
--
-- The parts must run in order: part 3's positions are derived from the pixel coordinates part 2 corrects.
--
-- Not done here, deliberately:
--   * Tutorial labels are excluded throughout. Re-projecting their coordinates was declined on #4587: nothing reads
--     tutorial label positions, and the pre-2023 ones sit on a different grid than the imagery now served.
--   * 'depth' labels keep their positions. Those were measured from GSV depth data at label time rather than derived
--     from pano_x/pano_y, so 352 left them alone and so does part 3 -- correcting the pixel coordinates does not
--     invalidate a position that never came from them. That is 2,207 of the 3,406 labels part 2 moves.
--   * Clusters are not invalidated, following 352. ClusteringSessionTable.getRegionsToCluster compares which labels
--     *should* be clustered against which *are*, so moving a label the clusterer already knows about flags nothing.
--     Forcing a rebuild means emptying clustering_session, which blanks the Access Score and attribute APIs until
--     every region is re-clustered -- a deploy-time operator decision, not something to do to 54 schemas here.

-- pano_data carries only its primary key, so the neighbour lookup in part 1a has no access path for capture_date or
-- position and degrades into repeated scans of the whole table: 34 s on seattle at 183k rows, which the deploy would
-- pay once per schema. Built and dropped inside this evolution's own transaction. With it the statement is 92 ms.
CREATE INDEX pano_data_capture_date_lat_lng_idx ON pano_data (capture_date, lat, lng);
ANALYZE pano_data;

-- Part 1a. Street View captures a road in one pass and processes the whole pass alike, so pano size is a property of
-- the drive: a pano whose size we never recorded was captured alongside panos whose size we did. Same capture month,
-- within a ~50 m box, and only where those neighbours agree.
--
-- Validated on seattle by blanking every pano that has dimensions and re-deriving it from its neighbours: 170,741
-- correct, 0 wrong, 0 ambiguous, and the only failure mode was having no neighbour to read (11,161). Prod-wide the
-- rule reaches 1,608 of the 1,998 blocking panos and reported 0 ambiguous in every city.
--
-- The HAVING is the fail-safe. Where neighbours disagree nothing is written, and those labels stay in pre-179
-- coordinates -- which is where they are today. A label moved to a guessed position would be a new wrong answer.
-- Longitude is scaled by latitude so the box stays ~50 m wide in every city, not just near seattle's parallel.
-- Each dimension column is independently nullable and PanoDataTable's upsert COALESCEs them one at a time, so a row
-- can hold a measured width beside a NULL height. COALESCE keeps whatever was actually observed and fills only what
-- is missing, rather than letting a neighbour-derived value overwrite a measured one.
UPDATE pano_data
SET width = COALESCE(pano_data.width, resolved.width),
    height = COALESCE(pano_data.height, resolved.height),
    tile_width = COALESCE(pano_data.tile_width, resolved.tile_width),
    tile_height = COALESCE(pano_data.tile_height, resolved.tile_height)
FROM (
  SELECT
    blocked.pano_id,
    min(sibling.width) AS width,
    min(sibling.height) AS height,
    min(sibling.tile_width) AS tile_width,
    min(sibling.tile_height) AS tile_height
  FROM (
    SELECT DISTINCT pano_data.pano_id, pano_data.capture_date, pano_data.lat, pano_data.lng
    FROM old_label_metadata
    INNER JOIN label_point ON old_label_metadata.label_id = label_point.label_id
    INNER JOIN label ON label_point.label_id = label.label_id
    INNER JOIN pano_data ON label.pano_id = pano_data.pano_id
    WHERE NOT label.tutorial
      AND label_point.pano_x = old_label_metadata.old_pano_x
      AND label_point.pano_y = old_label_metadata.old_pano_y
      AND (pano_data.width IS NULL OR pano_data.height IS NULL)
      AND length(pano_data.pano_id) = 22
  ) AS blocked
  INNER JOIN pano_data AS sibling
    ON sibling.capture_date = blocked.capture_date
    AND sibling.width IS NOT NULL
    AND sibling.height IS NOT NULL
    AND length(sibling.pano_id) = 22
    AND sibling.pano_id <> blocked.pano_id
    AND sibling.lat BETWEEN blocked.lat - 0.00045 AND blocked.lat + 0.00045
    AND sibling.lng BETWEEN blocked.lng - 0.00045 / cos(radians(blocked.lat))
                        AND blocked.lng + 0.00045 / cos(radians(blocked.lat))
  GROUP BY blocked.pano_id
  -- Tile size is in the key, not just pano size: the min() above would otherwise pick a tile size the neighbours
  -- never agreed on. They happen to be 1:1 with pano size in seattle today, so this changes nothing there -- it makes
  -- the guarantee structural rather than a property of the current data.
  HAVING count(DISTINCT (sibling.width, sibling.height, sibling.tile_width, sibling.tile_height)) = 1
) AS resolved
WHERE pano_data.pano_id = resolved.pano_id;

-- Part 1b. The 273 panos our own data cannot answer for, derived offline and listed here. Sources, in precedence
-- order (scratchpad/4959-derive-dimensions.py, scratchpad/4959-derive-photosphere-dims.py):
--   * photometa, for street-view panos Google still serves -- what the JS API is backed by.
--   * A surviving pano of the same drive at the same location, matched on the exact capture month. A nearest-in-time
--     match is deliberately NOT accepted: seattle's _0bCOrz-hEUd_LByOsN2og, captured 2018-07, sits at a location
--     whose history skips from 2017-08 to 2019-06, and reaching backwards returned 13312x6656 while five of our own
--     2018-07 panos within 50 m agree on 16384x8192. Where no capture from the pano's own month survives, the value
--     is taken only if every surviving capture at that location reports the same size, so no generation boundary can
--     be crossed.
--   * For user-contributed photospheres, the source image itself. Their pano id is a base64-wrapped protobuf holding
--     a Google Photos content id, and that content's pixel dimensions ARE the pano dimensions. photometa answers 400
--     for them (its selector addresses street-view panos) and so does the tile endpoint, so this is their only
--     route. Checked against every seattle photosphere whose size we already hold: 26 fetched, 26 exact, 0 wrong.
--     They are served whole rather than tiled, so tile_width/tile_height are left alone rather than invented.
--
-- Grouped by size so this is a handful of checkable claims rather than 273 independent rows. Pano ids are globally
-- unique, so the same block applies to every schema and touches only the rows that schema holds. 117 panos (248
-- labels) stay unresolved -- 105 whose location mixes sizes, 12 photospheres Google no longer serves -- and keep
-- their current coordinates.

-- street-view panos, 139 of them.

-- 99 panos at 16384x8192, 512x512 tiles.
UPDATE pano_data SET width = 16384, height = 8192, tile_width = 512, tile_height = 512
WHERE width IS NULL AND pano_id IN (
  '-9tho677BCYAm1ZOrTWQGA', '-C9eB923-ex0-Rrj1mJJCQ', '2DWrRWYCyhGRU470aX0i4A', '384IHTAaQqcKaKHUh0xlhw',
  '3PvWCNqg5vmYjfi4F253ZQ', '4f2sUwpHtF5CS1TVbUY-0w', '5ccs8E1igusoB8OGnufLrA', '5dfiyA8BNWE6cbtem8V1Iw',
  '6gcemkJ5Ztrhvmdd7Umw-A', '7U2Vo_di_ZFNH8CtDDuTzw', '7qR8Rr4eA3NaSO-MhUDm-Q', '7svbDM4Dlm-Cm6q-k5e5-w',
  '84eV2Np6vQWRklnUOWf6CA', '8zaSPeCiYe4n7C1V_UZ3jA', '965Dv7UN-fG5ZuyDUBRIEg', '9l-OaEHcc5KA4et5pdT_qw',
  'A4xfL5ThmbBlJladzI5T3A', 'ASmtDv8UwNUv9qLE2ZPDww', 'Afq9yT2fSobbB-TPcqIRhQ', 'CZTHzAB1ad2QYcURS1AM7w',
  'Cl2XIXoAicmhmQvwfLy1aQ', 'CwQHRQbWDR3s_w8tMoBWRw', 'EI4IFnjiSx2Wa3imXzmInQ', 'ELvJK5SPvL3poCivBV2u3Q',
  'EgSOWUbYQzHcJYcQ117ilA', 'FCdpQKtBqELhBbkbRrM3Fw', 'FQ0lZQqUW86GBnnoY_kohw', 'GM2T8bjX37-LnqhthzHaWA',
  'GyDu_0fnces---NPjegOVg', 'HfPc3aw9QaC-uLnOhKQ8rQ', 'Ig6QgwtSqrhYFU80lMSOFw', 'J3WysS_3p3E8PWGhi-Zchw',
  'J4wukP_qz8gIzmuopfZqaw', 'JJ7yg13pzi0EgJXvpV9mWA', 'JPcJLjBRT6O3LUq5DA0xAQ', 'K-xUjA1qFJX4XmyvGc5oOQ',
  'KpWbg1FIFyGM2hHnt-l2Mw', 'MZImbuzSdfJj9APmBxKUNg', 'O3emzeK_g3oZqIiyNaWHfA', 'OHIJBBt9NlmAZoVbyT-s7g',
  'OIk3jwsOxCl-g_xmnix2Jg', 'P6yw9X-eM_znd1nwjmGeqw', 'PHO7i0b_Ki7I_ErDq1BSxg', 'PMmHIFoNSJyJLqJ5pe11uQ',
  'PcwqZQqb718MkOKEppSjsw', 'Qbp-FOdqGkraCgC-oEI5ig', 'R4XpPIMn0wSG1Bzsc358UA', 'SM3AtDAzyxHVYe2APJ-usQ',
  'ShA_W1JpLbrHXTklBcmUtg', 'TTmS8EKjtuY1b--174h_qQ', 'Th3Lv8mgre1Cjmn9_kzWng', 'Ti4tC2Ost1c4MhShwud-tw',
  'TmRQkqZDiawEQDZNPxjFVw', 'TxSnwlCrZhXng1FJ1V9hDg', 'UbRzsy3JH1TTPDq3Gk924w', 'UojOcBk9jSMmEQJHaaJZaw',
  'UudKW2tDaHS9QLlNrV01nw', 'V6JOxuhDbRPJj9ejle6ynA', 'VxHk--DfiVFKG2sO53TxAw', 'W4ynYh84zv4DjvTl5-5_AQ',
  'X1zFRS9_QFecD9B2yuxFmA', '_eY4zk4-r9sGlMcqRVHzhg', 'a-BSYPJ-UuDiz5JKlgrfzA', 'b3Bo-8VLLBE-oif1HIo89w',
  'bbR6_RTcEIJ2fGnsfXY41g', 'bm-Q9KtUbphsgh3UUhHcHA', 'bnaLac41L3KrME_AQLDeYA', 'dmJ-7yydh8Zm5Vr13lW8BQ',
  'eK7rxO8Y5-Q14ePKwHx-zA', 'eRBE1Gz_UvECQDj_DL5zqA', 'eXF2Tz5Ucd2ZtPdJHZT74w', 'ehCMQe09Sj6LKx3oE2PRpA',
  'f0fgGHorl0LLL8lCB7fpIQ', 'foBv72h7cV2-hVS1O0XVFw', 'fuB3d_msl2-VK0brGOINXQ', 'gSpOZELMCt546R39QS8msQ',
  'gZo-9ypAGkDGYv_Z3puWzw', 'gZxN-F2FfJmHdypAgVXE3g', 'hO1flgZ2ZIP8CBBCr1MmPw', 'hr2kiSEaAbQqhxuq98GJJA',
  'i93wKlvQanzXRYBWpoAzig', 'j2yX2OP9gmBInZEq94hfZQ', 'jUpFtqTUqqwG3zohfvkmGA', 'jlI4k0-RQEM20gSmmz938Q',
  'l1ZE8EMLH6r13GDTCXaAKQ', 'lVCKT1E42sGy_rJNVdqiMw', 'lnJ85f7tOIOzOODehbnGDA', 'lqVv2t7VwaalOiFX4Tvp4g',
  'piMcBHOsJXvQuAVtIVJSpw', 'pmqXY6QS5iZSANjjpwLBYA', 'rCahEmHHlx6QEQsYZy5XRg', 'rh3awh6903S7snMWnAOlDQ',
  'sQsTKSee5egDMhlBwbo5Tg', 'se2G5yTQZ1VrvQ4GPp9adA', 'vkdhWriWge4pvqWLoKMrkQ', 'wwb7ajBdAl2nxpgiz5_0EA',
  'x3Wefuasf2TjFLWxwijYFQ', 'ypICuAuPrBdj0RJLGRKmIA', 'zXl_i3mc1eObw9vlv8zRvw'
);

-- 33 panos at 13312x6656, 512x512 tiles.
UPDATE pano_data SET width = 13312, height = 6656, tile_width = 512, tile_height = 512
WHERE width IS NULL AND pano_id IN (
  '-duUF9NKOGLFuB-3T0svVQ', '17ZMeA_vTXd_zT_wFxRXvw', '1VKwz1E3zYk7ysNzUjnGAA', '3Zj5KugUkbfkExh7CbSqTw',
  '43-6Xcv22HB9Jcksq_6WLg', '6D6F3caQiD4FPPgp7zlnxQ', '9TLkTMtcIEAjCmFutPeVxw', 'AwlgWXzEYYBmv87n46-qZg',
  'EAqwqE0688xPgGVN1xao7g', 'FBQtZtrak9Sjs6rkCkq7IQ', 'FacSX1K1HF6bK0GLDiROcw', 'LnvnP1cug9Mnv7Wu6lD5Iw',
  'R-Bge6u6c-5wXFZo5jysjw', 'RYpZhYP4B1mZbhevHn7MUg', 'SZuEn_u4AsV7ebymX-NgHQ', 'ToEahEYZSuHMzIz13IIAWg',
  'WlYJynv_etdiZe6_fNnmHg', 'Z5rWTslt9Gm9kn9iEirJ8w', '_nTPTPQBmFZVopcixiC9cQ', 'aTbXDyDG2UtDsfvd1nGAsw',
  'duUKhGB1pvLlIzlE3UkKRg', 'eAX6oYDLTFWwnwdAg0T_XA', 'fUqp2QTrWV7Vy3kL7YEdpw', 'gEV9QHC3KyaMfoG1zgJE3w',
  'kCzikjzSy7UYMsiKmIj8zA', 'nrX9Asx-pjCL_6DLeO4iuw', 'qYMNy3yp-JqrzDWVBUvJmw', 'r4rKMt0zAY_L6qVeiKOpAQ',
  'r_ycsYf31bttF2RgkJKJWw', 'v6rOhbTqinZrtSEumYKPIQ', 'vclYTK5_RW7zM7TLTFLHjQ', 'xrxDoff_Azjjzt8sJUdv5w',
  'z5ELF-VTkI0RzkpzqH86-g'
);

-- 7 panos at 3328x1664, 512x512 tiles.
UPDATE pano_data SET width = 3328, height = 1664, tile_width = 512, tile_height = 512
WHERE width IS NULL AND pano_id IN (
  'Mzt9ZUb1DBB4Dj-Tc4F5Aw', 'STJSYoKSyjDGRgfxazNIQQ', 'VA4tCTug4FbU5fTbVia1aw', 'ZOceijIWNGzyPsPKrX_qfA',
  'joO4Yz-f5k_BctXuuqYp3Q', 'kpmHwfcFbgLwqewO8_cM7A', 'rAb7u1oYycG-xe5Odk2FJg'
);

-- photospheres, 134 of them.

-- 112 panos at 11000x5500.
UPDATE pano_data SET width = 11000, height = 5500
WHERE width IS NULL AND pano_id IN (
  'CAoSLEFGMVFpcE00ek1NM2RlWTRES0d6UFE1OVU2V2tyb0x2Y05OdE9HMlQwMVVX',
  'CAoSLEFGMVFpcE02T3BJTXR5VjltMmliRzluSk1URWlMUTVjN3ZLT2pnZlJIODI4',
  'CAoSLEFGMVFpcE0tTjJYUkJrOHlYTU1Kck9hM1FFREFud3J2YWs1aFZfbFQ1Vmp0',
  'CAoSLEFGMVFpcE0tYzRGR3VScTcwUGNyT1haaWtvWGxyWUlmMXA0OURPX2F3RUhU',
  'CAoSLEFGMVFpcE0wTmJST3l0X1VwVkkwNXU4V2FObDV1MVlpNXdRM2VJTklFTzh4',
  'CAoSLEFGMVFpcE0yNUhIckwxU2tmNkhJRkg3d0Q1cUphY0FOZkdNRXItZTNIQ05i',
  'CAoSLEFGMVFpcE10cDZiN3Y0bDdabTd5V0Mta1JqM0VYRFpUN2ktMWpwUUpUUlRp',
  'CAoSLEFGMVFpcE11ODhKUGxkUnJOMWlVM2oyeXBacGFJZXFrYUxpajdlYlRnZnk0',
  'CAoSLEFGMVFpcE12YmNRZkJEOFFXNDBhMWJqN2RUQ05QRFNXYmxxWjBFenh6Z1di',
  'CAoSLEFGMVFpcE14S0I3VklGRU5FSjJsTVN6RGJHeHdQcmFIYUcxbmd4MktGQjNP',
  'CAoSLEFGMVFpcE15akVDVVlFRTNjNGRJeTFSd1dvcDVjUEVKZlNyam9vWlM4ZVJz',
  'CAoSLEFGMVFpcE15eDBqU1NmSktUOVh3RXRteUs1ekhlUlNZUEM2dFh0ZG9faVJz',
  'CAoSLEFGMVFpcE1BS1hGaDZuMXV6NFV3OWpVRFdUWEhuZmVTeWJIdFllcWpYcHZF',
  'CAoSLEFGMVFpcE1CeHJTdTFMY1U0b0dOVXkwZEh0RHl1TS1qTWFIOHgxY2x3NWwx',
  'CAoSLEFGMVFpcE1DQVZrdnhhclQ2VDh2QmpkZldqLUdiakdicFJaalVXcF9sNjQt',
  'CAoSLEFGMVFpcE1EVHNTUnVwcUhUTzJIbkdxZDNLZkEyWXhpZDlEbFE4eWhvUGQ0',
  'CAoSLEFGMVFpcE1ONUNzOVF2Y0lpRjJ1ZFlHa2xmQkVrbDQ0TVh1TDlTUlQxeVZp',
  'CAoSLEFGMVFpcE1PQXZwbm45cnZPbFVRcE5BcHJiR0czOWZVSnhGbkRCZWV2ZUdw',
  'CAoSLEFGMVFpcE1QMmxVSXJKZVlhZUxBMDFtVVVvX2RZS25fT1g2ZGFETW9sRkxq',
  'CAoSLEFGMVFpcE1TV1NzSVZaTWpyT29jWDRGSzJTR19vX0x6aEd3dkgybEM0NEZK',
  'CAoSLEFGMVFpcE1fcFFocW5TSDR2Y045V1VNdVNUMDZjUHVWaENDRzBVQzI3SHJC',
  'CAoSLEFGMVFpcE1mb2Itcl9HYUVDMW52Z0RfWk5QdW1SSTVEV2x1b2g4RGdpeXpv',
  'CAoSLEFGMVFpcE1oLXNzdGZEMnpPc3g3bE1RLWNLdmNybXliLXlPRnJSc1E2akZ1',
  'CAoSLEFGMVFpcE1pUW1EVnRYN1l0S1Y1ek91aGp6R1RuSWU5S2JPaDlxQnBheXZH',
  'CAoSLEFGMVFpcE1uMUN2RE9URXhJWFgyQnRESjJKTWxzeUtKaFh5ZU50bzhlbVFF',
  'CAoSLEFGMVFpcE1vSGNsZHRYd2xid3JhOU1OMmxqY0JVdFZKUC1Ha0lDLWxuenlr',
  'CAoSLEFGMVFpcE1wOGhsdjNMV1pmMVZ0U2otdlBoZnU5ODhudUtMZXptbnZkN3M2',
  'CAoSLEFGMVFpcE40S3RDOFYwdXd3elZpd29CMHNqWC1lai05NThFaGdEaU9IMXBW',
  'CAoSLEFGMVFpcE40eDNaNVZzOGJ3V0ZCRERRX3pGSC0zUzVOQ1gtRFp6N1dFUVph',
  'CAoSLEFGMVFpcE41cFZuUmdlNl9rYkVlRjg5OGl1TU4tdDhKZjRqSS10Yy1xaHdN',
  'CAoSLEFGMVFpcE43bEc0M01pS21EZkFOemtmNTFyM251VzB3MDR4ZlIwU25GbTZU',
  'CAoSLEFGMVFpcE45dEdHZWh4bXFXLU9XbkowUGtFWUJkVlpqZFlabms5TURhcEZm',
  'CAoSLEFGMVFpcE4zRUc5WWZid2t4VVZEVGFJdVRhMDloOWFWaWkxUXU5MXM5Wm44',
  'CAoSLEFGMVFpcE53NjdvMW5MXzBfZUZoUHlUS3pYQ0Zuenp0U1hoNm1lZFRyRWZw',
  'CAoSLEFGMVFpcE55alBRVldfMkxuWm5HV19sSXczQkdwbkJBSElpcWFIa3RzNjBH',
  'CAoSLEFGMVFpcE56R0daeVRJN1U5OEd1MkxnTzY5YkFPUG9DdjNGV2lmRUdOYWRB',
  'CAoSLEFGMVFpcE5BMmtTeUFZVW5jMXMwaXpEN2trMEpXVVN5N3hRY2VmZjJGN0ZU',
  'CAoSLEFGMVFpcE5GQld2cXUxWHpWZElfQXZzbkxXaFBiMVkxd0g1QVBoUmNtLURt',
  'CAoSLEFGMVFpcE5Ga2FPaUtJN3gtNWxVTEJ6Q3VCQ0dkM1pMQWpHQ3FDaUROclp1',
  'CAoSLEFGMVFpcE5JWWY0S0ZfSXNQc2ZrZzFVVkNHRndrWkU0b1pwaVZ2TEFZUnJr',
  'CAoSLEFGMVFpcE5JZlVjYnEzSzhrR2hlU1RWVy1rYmNORFNGQjl5YmNRNVFOS1JM',
  'CAoSLEFGMVFpcE5LX0FaNDdnMGNGLVJmNHRBZmY0N2hCQ3VHdGl0ODgwOURDb1BM',
  'CAoSLEFGMVFpcE5NQWY2ejZQS1V2S0VWeUJGeXN3RnN0SFQ2Rktqb3VFWmlxeFlE',
  'CAoSLEFGMVFpcE5NSVVEUjE0a085cWExVmdwbjJLeWRPemRncjVtOTBZM0o4ZWxG',
  'CAoSLEFGMVFpcE5QLWxFNF9Ham5POXI3MkRYVnh1NjJLNFYtbzJ3VlEyLTRKeHM1',
  'CAoSLEFGMVFpcE5RRHFWZUd5TFVDcDhLdmJNSzlhXzJ6X1pmaDJ3S2lTMzgtbFBQ',
  'CAoSLEFGMVFpcE5RX1RTcl9VcW9hMmkyR3BSSW1jQW0tSWZpUmtaUkZid1hHSkl2',
  'CAoSLEFGMVFpcE5WTUg0ek1LaFBQVkUzZlZyYWpjOWJBZHo3cHZFSTZCdDFPOHMx',
  'CAoSLEFGMVFpcE5XMERST3ZkNVZ2OHhYRGlnVGg2T01PVXAxZ2U1YUh3ZGNqUHJY',
  'CAoSLEFGMVFpcE5YVjJmc3Q3cDVBNWlhWFhoejZwdERSWjgtZmhaU2VTczlVM2FB',
  'CAoSLEFGMVFpcE5aWlNtRklCMVN2ZXhOVkF6TFdKWm9uSnpoaTJFZ2U0UzZ0d0I0',
  'CAoSLEFGMVFpcE5fV2tCeG9SNWxrMEhoOW9JYXMzZlYtd2dwcUJOb2pnRnRyVEdw',
  'CAoSLEFGMVFpcE5hRGRWV3lYc2prbHBzQzhtTUtCQmlwQlA3WjRQSUVzM29xSkFO',
  'CAoSLEFGMVFpcE5qTVdwN01ObkE5UzVpN090bmFqQjdqRkgwMlNUeWlrX2k5aEVS',
  'CAoSLEFGMVFpcE5wSXc3UDFKVEh5NXhQN0lFZ0N2U25OWlRTVGFqWTYyY3Y0RUst',
  'CAoSLEFGMVFpcE5zUHhzQ2U0Q0trVkxoM0t0ZGg3Q2ZHS3NGeENjZGktU1NpSDg3',
  'CAoSLEFGMVFpcE8tMkxRcVRadWVmaW1kVlQyY05nTE05LUtNY0hXS3lWRFh4SGM4',
  'CAoSLEFGMVFpcE8wQldIX2RnaHBtZkoyNk1Ja215ZkdaemFnMHVISVo5SmpmSlQ1',
  'CAoSLEFGMVFpcE8xV29EXzFJV3daUTBsOU1XdWtValRYeFpJYnlySXNzUy1KZmx1',
  'CAoSLEFGMVFpcE8yM3V4Y2FPZU5nTXkxd3RRbHZ6X2JtWXVfdTJHWmhZdnUwS0Fp',
  'CAoSLEFGMVFpcE90OUd0aGo0blkxcWVwTjRhS0J2Sm9icmR3ZWgyOFRFZ0JDVEg4',
  'CAoSLEFGMVFpcE90cjVIbHpFcFc4NmI4TGVEbS1WQVhWcHFWMWwxazlITGJjOFRD',
  'CAoSLEFGMVFpcE91RVd1Sl9hNVJDUURxY1MtNUR4eERGMXBvVXpFWk51UENPVzA2',
  'CAoSLEFGMVFpcE94LU9vYVg1OXl4XzBXS3hEZ282Y2Ewak1OZ1FRZHFwS25GeHNs',
  'CAoSLEFGMVFpcE9DTEU1QTBwMmVaMG9sUEE2YmlWTmh5enY3VEFQYkpvVDdPY3BC',
  'CAoSLEFGMVFpcE9Hbi1MR19TaEtqVVRJTm9WalJQejY1c2U2aW9wVlVncDBhVndD',
  'CAoSLEFGMVFpcE9JVlFIMjlWVVJ0bC1FSFNIaTJ2ZVh6bEd0TlllVm1xUFpfQlFl',
  'CAoSLEFGMVFpcE9NRW9LVHhoQlcyLWpHVkVGa2RFeEgwcVBfOTFqRFo0eUNWOVVk',
  'CAoSLEFGMVFpcE9PemhacmZRMVlub2c3TUg5SUxsc1hZZEdwZHZ6eXJNSE9hOWNI',
  'CAoSLEFGMVFpcE9QTDc4OGZCU0RnajJWNW5lbUI1Q0NRMWcybGt4amUzQk5Ydm52',
  'CAoSLEFGMVFpcE9RY2RTdkROdmpQRmg4cDJHcDAzMTMxSTY0MGN5bDNWVGRPWC03',
  'CAoSLEFGMVFpcE9WYzlpUjVsVFU4ekZublJ0RzNVSEJreUxMQ0JLSXFCZGlPdncx',
  'CAoSLEFGMVFpcE9Xa3M1MlJ6WldaR3RjZE4xVl9jX09DbG5TYnBVLWEyQUkxT1Zq',
  'CAoSLEFGMVFpcE9YZ1V0aXhfcFdXNEJqNmJFUVZDbjFIekVEam9TUjdLVUU0ZGJY',
  'CAoSLEFGMVFpcE9ZTFZ0a3lPUk5QUm5UZWhGTXN4Sjl3bjNEM2dEYlQtcWlBT2VU',
  'CAoSLEFGMVFpcE9ZVjJlWVFrWXBXWmpHSEU5Y2E0dlBUOENURFB0V2c0VlJlbmti',
  'CAoSLEFGMVFpcE9ac0lsdFNaMFBvZkJoWDg5TjhPbkQ1bVk4QlllWlNKa2xIMEtP',
  'CAoSLEFGMVFpcE9fZ2lTYjlOc09kOUpVRWlTQnFaMzFES0NQMkx6WGJpb2VtcWVR',
  'CAoSLEFGMVFpcE9kTi1xRzRwTnNra2FoTVZLWGxGYnlVM3ltSlF1M0dzYXBmSmM3',
  'CAoSLEFGMVFpcE9mTmF1LVNJV1VXQ0FUSjdPY2ktR3RWemNlcnpOa0I5cnJxdGlG',
  'CAoSLEFGMVFpcE9pdFJ1RzdPZEF4ZDhUc1dlMnMzdWNvelpjdjZqaXJuRlJ0Nm45',
  'CAoSLEFGMVFpcE9tUjk2VTNaUW9XS29xbDVyM3VicWt0YkNsTk00d1dNVHVNTWtE',
  'CAoSLEFGMVFpcE9uSmdrcVZRZWc3UXhLTXhqY1UxRFlYa1ltVzhoX0lGM2VxRzZU',
  'CAoSLEFGMVFpcE9uWm1URkpSVG9pTG05LTVUSGZjcWVRSkVJM01Xd2hmUEhYQ0Jt',
  'CAoSLEFGMVFpcE9zOGQ4eUhSVnZ3OEFUVzJqTHdPU0pKYWs4WVFfbFNUdmVQWXUt',
  'CAoSLEFGMVFpcFA0Qmxqa3owVklvaHNXeV9VV0Q0LXlxUDJ4emNXWl8xb2l1c2gw',
  'CAoSLEFGMVFpcFA2c0hpTmpmM0V6QjBnVFRjS0VnV0ZaOTFvZWM2R1UxaER4dzVQ',
  'CAoSLEFGMVFpcFA5d20xR2dpTkczN2I0al85NjNVVWI4UG9HMmlUYnB3OG1ncFVB',
  'CAoSLEFGMVFpcFAtSW9MbEV5MHF1RWh6Wm1wa0Q0X3lsd1B1dFI0Y3dwWUEwbWg2',
  'CAoSLEFGMVFpcFB3Q0ZyaElDYklBcVltc3lPbDhHZTlfMTlUcHpGUkU5LXFveFlj',
  'CAoSLEFGMVFpcFB4S01MT3ROQXdQYXhJTnJpZTVOMTMtMTZBVklyanprNzRHd3dq',
  'CAoSLEFGMVFpcFB6TnczVEh5MzUxX3dpdW0zM09Xb3lDSm5KM000VGh4TThVWDlW',
  'CAoSLEFGMVFpcFBIakNZekZyNUY4QmhEQlpjY2JUdE9zLVo5aXVIYUVJeDNzamhl',
  'CAoSLEFGMVFpcFBKT3hzdC1Ud1ZjSC1PVnl3cC1YUjNLWjFhWjRadTNZNmVDbTdR',
  'CAoSLEFGMVFpcFBMcVg0NWZzajJtaEo0LUhwY0xMVzdCN0NNSTNlNTQ3elpVSGU4',
  'CAoSLEFGMVFpcFBPT1E0NXRCZmIySDZESk9KVUJsRUdLRnZwaGZ6enhILWJTM2My',
  'CAoSLEFGMVFpcFBQaTRIcG9heGU5ak00TFdLVXp0THpZZFpRVHdxTTQ2RnpmeGt2',
  'CAoSLEFGMVFpcFBTM0tad1lBVXFqOGZ1cUphbzNoYTltY3B1ZU9pZmExc1ZZZnFf',
  'CAoSLEFGMVFpcFBXbjN5Uk1KWGhQemdBVzlsekh3RS01VVJ5N1VXcnJtVnVBZ3lH',
  'CAoSLEFGMVFpcFBaTjBma25DNkh6SzdDdy1BOUhuMU4xTlF0d3NWLXNXUEUySUhk',
  'CAoSLEFGMVFpcFBaYnB6bTJQV0Z2dzVFc2dTd3RWNmQ1d3REbFZwTnRydGswUkQx',
  'CAoSLEFGMVFpcFBiV3A0TkxIdDBCSTRMc2Y5Zk1Xd0ZpRUVVTWRoUU5NMk9VNmkx',
  'CAoSLEFGMVFpcFBkNTRia0F2U0dzR0t1czRqcC1FZ2J0SWxVR2RWd01nd3hLMnV1',
  'CAoSLEFGMVFpcFBnOVBHVHQzc0FsVm1ULWdoUV9HTGYwOGFweHA3RktNRjl2LUd6',
  'CAoSLEFGMVFpcFBoU0pFa0dCcnZGaFdZRDlJM3Ytc3h1ajA0NjE0R2xra1o3Y2lR',
  'CAoSLEFGMVFpcFBod01OTzEteXhuNjNFSldyaFJybVhUN2p3eWlyc0xjWHlXZW12',
  'CAoSLEFGMVFpcFBpZ0JZeEJtUU9YM0ZDZXZybkxBSlFLRUtlM1BrMnlGX3lQMXhL',
  'CAoSLEFGMVFpcFBtWjNDVFdmdWJidzV4U214RFF1aXRMc1I5eDRzZGdVVzQwVzhI',
  'CAoSLEFGMVFpcFBuZUJ5cDNDT0xIN2hDS3RDWEtoRXNXSU8yOG85UHBkUWwyZmhj',
  'CAoSLEFGMVFpcFBvUmtvbndtWkdYT0hCbGVDNzE0MV9HMnk0czR3VkFjc3FiUEZz',
  'CAoSLEFGMVFpcFBxQXMzc2JwRmxqdmJyNHBqMVQ4TVdtYVVNTEpHREE3Qy1Iem5r',
  'CAoSLEFGMVFpcFBxSURvZzNqTngtT0t1M0JEcVpwVWMwZ00zS19oekRoVDhPYnFa'
);

-- 12 panos at 3840x1920.
UPDATE pano_data SET width = 3840, height = 1920
WHERE width IS NULL AND pano_id IN (
  'CAoSLEFGMVFpcE1xT2xTWW5MY3E4SVViUFRUNG40NHBxQWVMTjhhRy05WFhwb1h1',
  'CAoSLEFGMVFpcE4wWl9EX2FjQlprVEhrb1o5VWdDSTBseVhvVmZuX3NEMnNKdEc1',
  'CAoSLEFGMVFpcE52UkpaWG9iSU5NeHllWjduTHNXVjNOQ3J2WFMzMXpoSEhYdUgz',
  'CAoSLEFGMVFpcE53YXdYQUhhcmhLQ2Q2b0lJYjhWMlFDT2l2UlRRbmRaRXNCalJ4',
  'CAoSLEFGMVFpcE56Q21HUEQ3N0dpclh4THFDVEJxdy1EUHdaN0lrN2lyYkI2UWwt',
  'CAoSLEFGMVFpcE5USjZ1eVI0ZVVqS1RZVDdaZHlvNk1WX2R5NVlGcEFlMjd0bjFk',
  'CAoSLEFGMVFpcE5qaUFzdGxuc3JWc09GN21qQ3pqZlpILVpucHhoRkpHOHFuYXhm',
  'CAoSLEFGMVFpcE8wNHZta3RocDQzcEhHQmJlTEJ1NElBa0gwQW5ZWW9RT2JqTlJ3',
  'CAoSLEFGMVFpcE94cnplUmdXV3kwc1ItazBLdFJ2WEc5My1odW9fR3hJcG40S2h0',
  'CAoSLEFGMVFpcE9iMGtweGZyQ2QtenRHOTlaOUgzZ3lKdFctTVlFUmI4Z01KYjR2',
  'CAoSLEFGMVFpcE9uVHU3TTZkSGwyQmNwUjZJN015eHVlMG00RzdLdnF4WFBFSW5D',
  'CAoSLEFGMVFpcE9yVjVUVjNpanVPVGZrNTFTYlJ3NENmQW9ZZDNjTk5RWmY2Xzds'
);

-- 4 panos at 5760x2880.
UPDATE pano_data SET width = 5760, height = 2880
WHERE width IS NULL AND pano_id IN (
  'CAoSLEFGMVFpcE5VQUNxdVFNXzlmallhWjFkcURDY3paVks3alp0SHNqdjk4NHk4',
  'CAoSLEFGMVFpcE8wLUM5RkRScjFiQTIzLUwxX0pIV2JldUNZTXRlc2Y5UTdNVEw4',
  'CAoSLEFGMVFpcFBscUljZGtqMl9acUxRa3N2d2thQkRpcEhNWFNmc2lNOVlfRTdE',
  'CAoSLEFGMVFpcFBwTk8wcERPRnpISVl3RktnNF9BQkdLMW13Y0lvMGJ2Wl8wQ0R0'
);

-- 2 panos at 5376x2688.
UPDATE pano_data SET width = 5376, height = 2688
WHERE width IS NULL AND pano_id IN (
  'CAoSLEFGMVFpcE1RdUNtbzA5aWhVQjhhX2tqMEdzck5qWEZZZUI4MTNJUmdrMVBG',
  'CAoSLEFGMVFpcE1ndUdGRDZLZW5Jd0NWelRQMVdLOWxhVldFRjJDN1k1YjJDTE5O'
);

-- 1 pano at 8704x4352.
UPDATE pano_data SET width = 8704, height = 4352
WHERE width IS NULL AND pano_id IN (
  'CAoSLEFGMVFpcE5HLUtzZkh6VUd2SW9TOWZaWUdSV3h4dndNa1NBcEZZWGZiVmRG'
);

-- 1 pano at 7744x3872.
UPDATE pano_data SET width = 7744, height = 3872
WHERE width IS NULL AND pano_id IN (
  'CAoSLEFGMVFpcE9CWUpHX0lFXzFpdjQ5dW1Ud0RBb0dWaGxTX1UzeXZ4bnJzcnF5'
);

-- 1 pano at 7200x3600.
UPDATE pano_data SET width = 7200, height = 3600
WHERE width IS NULL AND pano_id IN (
  'CAoSLEFGMVFpcE9YTWVqS1JSajBXbWRIVnM4blY1QU9OTTNuNlZzSWtoN0J1VlE3'
);

-- 1 pano at 7168x3584.
UPDATE pano_data SET width = 7168, height = 3584
WHERE width IS NULL AND pano_id IN (
  'CAoSLEFGMVFpcFBEZFQ3bEhvQ3JzNzlTQXQ5eUpoa0hwNjdaRWdnVEYyQ1hkTDJX'
);

-- Part 2. Backup of every row parts 2 and 3 modify, so the Down is a restore-from-copy rather than a formula replay
-- (179 and 352 precedent). The UPDATEs below drive off this table, so backed-up set and modified set are identical
-- by construction. computation_method is TEXT here so a stored value can never constrain the enum.
CREATE TABLE old_label_point_coords (
  label_point_id INT PRIMARY KEY REFERENCES label_point (label_point_id),
  label_id INT NOT NULL UNIQUE REFERENCES label (label_id),
  pano_x INT NOT NULL,
  pano_y INT NOT NULL,
  lat DOUBLE PRECISION,
  lng DOUBLE PRECISION,
  geom geometry,
  computation_method TEXT,
  street_edge_id INT NOT NULL REFERENCES street_edge (street_edge_id)
);
ALTER TABLE old_label_point_coords OWNER TO sidewalk;

-- The population: labels whose stored coordinates still equal their pre-179 backup, on a pano that now has all four
-- fields 179's formula needs. old_label_metadata covers every label predating v7.12.2, which is every label 179
-- could have reached, so this is exhaustive rather than a sample. Access path: old_label_metadata's primary key on
-- label_id drives, label_point_label_id_key and label_pkey resolve one row each, pano_data's primary key the pano.
INSERT INTO old_label_point_coords
  (label_point_id, label_id, pano_x, pano_y, lat, lng, geom, computation_method, street_edge_id)
SELECT label_point.label_point_id, label.label_id, label_point.pano_x, label_point.pano_y,
       label_point.lat, label_point.lng, label_point.geom, label_point.computation_method::text,
       label.street_edge_id
FROM old_label_metadata
INNER JOIN label_point ON old_label_metadata.label_id = label_point.label_id
INNER JOIN label ON label_point.label_id = label.label_id
INNER JOIN pano_data ON label.pano_id = pano_data.pano_id
WHERE NOT label.tutorial
  AND label_point.pano_x = old_label_metadata.old_pano_x
  AND label_point.pano_y = old_label_metadata.old_pano_y
  -- The positive guards are not decoration: the pano_x expression ends in `% pano_data.width`, and pano_data has no
  -- CHECK keeping these above zero, so a single stored zero would raise division by zero and abort the whole
  -- evolution -- a failed deploy rather than a skipped row. 352 guarded the same way.
  AND pano_data.width IS NOT NULL AND pano_data.width > 0
  AND pano_data.height IS NOT NULL AND pano_data.height > 0
  AND pano_data.camera_heading IS NOT NULL AND pano_data.camera_heading <> 'NaN'
  AND pano_data.camera_pitch IS NOT NULL AND pano_data.camera_pitch <> 'NaN';

-- 179's conversion, copied verbatim from 179.sql so the labels it skipped get exactly what the ones it reached got.
-- Its own comment describes the maths as calling UtilitiesPanomarker.js:
--   calculatePanoXYFromPov(calculatePovIfCentered({heading, pitch, zoom}, canvas_x, canvas_y, 720, 480),
--                          camera_heading, width, height)
-- canvas_x/canvas_y/heading/pitch/zoom are the labeller's own viewport record and were never touched by 179, so this
-- is a true replay rather than a reconstruction. Spot-checked against the imagery on Chicago labels 23281 and 23282
-- (pano 99AnoYWD5cp5H3lP1bmK7Q): the replayed points land on the curb ramp and the cracked sidewalk panel beside it,
-- and the arithmetic matches the expected 16384/13312 rescale plus the camera_heading correction.
UPDATE label_point
SET pano_x = (pano_data.width + ROUND(pano_data.width * (((atan2((360 / tan(0.5 * (CASE WHEN label_point.zoom = 1 THEN 89.75 WHEN label_point.zoom = 2 THEN 53 ELSE 195.93 / 1.92^3 END) * PI() / 180))*cos((label_point.pitch * PI() / 180.0)) * sin((label_point.heading * PI() / 180.0)) + (label_point.canvas_x - 360) * SIGN(cos((label_point.pitch * PI() / 180.0))) * cos((label_point.heading * PI() / 180.0)) + (240 - label_point.canvas_y) * -sin((label_point.pitch * PI() / 180.0)) * sin((label_point.heading * PI() / 180.0)), (360 / tan(0.5 * (CASE WHEN label_point.zoom = 1 THEN 89.75 WHEN label_point.zoom = 2 THEN 53 ELSE 195.93 / 1.92^3 END) * PI() / 180)) * cos((label_point.pitch * PI() / 180.0)) * cos((label_point.heading * PI() / 180.0)) + (label_point.canvas_x - 360) * -SIGN(cos((label_point.pitch * PI() / 180.0))) * sin((label_point.heading * PI() / 180.0)) + (240 - label_point.canvas_y) * -sin((label_point.pitch * PI() / 180.0)) * cos((label_point.heading * PI() / 180.0))) * 180.0 / PI())::DECIMAL % 360 + 360)::DECIMAL % 360 - (pano_data.camera_heading + 180)::DECIMAL % 360) / 360)) % pano_data.width,
    pano_y = (pano_data.height / 2) - ROUND((pano_data.height / 2) * ((asin(((0.5 * 720 / tan(0.5 * (CASE WHEN label_point.zoom = 1 THEN 89.75 WHEN label_point.zoom = 2 THEN 53 ELSE 195.93 / 1.92^3 END)*PI()/180)) * sin((label_point.pitch * PI() / 180.0)) + (480 / 2 - label_point.canvas_y) * cos((label_point.pitch * PI() / 180.0))) / sqrt(((0.5 * 720 / tan(0.5 * (CASE WHEN label_point.zoom = 1 THEN 89.75 WHEN label_point.zoom = 2 THEN 53 ELSE 195.93 / 1.92^3 END)*PI()/180)) * cos((label_point.pitch * PI() / 180.0)) * sin((label_point.heading * PI() / 180.0)) + (label_point.canvas_x - 720 / 2) * SIGN(cos((label_point.pitch * PI() / 180.0))) * cos((label_point.heading * PI() / 180.0)) + (480 / 2 - label_point.canvas_y) * -sin((label_point.pitch * PI() / 180.0)) * sin((label_point.heading * PI() / 180.0)))^2 + ((0.5 * 720 / tan(0.5 * (CASE WHEN label_point.zoom = 1 THEN 89.75 WHEN label_point.zoom = 2 THEN 53 ELSE 195.93 / 1.92^3 END)*PI()/180)) * cos((label_point.pitch * PI() / 180.0)) * cos((label_point.heading * PI() / 180.0)) + (label_point.canvas_x - 720 / 2) * -SIGN(cos((label_point.pitch * PI() / 180.0))) * sin((label_point.heading * PI() / 180.0)) + (480 / 2 - label_point.canvas_y) * -sin((label_point.pitch * PI() / 180.0)) * cos((label_point.heading * PI() / 180.0)))^2 + ((0.5 * 720 / tan(0.5 * (CASE WHEN label_point.zoom = 1 THEN 89.75 WHEN label_point.zoom = 2 THEN 53 ELSE 195.93 / 1.92^3 END)*PI()/180)) * sin((label_point.pitch * PI() / 180.0)) + (480 / 2 - label_point.canvas_y) * cos((label_point.pitch * PI() / 180.0)))^ 2)) * 180.0 / PI()) / 90))
FROM old_label_point_coords
INNER JOIN label ON old_label_point_coords.label_id = label.label_id
INNER JOIN pano_data ON label.pano_id = pano_data.pano_id
WHERE label_point.label_point_id = old_label_point_coords.label_point_id;

-- Part 3. 352's recompute, ported statement for statement, restricted to the labels part 2 just moved that carry the
-- estimator it supersedes. Every CTE is one stage of the Scala pipeline it is named for. The fitted constants and
-- the spherical-haversine choice are 352's, so a refit re-runs that file's UPDATE rather than this one. 'depth' rows
-- are untouched for the reason given at the top.
WITH constants AS (
  -- PanoDataService.LatLngEstimation and CommonUtils.EARTH_RADIUS_KM, verbatim.
  SELECT 2.341219672825709::float8 AS camera_height_m,
         11.25::float8 AS blend_deg,
         50.0::float8 AS max_distance_m,
         6371.0::float8 AS earth_radius_km
), recompute_inputs AS (
  SELECT old_label_point_coords.label_point_id,
         pano_data.lat AS pano_lat, pano_data.lng AS pano_lng, pano_data.camera_heading,
         pano_data.width, pano_data.height, label_point.pano_x, label_point.pano_y
  FROM old_label_point_coords
  INNER JOIN label_point ON old_label_point_coords.label_point_id = label_point.label_point_id
  INNER JOIN label ON label_point.label_id = label.label_id
  INNER JOIN pano_data ON label.pano_id = pano_data.pano_id
  -- 'approximation3' belongs here as much as 'approximation2' does. A label 179 skipped, whose pano later gained
  -- dimensions from a live fetch, was picked up by 352 as 'approximation2' and recomputed -- from the still-legacy
  -- pixel coordinates -- then stamped 'approximation3'. Its stored position is meaningless (a negative pano_y drives
  -- depression_deg to about -110 degrees, off the end of the estimator's domain), and it is precisely a row this
  -- evolution must redo. Every row here is in the backup, so every one held pre-179 coordinates by construction:
  -- there is no correctly-computed 'approximation3' to clobber.
  WHERE old_label_point_coords.computation_method IN ('approximation2', 'approximation3')
    AND pano_data.lat IS NOT NULL
    AND pano_data.lng IS NOT NULL
    AND pano_data.camera_heading IS NOT NULL
    AND pano_data.width > 0
    AND pano_data.height > 0
), angles AS (
  -- mod(numeric, numeric) keeps the dividend's sign exactly like Scala's %, so a westward heading can leave the
  -- bearing negative -- harmless, it only ever feeds sin and cos.
  SELECT label_point_id, pano_lat, pano_lng,
         180.0 * pano_y / height - 90.0 AS depression_deg,
         mod((camera_heading - 180.0 + (pano_x::float8 / width) * 360.0)::numeric, 360.0)::float8 AS bearing_deg
  FROM recompute_inputs
), distances AS (
  SELECT label_point_id, pano_lat, pano_lng, bearing_deg,
         CASE
           WHEN depression_deg >= blend_deg THEN camera_height_m / tan(radians(depression_deg))
           ELSE LEAST(
             camera_height_m / tan(radians(blend_deg))
               + camera_height_m * (pi() / 180.0) / power(sin(radians(blend_deg)), 2)
                 * (blend_deg - GREATEST(depression_deg, 0.0)),
             max_distance_m)
         END / 1000.0 / earth_radius_km AS angular_dist
  FROM angles, constants
), new_latitudes AS (
  -- The clamp is 352's one deliberate deviation from the Scala (whose asin would yield NaN) -- it can only engage
  -- within float error of a pole, where no imagery exists.
  SELECT label_point_id, pano_lat, pano_lng, bearing_deg, angular_dist,
         asin(LEAST(1.0, GREATEST(-1.0,
           sin(radians(pano_lat)) * cos(angular_dist)
             + cos(radians(pano_lat)) * sin(angular_dist) * cos(radians(bearing_deg))
         ))) AS new_lat_rad
  FROM distances
), new_positions AS (
  SELECT label_point_id, degrees(new_lat_rad) AS new_lat,
         degrees(radians(pano_lng) + atan2(
           sin(radians(bearing_deg)) * sin(angular_dist) * cos(radians(pano_lat)),
           cos(angular_dist) - sin(radians(pano_lat)) * sin(new_lat_rad)
         )) AS new_lng
  FROM new_latitudes
)
UPDATE label_point
SET lat = new_lat,
    lng = new_lng,
    geom = ST_SetSRID(ST_Point(new_lng, new_lat), 4326),
    computation_method = 'approximation3'
FROM new_positions
WHERE label_point.label_point_id = new_positions.label_point_id;

-- Reattach labels to the street nearest their position, following 352: both authorship paths pick street_edge_id at
-- submission time as the open street nearest the estimated position, so the attachment follows the position. Labels
-- whose stored position was NULL are skipped -- those took the audit task's own street at insert rather than a
-- computed one, so their attachment never derived from the estimator. The 50-candidate planar prefilter is exact for
-- the reason 352 gives: <-> ranks by degrees while the app ranks by true distance, and no deployed city is far
-- enough from the equator for that to reorder the nearest street.
--
-- This deliberately sweeps the whole backup rather than only the rows part 3 moved. A 'depth' label keeps its
-- position here, but if the nearest street is not the one it is filed under then the attachment was already wrong,
-- and pointing it at the street we actually believe it sits on is an improvement regardless of what moved it.
--
-- The distance test is what makes that safe. Candidates are restricted to open streets, so without it a label whose
-- street was closed AFTER it was audited would be dragged onto a more distant open street purely because its own
-- street stopped being a candidate -- losing a correct attachment to gain a worse one. Requiring the new street to
-- be strictly closer than the current one leaves those alone, whether or not the label moved.
UPDATE label
SET street_edge_id = nearest_street.street_edge_id
FROM old_label_point_coords
INNER JOIN label_point ON old_label_point_coords.label_point_id = label_point.label_point_id
-- The backup's street_edge_id is the label's current one: nothing above this statement writes that column.
INNER JOIN street_edge AS current_street
  ON old_label_point_coords.street_edge_id = current_street.street_edge_id
CROSS JOIN LATERAL (
  SELECT candidate_streets.street_edge_id, candidate_streets.geom
  FROM (
    SELECT street_edge.street_edge_id, street_edge.geom
    FROM street_edge
    WHERE street_edge.status = 'open'
    ORDER BY street_edge.geom <-> label_point.geom
    LIMIT 50
  ) candidate_streets
  ORDER BY ST_DistanceSphere(candidate_streets.geom, label_point.geom)
  LIMIT 1
) nearest_street
WHERE label.label_id = old_label_point_coords.label_id
  AND old_label_point_coords.lat IS NOT NULL
  AND old_label_point_coords.lng IS NOT NULL
  AND label.street_edge_id <> nearest_street.street_edge_id
  AND ST_DistanceSphere(nearest_street.geom, label_point.geom)
    < ST_DistanceSphere(current_street.geom, label_point.geom);

DROP INDEX pano_data_capture_date_lat_lng_idx;


# --- !Downs
-- Restore every modified row from the backup. Labels created after the Up are absent from it and correctly keep
-- their live-computed values. label.street_edge_id is insert-only in the app, so restoring the backed-up value
-- cannot overwrite anything that happened in between. The inequality only skips no-op rows.
UPDATE label
SET street_edge_id = old_label_point_coords.street_edge_id
FROM old_label_point_coords
WHERE label.label_id = old_label_point_coords.label_id
  AND label.street_edge_id <> old_label_point_coords.street_edge_id;

UPDATE label_point
SET pano_x = old_label_point_coords.pano_x,
    pano_y = old_label_point_coords.pano_y,
    lat = old_label_point_coords.lat,
    lng = old_label_point_coords.lng,
    geom = old_label_point_coords.geom,
    computation_method = old_label_point_coords.computation_method::computation_method
FROM old_label_point_coords
WHERE label_point.label_point_id = old_label_point_coords.label_point_id;

DROP TABLE old_label_point_coords;

-- The pano dimensions part 1 wrote are left in place, following #4587's part 2. They are accurate metadata for real
-- panos, nothing needs them gone once the coordinates are back, and re-applying the Up is unaffected: part 1a skips
-- a pano that already has a width, and part 1b rewrites the same values. Deleting them could also fail outright,
-- since a label on one of these panos is viewable now and Validate and Gallery write interaction rows keyed on the
-- pano id.
