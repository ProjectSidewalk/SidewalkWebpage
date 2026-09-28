### seattle

79 regions, 23993 streets, 2263.0 km, 332 starts; jump lower bound 4580 (2.02 per km). Largest region 41 (773 streets) constructs and plans in 8.5 ms (warm).

**Jumps at 25 m (headline: what a labeler experiences as a jump)**

| Policy | jumps/km | jumps/km (median region) | median jump m | jump m per km | dead ends/km | priority-AUC | priority-AUC (median region) | jumps / lower bound |
|---|---:|---:|---:|---:|---:|---:|---:|---:|
| current | 4.15 | 4.11 | 787 | 3745 | 2.40 | 0.939 | 0.945 | 2.05 |
| current+nearest | 4.05 | 4.01 | 224 | 1368 | 2.39 | 0.939 | 0.942 | 2.00 |
| tolerant tol=0.25 | 3.10 | 3.11 | 823 | 2923 | 2.50 | 0.884 | 0.880 | 1.53 |
| tolerant tol=0.5 | 2.62 | 2.75 | 851 | 2559 | 2.50 | 0.812 | 0.813 | 1.30 |
| tolerant tol=1 | 2.49 | 2.58 | 859 | 2437 | 2.49 | 0.791 | 0.794 | 1.23 |
| planner tol=0.05 pen=0 | 5.17 | 5.12 | 162 | 1478 | 2.64 | 0.988 | 0.991 | 2.55 |
| planner tol=0.05 pen=300 | 4.94 | 4.78 | 206 | 1593 | 1.96 | 0.988 | 0.991 | 2.44 |
| planner tol=0.05 pen=1000 | 4.93 | 4.80 | 214 | 1720 | 1.96 | 0.988 | 0.992 | 2.44 |
| planner tol=0.1 pen=0 | 4.55 | 4.53 | 138 | 1146 | 2.59 | 0.958 | 0.972 | 2.25 |
| planner tol=0.1 pen=300 | 4.36 | 4.27 | 186 | 1254 | 1.96 | 0.962 | 0.970 | 2.16 |
| planner tol=0.1 pen=1000 | 4.29 | 4.23 | 191 | 1309 | 1.95 | 0.957 | 0.967 | 2.12 |
| planner tol=0.15 pen=0 | 4.33 | 4.25 | 131 | 1061 | 2.58 | 0.936 | 0.947 | 2.14 |
| planner tol=0.15 pen=300 | 4.09 | 4.09 | 177 | 1141 | 1.97 | 0.941 | 0.946 | 2.02 |
| planner tol=0.15 pen=1000 | 4.06 | 4.02 | 181 | 1209 | 1.96 | 0.938 | 0.944 | 2.01 |
| planner tol=0.2 pen=0 | 3.84 | 3.76 | 123 | 887 | 2.50 | 0.892 | 0.900 | 1.90 |
| planner tol=0.2 pen=300 | 3.53 | 3.37 | 163 | 929 | 1.94 | 0.889 | 0.899 | 1.74 |
| planner tol=0.2 pen=1000 | 3.50 | 3.38 | 166 | 987 | 1.93 | 0.889 | 0.895 | 1.73 |
| planner tol=0.25 pen=0 | 3.35 | 3.38 | 119 | 771 | 2.44 | 0.837 | 0.855 | 1.66 |
| planner tol=0.25 pen=300 | 3.00 | 3.07 | 160 | 789 | 1.90 | 0.836 | 0.850 | 1.48 |
| planner tol=0.25 pen=1000 | 2.98 | 3.08 | 162 | 835 | 1.89 | 0.837 | 0.849 | 1.47 |
| planner tol=0.5 pen=0 | 3.06 | 3.21 | 107 | 628 | 2.37 | 0.768 | 0.797 | 1.51 |
| planner tol=0.5 pen=300 | 2.70 | 2.89 | 137 | 633 | 1.90 | 0.766 | 0.784 | 1.34 |
| planner tol=0.5 pen=1000 | 2.70 | 2.89 | 140 | 662 | 1.89 | 0.767 | 0.789 | 1.33 |
| planner tol=1 pen=0 | 2.26 | 2.35 | 98 | 429 | 2.24 | 0.628 | 0.628 | 1.12 |
| planner tol=1 pen=300 | 1.93 | 1.99 | 104 | 394 | 1.90 | 0.626 | 0.624 | 0.96 |
| planner tol=1 pen=1000 | 1.93 | 1.99 | 104 | 398 | 1.89 | 0.626 | 0.624 | 0.95 |

**Jumps at 10 m (the planner's node tolerance; priority-AUC does not depend on the yardstick)**

| Policy | jumps/km | jumps/km (median region) | median jump m | jump m per km | dead ends/km | jumps / lower bound |
|---|---:|---:|---:|---:|---:|---:|
| current | 4.37 | 4.30 | 745 | 3749 | 2.69 | 2.16 |
| current+nearest | 4.29 | 4.23 | 213 | 1372 | 2.68 | 2.12 |
| tolerant tol=0.25 | 3.34 | 3.43 | 762 | 2927 | 2.76 | 1.65 |
| tolerant tol=0.5 | 2.87 | 3.03 | 787 | 2563 | 2.75 | 1.42 |
| tolerant tol=1 | 2.74 | 2.81 | 788 | 2442 | 2.74 | 1.36 |
| planner tol=0.05 pen=0 | 5.39 | 5.32 | 156 | 1482 | 2.93 | 2.66 |
| planner tol=0.05 pen=300 | 5.07 | 4.97 | 203 | 1595 | 2.16 | 2.50 |
| planner tol=0.05 pen=1000 | 5.06 | 4.98 | 208 | 1723 | 2.14 | 2.50 |
| planner tol=0.1 pen=0 | 4.78 | 4.73 | 129 | 1150 | 2.86 | 2.36 |
| planner tol=0.1 pen=300 | 4.49 | 4.39 | 179 | 1256 | 2.16 | 2.22 |
| planner tol=0.1 pen=1000 | 4.42 | 4.35 | 182 | 1311 | 2.14 | 2.18 |
| planner tol=0.15 pen=0 | 4.55 | 4.39 | 122 | 1065 | 2.84 | 2.25 |
| planner tol=0.15 pen=300 | 4.22 | 4.18 | 170 | 1143 | 2.16 | 2.09 |
| planner tol=0.15 pen=1000 | 4.19 | 4.12 | 173 | 1211 | 2.15 | 2.07 |
| planner tol=0.2 pen=0 | 4.07 | 4.05 | 112 | 891 | 2.75 | 2.01 |
| planner tol=0.2 pen=300 | 3.67 | 3.59 | 158 | 932 | 2.12 | 1.82 |
| planner tol=0.2 pen=1000 | 3.65 | 3.56 | 160 | 989 | 2.11 | 1.80 |
| planner tol=0.25 pen=0 | 3.58 | 3.64 | 107 | 774 | 2.69 | 1.77 |
| planner tol=0.25 pen=300 | 3.16 | 3.23 | 150 | 792 | 2.09 | 1.56 |
| planner tol=0.25 pen=1000 | 3.14 | 3.23 | 151 | 838 | 2.08 | 1.55 |
| planner tol=0.5 pen=0 | 3.30 | 3.43 | 101 | 633 | 2.61 | 1.63 |
| planner tol=0.5 pen=300 | 2.87 | 2.98 | 129 | 636 | 2.09 | 1.42 |
| planner tol=0.5 pen=1000 | 2.86 | 2.93 | 130 | 664 | 2.08 | 1.42 |
| planner tol=1 pen=0 | 2.48 | 2.62 | 93 | 433 | 2.47 | 1.23 |
| planner tol=1 pen=300 | 2.11 | 2.24 | 98 | 397 | 2.09 | 1.04 |
| planner tol=1 pen=1000 | 2.11 | 2.24 | 98 | 401 | 2.09 | 1.04 |

### teaneck

23 regions, 2134 streets, 199.3 km, 83 starts; jump lower bound 497 (2.49 per km). Largest region 12 (131 streets) constructs and plans in 0.5 ms (warm).

**Jumps at 25 m (headline: what a labeler experiences as a jump)**

| Policy | jumps/km | jumps/km (median region) | median jump m | jump m per km | dead ends/km | priority-AUC | priority-AUC (median region) | jumps / lower bound |
|---|---:|---:|---:|---:|---:|---:|---:|---:|
| current | 4.39 | 4.34 | 447 | 2162 | 2.99 | 0.961 | 0.971 | 1.76 |
| current+nearest | 4.30 | 4.34 | 198 | 1129 | 3.03 | 0.958 | 0.967 | 1.72 |
| tolerant tol=0.25 | 3.78 | 3.72 | 467 | 1891 | 3.18 | 0.905 | 0.924 | 1.52 |
| tolerant tol=0.5 | 3.28 | 3.14 | 476 | 1688 | 3.27 | 0.809 | 0.821 | 1.32 |
| tolerant tol=1 | 3.28 | 3.14 | 480 | 1692 | 3.28 | 0.808 | 0.821 | 1.31 |
| planner tol=0.05 pen=0 | 4.62 | 4.68 | 156 | 1070 | 2.88 | 0.991 | 0.992 | 1.85 |
| planner tol=0.05 pen=300 | 4.39 | 4.52 | 189 | 1138 | 2.28 | 0.989 | 0.993 | 1.76 |
| planner tol=0.05 pen=1000 | 4.37 | 4.45 | 193 | 1178 | 2.28 | 0.990 | 0.993 | 1.75 |
| planner tol=0.1 pen=0 | 4.10 | 4.20 | 134 | 864 | 2.89 | 0.954 | 0.965 | 1.64 |
| planner tol=0.1 pen=300 | 3.86 | 4.06 | 166 | 907 | 2.29 | 0.957 | 0.969 | 1.55 |
| planner tol=0.1 pen=1000 | 3.79 | 4.06 | 170 | 915 | 2.29 | 0.955 | 0.969 | 1.52 |
| planner tol=0.15 pen=0 | 3.91 | 4.11 | 132 | 798 | 2.86 | 0.934 | 0.952 | 1.57 |
| planner tol=0.15 pen=300 | 3.65 | 3.89 | 168 | 852 | 2.32 | 0.937 | 0.964 | 1.47 |
| planner tol=0.15 pen=1000 | 3.63 | 3.88 | 171 | 868 | 2.31 | 0.936 | 0.964 | 1.46 |
| planner tol=0.2 pen=0 | 3.50 | 3.59 | 118 | 668 | 2.80 | 0.878 | 0.906 | 1.40 |
| planner tol=0.2 pen=300 | 3.19 | 3.41 | 152 | 686 | 2.25 | 0.878 | 0.919 | 1.28 |
| planner tol=0.2 pen=1000 | 3.17 | 3.34 | 151 | 697 | 2.24 | 0.878 | 0.919 | 1.27 |
| planner tol=0.25 pen=0 | 3.46 | 3.61 | 115 | 640 | 2.81 | 0.848 | 0.877 | 1.39 |
| planner tol=0.25 pen=300 | 3.08 | 3.32 | 142 | 647 | 2.27 | 0.851 | 0.871 | 1.23 |
| planner tol=0.25 pen=1000 | 3.06 | 3.29 | 141 | 658 | 2.26 | 0.850 | 0.873 | 1.23 |
| planner tol=0.5 pen=0 | 2.85 | 2.67 | 94 | 479 | 2.72 | 0.669 | 0.666 | 1.14 |
| planner tol=0.5 pen=300 | 2.48 | 2.37 | 100 | 439 | 2.33 | 0.671 | 0.667 | 0.99 |
| planner tol=0.5 pen=1000 | 2.47 | 2.37 | 100 | 450 | 2.33 | 0.671 | 0.667 | 0.99 |
| planner tol=1 pen=0 | 2.74 | 2.63 | 94 | 453 | 2.72 | 0.649 | 0.648 | 1.10 |
| planner tol=1 pen=300 | 2.37 | 2.27 | 99 | 413 | 2.34 | 0.651 | 0.652 | 0.95 |
| planner tol=1 pen=1000 | 2.37 | 2.25 | 99 | 422 | 2.34 | 0.652 | 0.652 | 0.95 |

**Jumps at 10 m (the planner's node tolerance; priority-AUC does not depend on the yardstick)**

| Policy | jumps/km | jumps/km (median region) | median jump m | jump m per km | dead ends/km | jumps / lower bound |
|---|---:|---:|---:|---:|---:|---:|
| current | 4.61 | 4.41 | 426 | 2166 | 3.24 | 1.85 |
| current+nearest | 4.59 | 4.58 | 188 | 1134 | 3.28 | 1.84 |
| tolerant tol=0.25 | 4.03 | 3.89 | 433 | 1895 | 3.45 | 1.62 |
| tolerant tol=0.5 | 3.55 | 3.50 | 450 | 1693 | 3.53 | 1.42 |
| tolerant tol=1 | 3.54 | 3.50 | 454 | 1696 | 3.54 | 1.42 |
| planner tol=0.05 pen=0 | 4.82 | 4.89 | 147 | 1073 | 3.15 | 1.93 |
| planner tol=0.05 pen=300 | 4.53 | 4.64 | 185 | 1140 | 2.49 | 1.82 |
| planner tol=0.05 pen=1000 | 4.50 | 4.52 | 188 | 1180 | 2.48 | 1.81 |
| planner tol=0.1 pen=0 | 4.31 | 4.42 | 122 | 867 | 3.16 | 1.73 |
| planner tol=0.1 pen=300 | 4.01 | 4.28 | 158 | 910 | 2.51 | 1.61 |
| planner tol=0.1 pen=1000 | 3.95 | 4.26 | 163 | 917 | 2.50 | 1.58 |
| planner tol=0.15 pen=0 | 4.12 | 4.24 | 121 | 801 | 3.10 | 1.65 |
| planner tol=0.15 pen=300 | 3.82 | 4.10 | 158 | 855 | 2.52 | 1.53 |
| planner tol=0.15 pen=1000 | 3.80 | 4.03 | 163 | 870 | 2.51 | 1.52 |
| planner tol=0.2 pen=0 | 3.72 | 3.66 | 107 | 672 | 3.06 | 1.49 |
| planner tol=0.2 pen=300 | 3.39 | 3.44 | 139 | 690 | 2.47 | 1.36 |
| planner tol=0.2 pen=1000 | 3.37 | 3.40 | 139 | 700 | 2.46 | 1.35 |
| planner tol=0.25 pen=0 | 3.68 | 3.70 | 104 | 644 | 3.07 | 1.48 |
| planner tol=0.25 pen=300 | 3.26 | 3.44 | 134 | 650 | 2.49 | 1.31 |
| planner tol=0.25 pen=1000 | 3.24 | 3.30 | 133 | 661 | 2.47 | 1.30 |
| planner tol=0.5 pen=0 | 3.10 | 3.00 | 90 | 484 | 2.98 | 1.24 |
| planner tol=0.5 pen=300 | 2.69 | 2.57 | 94 | 442 | 2.56 | 1.08 |
| planner tol=0.5 pen=1000 | 2.69 | 2.57 | 94 | 454 | 2.56 | 1.08 |
| planner tol=1 pen=0 | 3.00 | 2.92 | 89 | 458 | 2.98 | 1.20 |
| planner tol=1 pen=300 | 2.59 | 2.47 | 93 | 417 | 2.57 | 1.04 |
| planner tol=1 pen=1000 | 2.59 | 2.47 | 93 | 426 | 2.58 | 1.04 |

### richmond

9 regions, 704 streets, 45.7 km, 45 starts; jump lower bound 115 (2.52 per km). Largest region 83 (144 streets) constructs and plans in 0.5 ms (warm).

**Jumps at 25 m (headline: what a labeler experiences as a jump)**

| Policy | jumps/km | jumps/km (median region) | median jump m | jump m per km | dead ends/km | priority-AUC | priority-AUC (median region) | jumps / lower bound |
|---|---:|---:|---:|---:|---:|---:|---:|---:|
| current | 3.34 | 3.26 | 396 | 1493 | 3.24 | 1.000 | 1.000 | 1.33 |
| current+nearest | 3.18 | 3.05 | 120 | 569 | 3.07 | 1.000 | 1.000 | 1.26 |
| tolerant tol=0.25 | 3.34 | 3.26 | 396 | 1493 | 3.24 | 1.000 | 1.000 | 1.33 |
| tolerant tol=0.5 | 3.25 | 3.23 | 399 | 1469 | 3.22 | 0.938 | 0.932 | 1.29 |
| tolerant tol=1 | 3.17 | 3.12 | 402 | 1434 | 3.17 | 0.855 | 0.857 | 1.26 |
| planner tol=0.05 pen=0 | 2.82 | 2.69 | 119 | 545 | 2.68 | 0.998 | 0.998 | 1.12 |
| planner tol=0.05 pen=300 | 2.50 | 2.53 | 156 | 547 | 2.28 | 0.998 | 0.998 | 0.99 |
| planner tol=0.05 pen=1000 | 2.50 | 2.53 | 156 | 547 | 2.28 | 0.998 | 0.998 | 0.99 |
| planner tol=0.1 pen=0 | 2.82 | 2.69 | 119 | 545 | 2.68 | 0.998 | 0.998 | 1.12 |
| planner tol=0.1 pen=300 | 2.50 | 2.53 | 156 | 547 | 2.28 | 0.998 | 0.998 | 0.99 |
| planner tol=0.1 pen=1000 | 2.50 | 2.53 | 156 | 547 | 2.28 | 0.998 | 0.998 | 0.99 |
| planner tol=0.15 pen=0 | 2.82 | 2.69 | 119 | 545 | 2.68 | 0.998 | 0.998 | 1.12 |
| planner tol=0.15 pen=300 | 2.50 | 2.53 | 156 | 547 | 2.28 | 0.998 | 0.998 | 0.99 |
| planner tol=0.15 pen=1000 | 2.50 | 2.53 | 156 | 547 | 2.28 | 0.998 | 0.998 | 0.99 |
| planner tol=0.2 pen=0 | 2.82 | 2.69 | 119 | 545 | 2.68 | 0.996 | 0.996 | 1.12 |
| planner tol=0.2 pen=300 | 2.50 | 2.53 | 156 | 542 | 2.28 | 0.997 | 0.997 | 0.99 |
| planner tol=0.2 pen=1000 | 2.50 | 2.53 | 156 | 542 | 2.28 | 0.997 | 0.997 | 0.99 |
| planner tol=0.25 pen=0 | 2.82 | 2.69 | 119 | 545 | 2.68 | 0.996 | 0.996 | 1.12 |
| planner tol=0.25 pen=300 | 2.50 | 2.53 | 156 | 542 | 2.28 | 0.997 | 0.997 | 0.99 |
| planner tol=0.25 pen=1000 | 2.50 | 2.53 | 156 | 542 | 2.28 | 0.997 | 0.997 | 0.99 |
| planner tol=0.5 pen=0 | 2.76 | 2.64 | 119 | 524 | 2.67 | 0.800 | 0.779 | 1.10 |
| planner tol=0.5 pen=300 | 2.40 | 2.45 | 135 | 496 | 2.28 | 0.743 | 0.722 | 0.95 |
| planner tol=0.5 pen=1000 | 2.40 | 2.45 | 135 | 496 | 2.28 | 0.743 | 0.722 | 0.95 |
| planner tol=1 pen=0 | 2.74 | 2.64 | 119 | 508 | 2.67 | 0.735 | 0.721 | 1.09 |
| planner tol=1 pen=300 | 2.34 | 2.45 | 129 | 469 | 2.26 | 0.708 | 0.691 | 0.93 |
| planner tol=1 pen=1000 | 2.34 | 2.45 | 129 | 469 | 2.26 | 0.708 | 0.691 | 0.93 |

**Jumps at 10 m (the planner's node tolerance; priority-AUC does not depend on the yardstick)**

| Policy | jumps/km | jumps/km (median region) | median jump m | jump m per km | dead ends/km | jumps / lower bound |
|---|---:|---:|---:|---:|---:|---:|
| current | 4.10 | 4.20 | 320 | 1506 | 4.00 | 1.63 |
| current+nearest | 3.77 | 3.81 | 105 | 579 | 3.68 | 1.50 |
| tolerant tol=0.25 | 4.10 | 4.20 | 320 | 1506 | 4.00 | 1.63 |
| tolerant tol=0.5 | 4.00 | 4.20 | 321 | 1482 | 3.98 | 1.59 |
| tolerant tol=1 | 3.93 | 4.05 | 321 | 1446 | 3.93 | 1.56 |
| planner tol=0.05 pen=0 | 3.40 | 3.51 | 108 | 554 | 3.32 | 1.35 |
| planner tol=0.05 pen=300 | 2.88 | 3.24 | 125 | 553 | 2.72 | 1.14 |
| planner tol=0.05 pen=1000 | 2.88 | 3.24 | 125 | 553 | 2.72 | 1.14 |
| planner tol=0.1 pen=0 | 3.40 | 3.51 | 108 | 554 | 3.32 | 1.35 |
| planner tol=0.1 pen=300 | 2.88 | 3.24 | 125 | 553 | 2.72 | 1.14 |
| planner tol=0.1 pen=1000 | 2.88 | 3.24 | 125 | 553 | 2.72 | 1.14 |
| planner tol=0.15 pen=0 | 3.40 | 3.51 | 108 | 554 | 3.32 | 1.35 |
| planner tol=0.15 pen=300 | 2.88 | 3.24 | 125 | 553 | 2.72 | 1.14 |
| planner tol=0.15 pen=1000 | 2.88 | 3.24 | 125 | 553 | 2.72 | 1.14 |
| planner tol=0.2 pen=0 | 3.40 | 3.51 | 108 | 554 | 3.32 | 1.35 |
| planner tol=0.2 pen=300 | 2.88 | 3.24 | 125 | 548 | 2.72 | 1.14 |
| planner tol=0.2 pen=1000 | 2.88 | 3.24 | 125 | 548 | 2.72 | 1.14 |
| planner tol=0.25 pen=0 | 3.40 | 3.51 | 108 | 554 | 3.32 | 1.35 |
| planner tol=0.25 pen=300 | 2.88 | 3.24 | 125 | 548 | 2.72 | 1.14 |
| planner tol=0.25 pen=1000 | 2.88 | 3.24 | 125 | 548 | 2.72 | 1.14 |
| planner tol=0.5 pen=0 | 3.34 | 3.42 | 105 | 532 | 3.30 | 1.33 |
| planner tol=0.5 pen=300 | 2.78 | 3.17 | 120 | 502 | 2.71 | 1.10 |
| planner tol=0.5 pen=1000 | 2.78 | 3.17 | 120 | 502 | 2.71 | 1.10 |
| planner tol=1 pen=0 | 3.31 | 3.37 | 105 | 517 | 3.29 | 1.32 |
| planner tol=1 pen=300 | 2.71 | 2.81 | 119 | 474 | 2.69 | 1.08 |
| planner tol=1 pen=1000 | 2.71 | 2.81 | 119 | 474 | 2.69 | 1.08 |

_Up to 5 distinct starts per region (fewer where the region has fewer max-priority streets); 31 s total._
