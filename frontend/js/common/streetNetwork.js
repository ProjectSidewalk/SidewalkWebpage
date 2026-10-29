/**
 * How far apart two street endpoints may be and still count as one intersection (metres). Street geometry is
 * digitized, so streets that meet rarely share an exact coordinate; the route builder's graph and the walk planner
 * both merge endpoints within this distance, and they must agree or a walk the planner calls connected would be one
 * the builder calls broken.
 */
export const NODE_TOLERANCE_M = 10;
