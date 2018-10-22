package models.gsv

import models.utils.MyPostgresDriver.api._
import play.api.Play.current


case class GSVOnboardingPano(gsvPanoramaId: String, hasLabels: Boolean)

// NOTE: We chose to add this as a separate table solely because of the ease of implementation. Perhaps it would be best
//       to just include a boolean `tutorial` column in the label table instead. This could still be done in the future.
class GSVOnboardingPanoTable(tag: Tag) extends Table[GSVOnboardingPano](tag, Some("sidewalk"), "gsv_onboarding_pano") {
  def gsvPanoramaId = column[String]("gsv_panorama_id", O.PrimaryKey)
  def hasLabels = column[Boolean]("has_labels")

  def * = (gsvPanoramaId, hasLabels) <> ((GSVOnboardingPano.apply _).tupled, GSVOnboardingPano.unapply)
}

object GSVOnboardingPanoTable {
  val db = play.api.db.slick.DB
  val onboardingPanos = TableQuery[GSVOnboardingPanoTable]

  def selectGSVOnboardingPanos(): List[GSVOnboardingPano] = db.withTransaction { implicit session =>
    onboardingPanos.list
  }

  def getOnboardingPanoIds(): List[String] = db.withTransaction { implicit session =>
    onboardingPanos.map(_.gsvPanoramaId).list
  }

  def save(newOnboardingPano: GSVOnboardingPano): String = db.withTransaction { implicit session =>
    onboardingPanos += newOnboardingPano
    newOnboardingPano.gsvPanoramaId
  }
}
