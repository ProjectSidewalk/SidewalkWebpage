"""Golden fixtures for the CropGeometry port, produced by the reference Python implementation.

Run once, from a checkout of ProjectSidewalk/sidewalk-panorama-tools at the commit the README names, so that
CropRunner.py's own functions -- not a re-implementation -- write every expected value:

    PYTHONPATH=/path/to/sidewalk-panorama-tools python3 generate_fixtures.py

Outputs, all beside this script:
  synthetic-pano.png   1024x512 RGB pano whose every pixel is a distinct function of (x, y), so a one-pixel shift or a
                       seam error changes bytes. A periodic pattern (a checkerboard) would hide exactly those bugs.
  mechanics.json       Hand-chosen windows on that pano exercising the seam wrap at both edges, the pole shift at both
                       edges, the size cap and half-to-even rounding, each with the box CropRunner computed. Permanent:
                       these are equirectangular topology facts, not the sizing rule.
  expected/<case>.png  The pixels CropRunner cut for each mechanics case (PNG, so the comparison is exact; the
                       reference tool itself stores JPEG).
  sizing-v2.json       What the sizing rule asks for over a grid of label positions and pano heights, plus one window
                       cut end to end. Versioned with the rule: a new rule regenerates this file and nothing else.

Every window here is at most 512 px wide, so the reference never downscales and the pixel comparison stays exact.
"""
import json
import os

from PIL import Image

import CropRunner

HERE = os.path.dirname(os.path.abspath(__file__))
PANO_W, PANO_H = 1024, 512


def synthetic_pano():
    img = Image.new('RGB', (PANO_W, PANO_H))
    px = img.load()
    for y in range(PANO_H):
        for x in range(PANO_W):
            px[x, y] = (round(x * 255 / (PANO_W - 1)), round(y * 255 / (PANO_H - 1)), (7 * x + 13 * y) % 256)
    return img


def box_dict(box):
    return {'left': box.left, 'top': box.top, 'width': box.width, 'height': box.height, 'shifted': box.shifted}


MECHANICS = [
    # name, pano_x, pano_y, requested width
    ('interior', 512, 256, 300),
    ('seam_left', 10, 256, 300),
    ('seam_right', 1020, 300, 240),
    ('pole_top', 700, 20, 300),
    ('pole_bottom', 200, 500, 300),
    ('cap_landscape', 512, 256, 5000),
    ('fractional', 100.5, 256.25, 303.21),
]


def main():
    pano = synthetic_pano()
    pano.save(os.path.join(HERE, 'synthetic-pano.png'), format='PNG')

    mechanics = []
    for name, x, y, requested in MECHANICS:
        box = CropRunner.compute_crop_box(x, y, requested, PANO_W, PANO_H)
        crop = CropRunner.extract_crop(pano, box.left, box.top, box.width, box.height)
        assert crop.size[0] <= CropRunner.CROP_MAX_STORED_WIDTH
        crop.save(os.path.join(HERE, 'expected', name + '.png'), format='PNG')
        mechanics.append({'case': name, 'pano_x': x, 'pano_y': y, 'requested_width': requested,
                          'pano_width': PANO_W, 'pano_height': PANO_H, 'box': box_dict(box)})
    with open(os.path.join(HERE, 'mechanics.json'), 'w') as f:
        json.dump(mechanics, f, indent=1, sort_keys=True)

    rows = []
    for pano_height in (2048, 4000, 5500, 6656, 8192, 16384):
        pano_width = 2 * pano_height
        for frac in (0.0, 0.1, 0.25, 0.4, 0.5, 0.55, 0.6, 0.7, 0.85, 0.999):
            pano_y = frac * pano_height
            pano_x = 0.37 * pano_width
            window = CropRunner.crop_window_width(pano_y, pano_height)
            rows.append({'pano_height': pano_height, 'pano_width': pano_width, 'pano_x': pano_x, 'pano_y': pano_y,
                         'predict_crop_size': CropRunner.predict_crop_size(pano_y, pano_height),
                         'window_width': window,
                         'box': box_dict(CropRunner.compute_crop_box(pano_x, pano_y, window, pano_width, pano_height))})
    # Pinned in panorama-tools' own suite: the pre-normalisation values at the calibration height.
    for pano_y in (3328, 2000, 0, 6000):
        rows.append({'pano_height': 6656, 'pano_width': 13312, 'pano_x': 1000.0, 'pano_y': float(pano_y),
                     'predict_crop_size': CropRunner.predict_crop_size(pano_y, 6656),
                     'window_width': CropRunner.crop_window_width(pano_y, 6656),
                     'box': box_dict(CropRunner.compute_crop_box(
                         1000.0, pano_y, CropRunner.crop_window_width(pano_y, 6656), 13312, 6656))})

    e2e_x, e2e_y = 512, 300
    window = CropRunner.crop_window_width(e2e_y, PANO_H)
    box = CropRunner.compute_crop_box(e2e_x, e2e_y, window, PANO_W, PANO_H)
    CropRunner.extract_crop(pano, box.left, box.top, box.width, box.height).save(
        os.path.join(HERE, 'expected', 'sizing_e2e.png'), format='PNG')

    with open(os.path.join(HERE, 'sizing-v2.json'), 'w') as f:
        json.dump({'crop_rule_version': CropRunner.CROP_RULE_VERSION,
                   'crop_size_scale': CropRunner.CROP_SIZE_SCALE,
                   'crop_min_fov_deg': CropRunner.CROP_MIN_FOV_DEG,
                   'crop_max_fov_deg': CropRunner.CROP_MAX_FOV_DEG,
                   'crop_aspect_w_over_h': CropRunner.CROP_ASPECT_W_OVER_H,
                   'crop_max_stored_width': CropRunner.CROP_MAX_STORED_WIDTH,
                   'rows': rows,
                   'e2e': {'case': 'sizing_e2e', 'pano_x': e2e_x, 'pano_y': e2e_y, 'pano_width': PANO_W,
                           'pano_height': PANO_H, 'window_width': window, 'box': box_dict(box)}},
                  f, indent=1, sort_keys=True)


if __name__ == '__main__':
    main()
