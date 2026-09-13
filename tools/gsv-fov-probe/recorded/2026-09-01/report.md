# GSV FOV probe results — 2026-09-03T18:23:44.314Z

Run: `2026-09-01T02-19-24-024Z` · Maps channel requested: `weekly` · resolved `google.maps.version`: `3.66.2d` · estimator `295422a5a946`

## Verdict: **width-pinned-vfov-clamped**

vFov clamp window: ceiling 89.84° (12 binding cells), floor 14.974° (12 binding cells)

Gates: method=PASS, model=FAIL, anisotropy=PASS (18 of 40 pitch cells excluded as unreliable), seed=PASS (median |seedF−f|/f = 0.00897)

## Clamp binding aspects

| zoom | control hFov | floor binds at aspect ≥ | ceiling binds at aspect ≤ |
|---|---|---|---|
| 1 | 89.875° | 7.593 | 1.001 |
| 2 | 53.055° | 3.798 | 0.501 |
| 3 | 28.03° | 1.899 | 0.25 |

## Measured cells

| pano | container | zoom | kind | f (CSS px) | 95% CI | hFov | vFov | n | drop | NCC |
|---|---|---|---|---|---|---|---|---|---|---|
| dc-tutorial-site | control-720x480 | 1 | yaw | 360.79 | [360.73, 360.83] | 89.875° | 67.265° | 32/32 | 0 (0 NCC, 0 MAD) | 0.979 |
| dc-tutorial-site | control-720x480 | 2 | pitch | 720.7 | [720.63, 720.9] | 53.086° | 36.837° | 6/8 | 0.25 (2 NCC, 0 MAD) | 0.9896 |
| dc-tutorial-site | control-720x480 | 2 | yaw | 721.32 | [721.25, 721.43] | 53.046° | 36.807° | 24/24 | 0 (0 NCC, 0 MAD) | 0.9884 |
| dc-tutorial-site | control-720x480 | 3 | yaw | 1442.28 | [1442.16, 1442.5] | 28.03° | 18.895° | 24/24 | 0 (0 NCC, 0 MAD) | 0.9963 |
| dc-tutorial-site | dpr2-720x480 | 1 | yaw | 360.83 | [360.82, 360.88] | 89.867° | 67.258° | 32/32 | 0 (0 NCC, 0 MAD) | 0.9947 |
| dc-tutorial-site | dpr2-720x480 | 2 | pitch | 721.15 | [721.14, 721.27] | 53.057° | 36.815° | 6/8 | 0.25 (2 NCC, 0 MAD) | 0.998 |
| dc-tutorial-site | dpr2-720x480 | 2 | yaw | 721.18 | [721.13, 721.22] | 53.055° | 36.813° | 24/24 | 0 (0 NCC, 0 MAD) | 0.9958 |
| dc-tutorial-site | dpr2-720x480 | 3 | yaw | 1442.4 | [1442.22, 1442.6] | 28.028° | 18.894° | 24/24 | 0 (0 NCC, 0 MAD) | 0.996 |
| dc-tutorial-site | portrait-480x853 | 1 | yaw | 427.49 | [427.48, 427.6] | 58.621° | 89.867° | 28/32 | 0.125 (0 NCC, 4 MAD) | 0.9877 |
| dc-tutorial-site | portrait-480x853 | 2 | pitch | 481 | [481, 481.24] | 53.034° | 83.126° | 6/8 | 0.25 (2 NCC, 0 MAD) | 0.9914 |
| dc-tutorial-site | portrait-480x853 | 2 | yaw | 481.43 | [481.28, 481.48] | 52.994° | 83.075° | 24/24 | 0 (0 NCC, 0 MAD) | 0.9899 |
| dc-tutorial-site | portrait-480x853 | 3 | yaw | 962.04 | [961.79, 962.19] | 28.015° | 47.818° | 24/24 | 0 (0 NCC, 0 MAD) | 0.9941 |
| dc-tutorial-site | size2x-1440x960 | 1 | yaw | 721.46 | [721.39, 721.48] | 89.884° | 67.273° | 32/32 | 0 (0 NCC, 0 MAD) | 0.9841 |
| dc-tutorial-site | size2x-1440x960 | 2 | pitch | 1442.26 | [1442.21, 1442.47] | 53.058° | 36.816° | 6/8 | 0.25 (2 NCC, 0 MAD) | 0.9964 |
| dc-tutorial-site | size2x-1440x960 | 2 | yaw | 1442.34 | [1442.31, 1442.43] | 53.056° | 36.814° | 24/24 | 0 (0 NCC, 0 MAD) | 0.9938 |
| dc-tutorial-site | size2x-1440x960 | 3 | yaw | 2884.8 | [2884.43, 2885.2] | 28.028° | 18.894° | 24/24 | 0 (0 NCC, 0 MAD) | 0.996 |
| dc-tutorial-site | square-480x480 | 1 | yaw | 240.46 | [240.43, 240.56] | 89.891° | 89.891° | 32/32 | 0 (0 NCC, 0 MAD) | 0.9889 |
| dc-tutorial-site | square-480x480 | 2 | pitch | 481.06 | [480.92, 481.15] | 53.029° | 53.029° | 6/8 | 0.25 (2 NCC, 0 MAD) | 0.9926 |
| dc-tutorial-site | square-480x480 | 2 | yaw | 481.15 | [481.09, 481.22] | 53.02° | 53.02° | 24/24 | 0 (0 NCC, 0 MAD) | 0.9885 |
| dc-tutorial-site | square-480x480 | 3 | yaw | 962.01 | [961.73, 962.12] | 28.016° | 28.016° | 24/24 | 0 (0 NCC, 0 MAD) | 0.9946 |
| dc-tutorial-site | wide169h-854x480 | 1 | yaw | 427.97 | [427.96, 428.06] | 89.87° | 58.566° | 30/32 | 0.063 (0 NCC, 2 MAD) | 0.9865 |
| dc-tutorial-site | wide169h-854x480 | 2 | pitch | 855.41 | [855.41, 855.57] | 53.054° | 31.345° | 6/8 | 0.25 (2 NCC, 0 MAD) | 0.9961 |
| dc-tutorial-site | wide169h-854x480 | 2 | yaw | 855.49 | [855.35, 855.63] | 53.05° | 31.342° | 24/24 | 0 (0 NCC, 0 MAD) | 0.9938 |
| dc-tutorial-site | wide169h-854x480 | 3 | yaw | 1710.77 | [1710.66, 1711.09] | 28.029° | 15.972° | 24/24 | 0 (0 NCC, 0 MAD) | 0.9978 |
| dc-tutorial-site | wide169w-720x405 | 1 | yaw | 360.83 | [360.77, 360.86] | 89.868° | 58.603° | 32/32 | 0 (0 NCC, 0 MAD) | 0.9783 |
| dc-tutorial-site | wide169w-720x405 | 2 | pitch | 720.33 | [720.18, 720.57] | 53.109° | 31.404° | 6/8 | 0.25 (2 NCC, 0 MAD) | 0.9897 |
| dc-tutorial-site | wide169w-720x405 | 2 | yaw | 721.21 | [721.17, 721.3] | 53.053° | 31.367° | 24/24 | 0 (0 NCC, 0 MAD) | 0.9888 |
| dc-tutorial-site | wide169w-720x405 | 3 | yaw | 1442.35 | [1442.21, 1442.55] | 28.029° | 15.984° | 24/24 | 0 (0 NCC, 0 MAD) | 0.9963 |
| dc-tutorial-site | wide219h-1120x480 | 1 | yaw | 561.3 | [561.21, 561.32] | 89.867° | 46.301° | 32/32 | 0 (0 NCC, 0 MAD) | 0.9923 |
| dc-tutorial-site | wide219h-1120x480 | 2 | pitch | 1121.31 | [1121.28, 1121.47] | 53.077° | 24.162° | 6/8 | 0.25 (2 NCC, 0 MAD) | 0.9965 |
| dc-tutorial-site | wide219h-1120x480 | 2 | yaw | 1121.91 | [1121.87, 1122.08] | 53.052° | 24.15° | 24/24 | 0 (0 NCC, 0 MAD) | 0.9958 |
| dc-tutorial-site | wide219h-1120x480 | 3 | yaw | 1825.97 | [1825.7, 1826.21] | 34.1° | 14.976° | 24/24 | 0 (0 NCC, 0 MAD) | 0.9979 |
| dc-tutorial-site | xportrait-360x1000 | 1 | yaw | 501.36 | [501.33, 501.45] | 39.499° | 89.845° | 32/32 | 0 (0 NCC, 0 MAD) | 0.9912 |
| dc-tutorial-site | xportrait-360x1000 | 2 | pitch | 501.12 | [500.99, 501.25] | 39.516° | 89.872° | 4/8 | 0.5 (4 NCC, 0 MAD) | 0.9898 |
| dc-tutorial-site | xportrait-360x1000 | 2 | yaw | 501.69 | [501.42, 501.89] | 39.475° | 89.807° | 24/24 | 0 (0 NCC, 0 MAD) | 0.9918 |
| dc-tutorial-site | xportrait-360x1000 | 3 | yaw | 721.23 | [721.16, 721.32] | 28.027° | 69.464° | 24/24 | 0 (0 NCC, 0 MAD) | 0.9869 |
| dc-tutorial-site | xwide-2400x480 | 1 | yaw | 1202.38 | [1202.31, 1202.44] | 89.887° | 22.576° | 32/32 | 0 (0 NCC, 0 MAD) | 0.9922 |
| dc-tutorial-site | xwide-2400x480 | 2 | pitch | 1826.45 | [1826.35, 1826.49] | 66.611° | 14.972° | 6/8 | 0.25 (2 NCC, 0 MAD) | 0.9986 |
| dc-tutorial-site | xwide-2400x480 | 2 | yaw | 1826.2 | [1826.06, 1826.41] | 66.618° | 14.974° | 24/24 | 0 (0 NCC, 0 MAD) | 0.9966 |
| dc-tutorial-site | xwide-2400x480 | 3 | yaw | 1826.2 | [1826.06, 1826.41] | 66.618° | 14.974° | 24/24 | 0 (0 NCC, 0 MAD) | 0.9966 |
| seattle-downtown | control-720x480 | 1 | yaw | 360.85 | [360.84, 360.98] | 89.864° | 67.255° | 30/32 | 0.063 (0 NCC, 2 MAD) | 0.9877 |
| seattle-downtown | control-720x480 | 2 | pitch | 720.54 | [720.4, 720.94] | 53.096° | 36.844° | 8/8 | 0 (0 NCC, 0 MAD) | 0.9895 |
| seattle-downtown | control-720x480 | 2 | yaw | 721.19 | [721.09, 721.53] | 53.055° | 36.813° | 24/24 | 0 (0 NCC, 0 MAD) | 0.9896 |
| seattle-downtown | control-720x480 | 3 | yaw | 1442.56 | [1442.47, 1442.71] | 28.025° | 18.892° | 24/24 | 0 (0 NCC, 0 MAD) | 0.9957 |
| seattle-downtown | dpr2-720x480 | 1 | yaw | 360.9 | [360.88, 360.92] | 89.857° | 67.248° | 32/32 | 0 (0 NCC, 0 MAD) | 0.9966 |
| seattle-downtown | dpr2-720x480 | 2 | pitch | 721.16 | [720.86, 721.29] | 53.056° | 36.814° | 8/8 | 0 (0 NCC, 0 MAD) | 0.9981 |
| seattle-downtown | dpr2-720x480 | 2 | yaw | 721.23 | [721.2, 721.25] | 53.052° | 36.811° | 24/24 | 0 (0 NCC, 0 MAD) | 0.9979 |
| seattle-downtown | dpr2-720x480 | 3 | yaw | 1442.61 | [1442.6, 1442.64] | 28.024° | 18.891° | 24/24 | 0 (0 NCC, 0 MAD) | 0.9973 |
| seattle-downtown | portrait-480x853 | 1 | yaw | 427.49 | [427.48, 427.53] | 58.621° | 89.867° | 30/32 | 0.063 (0 NCC, 2 MAD) | 0.9924 |
| seattle-downtown | portrait-480x853 | 2 | pitch | 481.06 | [481.03, 481.39] | 53.029° | 83.119° | 6/8 | 0.25 (2 NCC, 0 MAD) | 0.9943 |
| seattle-downtown | portrait-480x853 | 2 | yaw | 481.31 | [481.19, 481.37] | 53.006° | 83.09° | 24/24 | 0 (0 NCC, 0 MAD) | 0.9934 |
| seattle-downtown | portrait-480x853 | 3 | yaw | 962.18 | [962.1, 962.54] | 28.011° | 47.812° | 24/24 | 0 (0 NCC, 0 MAD) | 0.9952 |
| seattle-downtown | size2x-1440x960 | 1 | yaw | 721.51 | [721.47, 721.54] | 89.88° | 67.269° | 32/32 | 0 (0 NCC, 0 MAD) | 0.991 |
| seattle-downtown | size2x-1440x960 | 2 | pitch | 1442.41 | [1441.91, 1442.57] | 53.054° | 36.813° | 8/8 | 0 (0 NCC, 0 MAD) | 0.9961 |
| seattle-downtown | size2x-1440x960 | 2 | yaw | 1442.47 | [1442.38, 1442.54] | 53.052° | 36.811° | 24/24 | 0 (0 NCC, 0 MAD) | 0.9958 |
| seattle-downtown | size2x-1440x960 | 3 | yaw | 2885.22 | [2885.19, 2885.28] | 28.024° | 18.891° | 24/24 | 0 (0 NCC, 0 MAD) | 0.9973 |
| seattle-downtown | square-480x480 | 1 | yaw | 240.48 | [240.45, 240.56] | 89.886° | 89.886° | 30/32 | 0.063 (0 NCC, 2 MAD) | 0.9934 |
| seattle-downtown | square-480x480 | 2 | pitch | 481 | [480.64, 481.22] | 53.035° | 53.035° | 8/8 | 0 (0 NCC, 0 MAD) | 0.9939 |
| seattle-downtown | square-480x480 | 2 | yaw | 481.08 | [480.99, 481.24] | 53.027° | 53.027° | 24/24 | 0 (0 NCC, 0 MAD) | 0.9917 |
| seattle-downtown | square-480x480 | 3 | yaw | 962.12 | [962.02, 962.43] | 28.013° | 28.013° | 24/24 | 0 (0 NCC, 0 MAD) | 0.9954 |
| seattle-downtown | wide169h-854x480 | 1 | yaw | 428.08 | [428.01, 428.1] | 89.855° | 58.553° | 28/32 | 0.125 (0 NCC, 4 MAD) | 0.9913 |
| seattle-downtown | wide169h-854x480 | 2 | pitch | 855.43 | [855.21, 855.52] | 53.054° | 31.344° | 8/8 | 0 (0 NCC, 0 MAD) | 0.9955 |
| seattle-downtown | wide169h-854x480 | 2 | yaw | 855.55 | [855.53, 855.6] | 53.047° | 31.34° | 22/24 | 0.083 (0 NCC, 2 MAD) | 0.9937 |
| seattle-downtown | wide169h-854x480 | 3 | yaw | 1711.11 | [1711.05, 1711.22] | 28.023° | 15.968° | 24/24 | 0 (0 NCC, 0 MAD) | 0.9974 |
| seattle-downtown | wide169w-720x405 | 1 | yaw | 360.87 | [360.86, 361.01] | 89.862° | 58.598° | 30/32 | 0.063 (0 NCC, 2 MAD) | 0.9865 |
| seattle-downtown | wide169w-720x405 | 2 | pitch | 720.48 | [720.17, 720.78] | 53.099° | 31.397° | 8/8 | 0 (0 NCC, 0 MAD) | 0.9897 |
| seattle-downtown | wide169w-720x405 | 2 | yaw | 721.15 | [720.99, 721.55] | 53.057° | 31.37° | 24/24 | 0 (0 NCC, 0 MAD) | 0.9896 |
| seattle-downtown | wide169w-720x405 | 3 | yaw | 1442.54 | [1442.47, 1442.67] | 28.025° | 15.982° | 24/24 | 0 (0 NCC, 0 MAD) | 0.9958 |
| seattle-downtown | wide219h-1120x480 | 1 | yaw | 561.41 | [561.36, 561.46] | 89.855° | 46.293° | 32/32 | 0 (0 NCC, 0 MAD) | 0.9943 |
| seattle-downtown | wide219h-1120x480 | 2 | pitch | 1121.15 | [1120.91, 1121.47] | 53.083° | 24.165° | 8/8 | 0 (0 NCC, 0 MAD) | 0.9967 |
| seattle-downtown | wide219h-1120x480 | 2 | yaw | 1122.05 | [1122, 1122.17] | 53.046° | 24.147° | 24/24 | 0 (0 NCC, 0 MAD) | 0.9959 |
| seattle-downtown | wide219h-1120x480 | 3 | yaw | 1826.06 | [1825.82, 1826.25] | 34.099° | 14.975° | 24/24 | 0 (0 NCC, 0 MAD) | 0.9967 |
| seattle-downtown | xportrait-360x1000 | 1 | yaw | 501.29 | [501.23, 501.36] | 39.504° | 89.853° | 32/32 | 0 (0 NCC, 0 MAD) | 0.9941 |
| seattle-downtown | xportrait-360x1000 | 2 | pitch | 501.13 | [501.04, 501.16] | 39.515° | 89.87° | 6/8 | 0.25 (2 NCC, 0 MAD) | 0.9934 |
| seattle-downtown | xportrait-360x1000 | 2 | yaw | 501.43 | [501.29, 502.05] | 39.494° | 89.836° | 24/24 | 0 (0 NCC, 0 MAD) | 0.9945 |
| seattle-downtown | xportrait-360x1000 | 3 | yaw | 721.23 | [721.21, 721.33] | 28.027° | 69.464° | 24/24 | 0 (0 NCC, 0 MAD) | 0.9898 |
| seattle-downtown | xwide-2400x480 | 1 | yaw | 1202.37 | [1202.22, 1202.51] | 89.887° | 22.576° | 32/32 | 0 (0 NCC, 0 MAD) | 0.9937 |
| seattle-downtown | xwide-2400x480 | 2 | pitch | 1825.86 | [1824.53, 1826.43] | 66.628° | 14.977° | 8/8 | 0 (0 NCC, 0 MAD) | 0.996 |
| seattle-downtown | xwide-2400x480 | 2 | yaw | 1826.19 | [1825.98, 1826.41] | 66.618° | 14.974° | 24/24 | 0 (0 NCC, 0 MAD) | 0.9946 |
| seattle-downtown | xwide-2400x480 | 3 | yaw | 1826.19 | [1825.98, 1826.41] | 66.618° | 14.974° | 24/24 | 0 (0 NCC, 0 MAD) | 0.9946 |
| teaneck-residential | control-720x480 | 1 | yaw | 360.73 | [360.68, 360.82] | 89.883° | 67.272° | 28/32 | 0.125 (0 NCC, 4 MAD) | 0.9875 |
| teaneck-residential | control-720x480 | 2 | pitch | 720.83 | [720.7, 721.19] | 53.077° | 36.83° | 6/8 | 0.25 (2 NCC, 0 MAD) | 0.989 |
| teaneck-residential | control-720x480 | 2 | yaw | 721.16 | [721.05, 721.28] | 53.056° | 36.815° | 24/24 | 0 (0 NCC, 0 MAD) | 0.9917 |
| teaneck-residential | control-720x480 | 3 | yaw | 1442.12 | [1441.81, 1442.2] | 28.033° | 18.897° | 24/24 | 0 (0 NCC, 0 MAD) | 0.997 |
| teaneck-residential | dpr2-720x480 | 1 | yaw | 360.81 | [360.78, 360.85] | 89.871° | 67.261° | 32/32 | 0 (0 NCC, 0 MAD) | 0.9968 |
| teaneck-residential | dpr2-720x480 | 2 | pitch | 721.19 | [721.13, 721.19] | 53.055° | 36.813° | 6/8 | 0.25 (2 NCC, 0 MAD) | 0.9979 |
| teaneck-residential | dpr2-720x480 | 2 | yaw | 721.22 | [721.16, 721.36] | 53.052° | 36.812° | 24/24 | 0 (0 NCC, 0 MAD) | 0.9968 |
| teaneck-residential | dpr2-720x480 | 3 | yaw | 1442.29 | [1442.11, 1442.42] | 28.03° | 18.895° | 24/24 | 0 (0 NCC, 0 MAD) | 0.9965 |
| teaneck-residential | portrait-480x853 | 1 | yaw | 427.49 | [427.48, 427.55] | 58.622° | 89.868° | 30/32 | 0.063 (0 NCC, 2 MAD) | 0.9924 |
| teaneck-residential | portrait-480x853 | 2 | pitch | 480.96 | [480.86, 481.21] | 53.039° | 83.132° | 8/8 | 0 (0 NCC, 0 MAD) | 0.9944 |
| teaneck-residential | portrait-480x853 | 2 | yaw | 481.21 | [481.07, 481.36] | 53.014° | 83.101° | 24/24 | 0 (0 NCC, 0 MAD) | 0.9937 |
| teaneck-residential | portrait-480x853 | 3 | yaw | 961.91 | [961.8, 962.24] | 28.019° | 47.824° | 24/24 | 0 (0 NCC, 0 MAD) | 0.9953 |
| teaneck-residential | size2x-1440x960 | 1 | yaw | 721.4 | [721.39, 721.4] | 89.888° | 67.277° | 32/32 | 0 (0 NCC, 0 MAD) | 0.9906 |
| teaneck-residential | size2x-1440x960 | 2 | pitch | 1442.31 | [1442.28, 1442.33] | 53.057° | 36.815° | 6/8 | 0.25 (2 NCC, 0 MAD) | 0.9965 |
| teaneck-residential | size2x-1440x960 | 2 | yaw | 1442.43 | [1442.28, 1442.63] | 53.053° | 36.812° | 24/24 | 0 (0 NCC, 0 MAD) | 0.9953 |
| teaneck-residential | size2x-1440x960 | 3 | yaw | 2884.58 | [2884.22, 2884.84] | 28.03° | 18.895° | 24/24 | 0 (0 NCC, 0 MAD) | 0.9965 |
| teaneck-residential | square-480x480 | 1 | yaw | 240.41 | [240.4, 240.55] | 89.903° | 89.903° | 30/32 | 0.063 (0 NCC, 2 MAD) | 0.9927 |
| teaneck-residential | square-480x480 | 2 | pitch | 481.13 | [480.96, 481.33] | 53.022° | 53.022° | 8/8 | 0 (0 NCC, 0 MAD) | 0.9948 |
| teaneck-residential | square-480x480 | 2 | yaw | 481.2 | [481.05, 481.48] | 53.016° | 53.016° | 24/24 | 0 (0 NCC, 0 MAD) | 0.9942 |
| teaneck-residential | square-480x480 | 3 | yaw | 961.92 | [961.71, 962.24] | 28.019° | 28.019° | 24/24 | 0 (0 NCC, 0 MAD) | 0.9965 |
| teaneck-residential | wide169h-854x480 | 1 | yaw | 427.96 | [427.81, 427.98] | 89.871° | 58.567° | 32/32 | 0 (0 NCC, 0 MAD) | 0.9921 |
| teaneck-residential | wide169h-854x480 | 2 | pitch | 855.48 | [855.26, 855.85] | 53.051° | 31.342° | 8/8 | 0 (0 NCC, 0 MAD) | 0.9953 |
| teaneck-residential | wide169h-854x480 | 2 | yaw | 855.36 | [855.12, 855.63] | 53.057° | 31.346° | 24/24 | 0 (0 NCC, 0 MAD) | 0.9945 |
| teaneck-residential | wide169h-854x480 | 3 | yaw | 1710.49 | [1710.35, 1710.6] | 28.033° | 15.974° | 24/24 | 0 (0 NCC, 0 MAD) | 0.9979 |
| teaneck-residential | wide169w-720x405 | 1 | yaw | 360.73 | [360.71, 360.75] | 89.884° | 58.617° | 28/32 | 0.125 (0 NCC, 4 MAD) | 0.9872 |
| teaneck-residential | wide169w-720x405 | 2 | pitch | 720.5 | [720.33, 720.83] | 53.099° | 31.397° | 8/8 | 0 (0 NCC, 0 MAD) | 0.9885 |
| teaneck-residential | wide169w-720x405 | 2 | yaw | 721.17 | [720.96, 721.34] | 53.056° | 31.369° | 24/24 | 0 (0 NCC, 0 MAD) | 0.9912 |
| teaneck-residential | wide169w-720x405 | 3 | yaw | 1441.92 | [1441.72, 1442.09] | 28.037° | 15.988° | 24/24 | 0 (0 NCC, 0 MAD) | 0.9969 |
| teaneck-residential | wide219h-1120x480 | 1 | yaw | 561.26 | [561.26, 561.27] | 89.871° | 46.304° | 32/32 | 0 (0 NCC, 0 MAD) | 0.9951 |
| teaneck-residential | wide219h-1120x480 | 2 | pitch | 1121.62 | [1121.28, 1121.71] | 53.064° | 24.156° | 8/8 | 0 (0 NCC, 0 MAD) | 0.9961 |
| teaneck-residential | wide219h-1120x480 | 2 | yaw | 1121.82 | [1121.74, 1121.91] | 53.056° | 24.151° | 24/24 | 0 (0 NCC, 0 MAD) | 0.9964 |
| teaneck-residential | wide219h-1120x480 | 3 | yaw | 1825.87 | [1825.5, 1826.09] | 34.102° | 14.977° | 24/24 | 0 (0 NCC, 0 MAD) | 0.9979 |
| teaneck-residential | xportrait-360x1000 | 1 | yaw | 501.15 | [501.1, 501.43] | 39.514° | 89.869° | 32/32 | 0 (0 NCC, 0 MAD) | 0.9946 |
| teaneck-residential | xportrait-360x1000 | 2 | pitch | 501.23 | [500.97, 501.46] | 39.508° | 89.859° | 8/8 | 0 (0 NCC, 0 MAD) | 0.9941 |
| teaneck-residential | xportrait-360x1000 | 2 | yaw | 501.71 | [501.15, 501.98] | 39.473° | 89.805° | 24/24 | 0 (0 NCC, 0 MAD) | 0.9952 |
| teaneck-residential | xportrait-360x1000 | 3 | yaw | 721.21 | [720.66, 721.45] | 28.027° | 69.465° | 24/24 | 0 (0 NCC, 0 MAD) | 0.9919 |
| teaneck-residential | xwide-2400x480 | 1 | yaw | 1202.34 | [1202.31, 1202.4] | 89.888° | 22.577° | 32/32 | 0 (0 NCC, 0 MAD) | 0.994 |
| teaneck-residential | xwide-2400x480 | 2 | pitch | 1826.5 | [1826.18, 1826.81] | 66.61° | 14.971° | 4/8 | 0.5 (4 NCC, 0 MAD) | 0.9983 |
| teaneck-residential | xwide-2400x480 | 2 | yaw | 1826.12 | [1826.07, 1826.27] | 66.62° | 14.974° | 24/24 | 0 (0 NCC, 0 MAD) | 0.9964 |
| teaneck-residential | xwide-2400x480 | 3 | yaw | 1826.12 | [1826.07, 1826.27] | 66.62° | 14.974° | 24/24 | 0 (0 NCC, 0 MAD) | 0.9964 |
| tutorial | control-720x480 | 1 | yaw | 361.41 | [361.32, 361.45] | 89.776° | 67.174° | 32/32 | 0 (0 NCC, 0 MAD) | 0.9781 |
| tutorial | control-720x480 | 2 | pitch | 721.99 | [721.88, 722.12] | 53.004° | 36.775° | 8/8 | 0 (0 NCC, 0 MAD) | 0.9953 |
| tutorial | control-720x480 | 2 | yaw | 722.56 | [722.53, 722.68] | 52.968° | 36.748° | 24/24 | 0 (0 NCC, 0 MAD) | 0.9943 |
| tutorial | control-720x480 | 3 | yaw | 1444.48 | [1444.29, 1444.56] | 27.989° | 18.867° | 24/24 | 0 (0 NCC, 0 MAD) | 0.9977 |
| tutorial | dpr2-720x480 | 1 | yaw | 361.45 | [361.35, 361.56] | 89.77° | 67.168° | 32/32 | 0 (0 NCC, 0 MAD) | 0.9916 |
| tutorial | dpr2-720x480 | 2 | pitch | 722.05 | [721.84, 722.16] | 53° | 36.772° | 8/8 | 0 (0 NCC, 0 MAD) | 0.999 |
| tutorial | dpr2-720x480 | 2 | yaw | 722.52 | [722.24, 722.66] | 52.97° | 36.75° | 24/24 | 0 (0 NCC, 0 MAD) | 0.9974 |
| tutorial | dpr2-720x480 | 3 | yaw | 1444.47 | [1444.23, 1444.93] | 27.989° | 18.867° | 24/24 | 0 (0 NCC, 0 MAD) | 0.9984 |
| tutorial | portrait-480x853 | 1 | yaw | 427.98 | [427.96, 428] | 58.566° | 89.802° | 30/32 | 0.063 (0 NCC, 2 MAD) | 0.9878 |
| tutorial | portrait-480x853 | 2 | pitch | 481.63 | [481.57, 481.97] | 52.975° | 83.052° | 8/8 | 0 (0 NCC, 0 MAD) | 0.993 |
| tutorial | portrait-480x853 | 2 | yaw | 481.92 | [481.84, 482.04] | 52.947° | 83.018° | 24/24 | 0 (0 NCC, 0 MAD) | 0.9911 |
| tutorial | portrait-480x853 | 3 | yaw | 963.28 | [963.18, 963.36] | 27.981° | 47.764° | 24/24 | 0 (0 NCC, 0 MAD) | 0.9981 |
| tutorial | size2x-1440x960 | 1 | yaw | 722.9 | [722.71, 723.12] | 89.77° | 67.168° | 32/32 | 0 (0 NCC, 0 MAD) | 0.9916 |
| tutorial | size2x-1440x960 | 2 | pitch | 1444.09 | [1443.67, 1444.32] | 53° | 36.772° | 8/8 | 0 (0 NCC, 0 MAD) | 0.999 |
| tutorial | size2x-1440x960 | 2 | yaw | 1445.05 | [1444.49, 1445.32] | 52.97° | 36.75° | 24/24 | 0 (0 NCC, 0 MAD) | 0.9974 |
| tutorial | size2x-1440x960 | 3 | yaw | 2888.94 | [2888.47, 2889.86] | 27.989° | 18.867° | 24/24 | 0 (0 NCC, 0 MAD) | 0.9984 |
| tutorial | square-480x480 | 1 | yaw | 240.91 | [240.76, 240.98] | 89.783° | 89.783° | 32/32 | 0 (0 NCC, 0 MAD) | 0.9544 |
| tutorial | square-480x480 | 2 | pitch | 481.51 | [481.5, 481.89] | 52.986° | 52.986° | 8/8 | 0 (0 NCC, 0 MAD) | 0.9929 |
| tutorial | square-480x480 | 2 | yaw | 481.88 | [481.84, 481.92] | 52.951° | 52.951° | 24/24 | 0 (0 NCC, 0 MAD) | 0.9903 |
| tutorial | square-480x480 | 3 | yaw | 963.32 | [963.16, 963.43] | 27.979° | 27.979° | 24/24 | 0 (0 NCC, 0 MAD) | 0.9978 |
| tutorial | wide169h-854x480 | 1 | yaw | 428.76 | [428.64, 428.85] | 89.764° | 58.476° | 32/32 | 0 (0 NCC, 0 MAD) | 0.983 |
| tutorial | wide169h-854x480 | 2 | pitch | 856.26 | [856.26, 856.56] | 53.009° | 31.315° | 6/8 | 0.25 (2 NCC, 0 MAD) | 0.9983 |
| tutorial | wide169h-854x480 | 2 | yaw | 857.01 | [856.92, 857.19] | 52.969° | 31.289° | 24/24 | 0 (0 NCC, 0 MAD) | 0.9962 |
| tutorial | wide169h-854x480 | 3 | yaw | 1713.3 | [1713.19, 1713.91] | 27.989° | 15.948° | 24/24 | 0 (0 NCC, 0 MAD) | 0.9978 |
| tutorial | wide169w-720x405 | 1 | yaw | 361.46 | [361.42, 361.48] | 89.768° | 58.518° | 32/32 | 0 (0 NCC, 0 MAD) | 0.9771 |
| tutorial | wide169w-720x405 | 2 | pitch | 721.9 | [721.81, 721.95] | 53.009° | 31.338° | 8/8 | 0 (0 NCC, 0 MAD) | 0.9954 |
| tutorial | wide169w-720x405 | 2 | yaw | 722.64 | [722.49, 722.74] | 52.962° | 31.308° | 24/24 | 0 (0 NCC, 0 MAD) | 0.9944 |
| tutorial | wide169w-720x405 | 3 | yaw | 1444.52 | [1444.26, 1444.61] | 27.988° | 15.96° | 24/24 | 0 (0 NCC, 0 MAD) | 0.9974 |
| tutorial | wide219h-1120x480 | 1 | yaw | 562.35 | [562.13, 562.45] | 89.76° | 46.223° | 32/32 | 0 (0 NCC, 0 MAD) | 0.988 |
| tutorial | wide219h-1120x480 | 2 | pitch | 1123.29 | [1123.14, 1123.6] | 52.996° | 24.121° | 8/8 | 0 (0 NCC, 0 MAD) | 0.9984 |
| tutorial | wide219h-1120x480 | 2 | yaw | 1123.99 | [1123.74, 1124.25] | 52.967° | 24.106° | 24/24 | 0 (0 NCC, 0 MAD) | 0.9963 |
| tutorial | wide219h-1120x480 | 3 | yaw | 1828.73 | [1828.4, 1829.48] | 34.052° | 14.953° | 24/24 | 0 (0 NCC, 0 MAD) | 0.9979 |
| tutorial | xportrait-360x1000 | 1 | yaw | 501.95 | [501.92, 501.97] | 39.456° | 89.777° | 32/32 | 0 (0 NCC, 0 MAD) | 0.991 |
| tutorial | xportrait-360x1000 | 2 | pitch | 501.88 | [501.7, 502.09] | 39.461° | 89.785° | 8/8 | 0 (0 NCC, 0 MAD) | 0.9912 |
| tutorial | xportrait-360x1000 | 2 | yaw | 502.1 | [502.04, 502.42] | 39.445° | 89.76° | 24/24 | 0 (0 NCC, 0 MAD) | 0.9925 |
| tutorial | xportrait-360x1000 | 3 | yaw | 722.48 | [722.14, 722.76] | 27.98° | 69.371° | 24/24 | 0 (0 NCC, 0 MAD) | 0.9965 |
| tutorial | xwide-2400x480 | 1 | yaw | 1204.9 | [1204.24, 1205.37] | 89.766° | 22.53° | 32/32 | 0 (0 NCC, 0 MAD) | 0.9948 |
| tutorial | xwide-2400x480 | 2 | pitch | 1828.21 | [1828.07, 1828.24] | 66.56° | 14.958° | 6/8 | 0.25 (2 NCC, 0 MAD) | 0.9993 |
| tutorial | xwide-2400x480 | 2 | yaw | 1829.53 | [1829.13, 1830.39] | 66.522° | 14.947° | 24/24 | 0 (0 NCC, 0 MAD) | 0.9982 |
| tutorial | xwide-2400x480 | 3 | yaw | 1829.53 | [1829.13, 1830.39] | 66.522° | 14.947° | 24/24 | 0 (0 NCC, 0 MAD) | 0.9982 |

## Aspect comparisons vs 3:2 control

| pano | container | zoom | Δh (°) | Δv (°) | Δdiag (°) | Δlong (°) | tol (°) | h-inv | v-inv | long-inv | regime |
|---|---|---|---|---|---|---|---|---|---|---|---|
| dc-tutorial-site | portrait-480x853 | 1 | -31.254 | 22.602 | -2.629 | -0.007 | 0.5 | NO | NO | yes | ceiling-bound |
| dc-tutorial-site | portrait-480x853 | 2 | -0.052 | 46.268 | 29.026 | 30.029 | 0.5 | yes | NO | NO | unclamped |
| dc-tutorial-site | portrait-480x853 | 3 | -0.015 | 28.923 | 20.528 | 19.788 | 0.5 | yes | NO | NO | unclamped |
| dc-tutorial-site | size2x-1440x960 | 1 | 0.009 | 0.008 | 0.009 | 0.01 | 0.5 | yes | yes | yes | unclamped |
| dc-tutorial-site | size2x-1440x960 | 2 | 0.01 | 0.007 | 0.01 | 0.01 | 0.5 | yes | yes | yes | unclamped |
| dc-tutorial-site | size2x-1440x960 | 3 | -0.002 | -0.001 | -0.002 | -0.002 | 0.5 | yes | yes | yes | unclamped |
| dc-tutorial-site | square-480x480 | 1 | 0.016 | 22.626 | 9.015 | 0.016 | 0.5 | yes | NO | yes | unclamped |
| dc-tutorial-site | square-480x480 | 2 | -0.026 | 16.213 | 8.486 | -0.026 | 0.5 | yes | NO | yes | unclamped |
| dc-tutorial-site | square-480x480 | 3 | -0.014 | 9.121 | 5.47 | -0.014 | 0.5 | yes | NO | yes | unclamped |
| dc-tutorial-site | wide169h-854x480 | 1 | -0.005 | -8.699 | -2.642 | -0.004 | 0.5 | yes | NO | yes | unclamped |
| dc-tutorial-site | wide169h-854x480 | 2 | 0.004 | -5.465 | -2.325 | 0.004 | 0.5 | yes | NO | yes | unclamped |
| dc-tutorial-site | wide169h-854x480 | 3 | -0.001 | -2.923 | -1.442 | -0.001 | 0.5 | yes | NO | yes | unclamped |
| dc-tutorial-site | wide169w-720x405 | 1 | -0.007 | -8.662 | -2.633 | -0.006 | 0.5 | yes | NO | yes | unclamped |
| dc-tutorial-site | wide169w-720x405 | 2 | 0.007 | -5.44 | -2.313 | 0.007 | 0.5 | yes | NO | yes | unclamped |
| dc-tutorial-site | wide169w-720x405 | 3 | -0.001 | -2.911 | -1.437 | -0.001 | 0.5 | yes | NO | yes | unclamped |
| dc-tutorial-site | wide219h-1120x480 | 1 | -0.008 | -20.964 | -5.66 | -0.007 | 0.5 | yes | NO | yes | unclamped |
| dc-tutorial-site | wide219h-1120x480 | 2 | 0.006 | -12.657 | -4.904 | 0.006 | 0.5 | yes | NO | yes | unclamped |
| dc-tutorial-site | wide219h-1120x480 | 3 | 6.07 | -3.919 | 3.507 | 6.07 | 0.5 | NO | NO | NO | floor-bound |
| dc-tutorial-site | xportrait-360x1000 | 1 | -50.376 | 22.58 | -7.019 | -0.03 | 0.5 | NO | NO | yes | ceiling-bound |
| dc-tutorial-site | xportrait-360x1000 | 2 | -13.571 | 53 | 31.383 | 36.76 | 0.5 | NO | NO | NO | ceiling-bound |
| dc-tutorial-site | xportrait-360x1000 | 3 | -0.003 | 50.569 | 39.37 | 41.434 | 0.5 | yes | NO | NO | unclamped |
| dc-tutorial-site | xwide-2400x480 | 1 | 0.012 | -44.689 | -9.343 | 0.012 | 0.5 | yes | NO | yes | unclamped |
| dc-tutorial-site | xwide-2400x480 | 2 | 13.572 | -21.833 | 5.74 | 13.572 | 0.5 | NO | NO | NO | floor-bound |
| dc-tutorial-site | xwide-2400x480 | 3 | 38.588 | -3.921 | 34.256 | 38.588 | 0.5 | NO | NO | NO | floor-bound |
| seattle-downtown | portrait-480x853 | 1 | -31.243 | 22.612 | -2.617 | 0.002 | 0.5 | NO | NO | yes | ceiling-bound |
| seattle-downtown | portrait-480x853 | 2 | -0.049 | 46.277 | 29.032 | 30.035 | 0.5 | yes | NO | NO | unclamped |
| seattle-downtown | portrait-480x853 | 3 | -0.014 | 28.92 | 20.527 | 19.787 | 0.5 | yes | NO | NO | unclamped |
| seattle-downtown | size2x-1440x960 | 1 | 0.016 | 0.014 | 0.015 | 0.015 | 0.5 | yes | yes | yes | unclamped |
| seattle-downtown | size2x-1440x960 | 2 | -0.003 | -0.002 | -0.003 | -0.003 | 0.5 | yes | yes | yes | unclamped |
| seattle-downtown | size2x-1440x960 | 3 | -0.001 | -0.001 | -0.001 | -0.001 | 0.5 | yes | yes | yes | unclamped |
| seattle-downtown | square-480x480 | 1 | 0.022 | 22.631 | 9.022 | 0.021 | 0.5 | yes | NO | yes | unclamped |
| seattle-downtown | square-480x480 | 2 | -0.028 | 16.214 | 8.486 | -0.027 | 0.5 | yes | NO | yes | unclamped |
| seattle-downtown | square-480x480 | 3 | -0.012 | 9.121 | 5.472 | -0.012 | 0.5 | yes | NO | yes | unclamped |
| seattle-downtown | wide169h-854x480 | 1 | -0.009 | -8.702 | -2.646 | -0.01 | 0.5 | yes | NO | yes | unclamped |
| seattle-downtown | wide169h-854x480 | 2 | -0.008 | -5.473 | -2.337 | -0.007 | 0.5 | yes | NO | yes | unclamped |
| seattle-downtown | wide169h-854x480 | 3 | -0.002 | -2.924 | -1.442 | -0.001 | 0.5 | yes | NO | yes | unclamped |
| seattle-downtown | wide169w-720x405 | 1 | -0.002 | -8.657 | -2.628 | -0.003 | 0.5 | yes | NO | yes | unclamped |
| seattle-downtown | wide169w-720x405 | 2 | 0.002 | -5.443 | -2.317 | 0.003 | 0.5 | yes | NO | yes | unclamped |
| seattle-downtown | wide169w-720x405 | 3 | 0 | -2.91 | -1.435 | 0 | 0.5 | yes | NO | yes | unclamped |
| seattle-downtown | wide219h-1120x480 | 1 | -0.009 | -20.962 | -5.661 | -0.009 | 0.5 | yes | NO | yes | unclamped |
| seattle-downtown | wide219h-1120x480 | 2 | -0.009 | -12.666 | -4.919 | -0.008 | 0.5 | yes | NO | yes | unclamped |
| seattle-downtown | wide219h-1120x480 | 3 | 6.074 | -3.917 | 3.511 | 6.074 | 0.5 | NO | NO | NO | floor-bound |
| seattle-downtown | xportrait-360x1000 | 1 | -50.36 | 22.598 | -7 | -0.013 | 0.5 | NO | NO | yes | ceiling-bound |
| seattle-downtown | xportrait-360x1000 | 2 | -13.561 | 53.023 | 31.404 | 36.782 | 0.5 | NO | NO | NO | ceiling-bound |
| seattle-downtown | xportrait-360x1000 | 3 | 0.002 | 50.572 | 39.376 | 41.439 | 0.5 | yes | NO | NO | unclamped |
| seattle-downtown | xwide-2400x480 | 1 | 0.023 | -44.679 | -9.331 | 0.022 | 0.5 | yes | NO | yes | unclamped |
| seattle-downtown | xwide-2400x480 | 2 | 13.563 | -21.839 | 5.732 | 13.564 | 0.5 | NO | NO | NO | floor-bound |
| seattle-downtown | xwide-2400x480 | 3 | 38.593 | -3.918 | 34.263 | 38.594 | 0.5 | NO | NO | NO | floor-bound |
| teaneck-residential | portrait-480x853 | 1 | -31.261 | 22.596 | -2.636 | -0.017 | 0.5 | NO | NO | yes | ceiling-bound |
| teaneck-residential | portrait-480x853 | 2 | -0.042 | 46.286 | 29.041 | 30.045 | 0.5 | yes | NO | NO | unclamped |
| teaneck-residential | portrait-480x853 | 3 | -0.014 | 28.927 | 20.53 | 19.791 | 0.5 | yes | NO | NO | unclamped |
| teaneck-residential | size2x-1440x960 | 1 | 0.005 | 0.005 | 0.005 | 0.005 | 0.5 | yes | yes | yes | unclamped |
| teaneck-residential | size2x-1440x960 | 2 | -0.003 | -0.003 | -0.004 | -0.003 | 0.5 | yes | yes | yes | unclamped |
| teaneck-residential | size2x-1440x960 | 3 | -0.003 | -0.002 | -0.004 | -0.003 | 0.5 | yes | yes | yes | unclamped |
| teaneck-residential | square-480x480 | 1 | 0.02 | 22.631 | 9.019 | 0.018 | 0.5 | yes | NO | yes | unclamped |
| teaneck-residential | square-480x480 | 2 | -0.04 | 16.201 | 8.47 | -0.041 | 0.5 | yes | NO | yes | unclamped |
| teaneck-residential | square-480x480 | 3 | -0.014 | 9.122 | 5.47 | -0.014 | 0.5 | yes | NO | yes | unclamped |
| teaneck-residential | wide169h-854x480 | 1 | -0.012 | -8.705 | -2.649 | -0.013 | 0.5 | yes | NO | yes | unclamped |
| teaneck-residential | wide169h-854x480 | 2 | 0.001 | -5.469 | -2.329 | 0.001 | 0.5 | yes | NO | yes | unclamped |
| teaneck-residential | wide169h-854x480 | 3 | 0 | -2.923 | -1.441 | 0 | 0.5 | yes | NO | yes | unclamped |
| teaneck-residential | wide169w-720x405 | 1 | 0.001 | -8.655 | -2.625 | 0 | 0.5 | yes | NO | yes | unclamped |
| teaneck-residential | wide169w-720x405 | 2 | 0 | -5.446 | -2.321 | -0.001 | 0.5 | yes | NO | yes | unclamped |
| teaneck-residential | wide169w-720x405 | 3 | 0.004 | -2.909 | -1.432 | 0.004 | 0.5 | yes | NO | yes | unclamped |
| teaneck-residential | wide219h-1120x480 | 1 | -0.012 | -20.968 | -5.665 | -0.013 | 0.5 | yes | NO | yes | unclamped |
| teaneck-residential | wide219h-1120x480 | 2 | 0 | -12.664 | -4.911 | -0.001 | 0.5 | yes | NO | yes | unclamped |
| teaneck-residential | wide219h-1120x480 | 3 | 6.069 | -3.92 | 3.505 | 6.069 | 0.5 | NO | NO | NO | floor-bound |
| teaneck-residential | xportrait-360x1000 | 1 | -50.369 | 22.597 | -7.003 | -0.016 | 0.5 | NO | NO | yes | ceiling-bound |
| teaneck-residential | xportrait-360x1000 | 2 | -13.583 | 52.99 | 31.37 | 36.748 | 0.5 | NO | NO | NO | ceiling-bound |
| teaneck-residential | xportrait-360x1000 | 3 | -0.006 | 50.568 | 39.367 | 41.433 | 0.5 | yes | NO | NO | unclamped |
| teaneck-residential | xwide-2400x480 | 1 | 0.005 | -44.695 | -9.349 | 0.004 | 0.5 | yes | NO | yes | unclamped |
| teaneck-residential | xwide-2400x480 | 2 | 13.564 | -21.841 | 5.732 | 13.564 | 0.5 | NO | NO | NO | floor-bound |
| teaneck-residential | xwide-2400x480 | 3 | 38.587 | -3.923 | 34.255 | 38.587 | 0.5 | NO | NO | NO | floor-bound |
| tutorial | portrait-480x853 | 1 | -31.21 | 22.628 | -2.596 | 0.025 | 0.5 | NO | NO | yes | ceiling-bound |
| tutorial | portrait-480x853 | 2 | -0.021 | 46.27 | 29.055 | 30.05 | 0.5 | yes | NO | NO | unclamped |
| tutorial | portrait-480x853 | 3 | -0.008 | 28.897 | 20.516 | 19.775 | 0.5 | yes | NO | NO | unclamped |
| tutorial | size2x-1440x960 | 1 | -0.006 | -0.006 | -0.006 | -0.006 | 0.5 | yes | yes | yes | unclamped |
| tutorial | size2x-1440x960 | 2 | 0.002 | 0.002 | 0.003 | 0.002 | 0.5 | yes | yes | yes | unclamped |
| tutorial | size2x-1440x960 | 3 | 0 | 0 | 0 | 0 | 0.5 | yes | yes | yes | unclamped |
| tutorial | square-480x480 | 1 | 0.007 | 22.609 | 9.01 | 0.007 | 0.5 | yes | NO | yes | unclamped |
| tutorial | square-480x480 | 2 | -0.017 | 16.203 | 8.492 | -0.016 | 0.5 | yes | NO | yes | unclamped |
| tutorial | square-480x480 | 3 | -0.01 | 9.112 | 5.469 | -0.009 | 0.5 | yes | NO | yes | unclamped |
| tutorial | wide169h-854x480 | 1 | -0.012 | -8.698 | -2.649 | -0.012 | 0.5 | yes | NO | yes | unclamped |
| tutorial | wide169h-854x480 | 2 | 0.001 | -5.459 | -2.326 | 0.001 | 0.5 | yes | NO | yes | unclamped |
| tutorial | wide169h-854x480 | 3 | 0 | -2.919 | -1.439 | 0 | 0.5 | yes | NO | yes | unclamped |
| tutorial | wide169w-720x405 | 1 | -0.008 | -8.656 | -2.635 | -0.008 | 0.5 | yes | NO | yes | unclamped |
| tutorial | wide169w-720x405 | 2 | -0.006 | -5.44 | -2.324 | -0.005 | 0.5 | yes | NO | yes | unclamped |
| tutorial | wide169w-720x405 | 3 | -0.001 | -2.907 | -1.434 | -0.001 | 0.5 | yes | NO | yes | unclamped |
| tutorial | wide219h-1120x480 | 1 | -0.016 | -20.951 | -5.67 | -0.016 | 0.5 | yes | NO | yes | unclamped |
| tutorial | wide219h-1120x480 | 2 | -0.001 | -12.642 | -4.906 | 0 | 0.5 | yes | NO | yes | unclamped |
| tutorial | wide219h-1120x480 | 3 | 6.063 | -3.914 | 3.503 | 6.063 | 0.5 | NO | NO | NO | floor-bound |
| tutorial | xportrait-360x1000 | 1 | -50.32 | 22.603 | -6.99 | 0.001 | 0.5 | NO | NO | yes | ceiling-bound |
| tutorial | xportrait-360x1000 | 2 | -13.523 | 53.012 | 31.423 | 36.792 | 0.5 | NO | NO | NO | ceiling-bound |
| tutorial | xportrait-360x1000 | 3 | -0.009 | 50.504 | 39.323 | 41.382 | 0.5 | yes | NO | NO | unclamped |
| tutorial | xwide-2400x480 | 1 | -0.01 | -44.644 | -9.366 | -0.01 | 0.5 | yes | NO | yes | unclamped |
| tutorial | xwide-2400x480 | 2 | 13.554 | -21.801 | 5.731 | 13.555 | 0.5 | NO | NO | NO | floor-bound |
| tutorial | xwide-2400x480 | 3 | 38.533 | -3.92 | 34.208 | 38.533 | 0.5 | NO | NO | NO | floor-bound |

## Method gate (3:2 control vs zoomToFov)

| pano | zoom | measured hFov | expected | err (°) | pass |
|---|---|---|---|---|---|
| dc-tutorial-site | 1 | 89.875° | 89.75° | 0.125 | yes |
| dc-tutorial-site | 2 | 53.046° | 53° | 0.046 | yes |
| dc-tutorial-site | 3 | 28.03° | 27.68198649088542° | 0.348 | yes |
| seattle-downtown | 1 | 89.864° | 89.75° | 0.114 | yes |
| seattle-downtown | 2 | 53.055° | 53° | 0.055 | yes |
| seattle-downtown | 3 | 28.025° | 27.68198649088542° | 0.343 | yes |
| teaneck-residential | 1 | 89.883° | 89.75° | 0.133 | yes |
| teaneck-residential | 2 | 53.056° | 53° | 0.056 | yes |
| teaneck-residential | 3 | 28.033° | 27.68198649088542° | 0.351 | yes |
