/**
 * How far apart two street endpoints may be and still count as one intersection (metres): digitized streets that
 * meet rarely share an exact coordinate. The route builder's graph and the walk planner both merge endpoints within
 * this distance, and they must agree, or a walk the planner calls connected is one the builder calls broken.
 */
export const NODE_TOLERANCE_M = 10;
