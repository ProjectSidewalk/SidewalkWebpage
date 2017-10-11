package models.gsv

import models.utils.MyPostgresDriver.simple._
import play.api.Play.current


case class GSVOnboardingPano(gsvPanoramaId: String, hasLabels: Boolean)

class GSVOnboardingPanoTable(tag: Tag) extends Table[GSVOnboardingPano](tag, Some("sidewalk"), "gsv_onboarding_pano") {
  def gsvPanoramaId = column[String]("gsv_panorama_id", O.PrimaryKey)
  def hasLabels = column[Boolean]("has_labels", O.NotNull)

  def * = (gsvPanoramaId, hasLabels) <> ((GSVOnboardingPano.apply _).tupled, GSVOnboardingPano.unapply)
}

object GSVOnboardingPanoTable {
  val db = play.api.db.slick.DB
  val onboardingPanos = TableQuery[GSVOnboardingPanoTable]

  def save(newOnboardingPano: GSVOnboardingPano): String = db.withTransaction { implicit session =>
    onboardingPanos += newOnboardingPano
    newOnboardingPano.gsvPanoramaId
  }
}
