package service

import play.api.Configuration
import play.api.libs.json.{Json, Writes}

/**
 * The thresholds the client-side walk planner runs with (WalkPlanner.js, #5526), read from `walk-planner.*` in
 * application.conf. The planner runs on the client because the client already holds every street of the region with
 * its live priority, but these are domain values, so the backend owns them and the page hands them over as JSON.
 *
 * @param priorityTolerance How far below the best remaining priority a connected street may be and still be walked
 *                          next rather than jumped from; in units of the reciprocal-normalized street priority.
 * @param tinyStreetM Streets strictly shorter than this (metres) are walked whenever adjacent, whatever their priority.
 */
case class WalkPlannerSettings(priorityTolerance: Double, tinyStreetM: Double)

object WalkPlannerSettings {
  given walkPlannerSettingsWrites: Writes[WalkPlannerSettings] = Json.writes[WalkPlannerSettings]

  /** @return The settings for this deployment; a malformed value fails at startup rather than silently defaulting. */
  def fromConfig(config: Configuration): WalkPlannerSettings = WalkPlannerSettings(
    priorityTolerance = config.get[Double]("walk-planner.priority-tolerance"),
    tinyStreetM = config.get[Double]("walk-planner.tiny-street-m")
  )
}
