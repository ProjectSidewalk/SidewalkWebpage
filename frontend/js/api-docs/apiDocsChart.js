/**
 * Chart.js as the API docs' preview charts use it. Chart.js is modular: a chart type, scale or plugin that isn't
 * registered fails at draw time with "x is not a registered controller", so this is the one list of what the
 * previews draw (line, bar and bubble charts on category, linear and log scales, with tooltips, legends, titles and
 * area fills), and only these pieces end up in the bundle.
 */

import {
  BarController,
  BarElement,
  BubbleController,
  CategoryScale,
  Chart,
  Filler,
  Legend,
  LinearScale,
  LineController,
  LineElement,
  LogarithmicScale,
  PointElement,
  Title,
  Tooltip,
} from 'chart.js';

Chart.register(
  BarController, BarElement, BubbleController, CategoryScale, Filler, Legend, LinearScale, LineController,
  LineElement, LogarithmicScale, PointElement, Title, Tooltip,
);

// Chart.js paints its labels onto a canvas, so they can't inherit the page font.
Chart.defaults.font.family = getComputedStyle(document.documentElement).getPropertyValue('--font-primary');

export { Chart };
