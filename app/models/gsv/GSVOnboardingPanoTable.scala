package models.gsv

import models.utils.MyPostgresDriver.api._
import play.api.Play.current

import play.api.Play
import play.api.db.slick.DatabaseConfigProvider
import slick.driver.JdbcProfile
import scala.concurrent.Future


case class GSVOnboardingPano(gsvPanoramaId: String, hasLabels: Boolean)

// NOTE: We chose to add this as a separate table solely because of the ease of implementation. Perhaps it would be best
//       to just include a boolean `tutorial` column in the label table instead. This could still be done in the future.
class GSVOnboardingPanoTable(tag: Tag) extends Table[GSVOnboardingPano](tag, Some("sidewalk"), "gsv_onboarding_pano") {
  def gsvPanoramaId = column[String]("gsv_panorama_id", O.PrimaryKey)
  def hasLabels = column[Boolean]("has_labels")

  def * = (gsvPanoramaId, hasLabels) <> ((GSVOnboardingPano.apply _).tupled, GSVOnboardingPano.unapply)
}

object GSVOnboardingPanoTable {
  val dbConfig = DatabaseConfigProvider.get[JdbcProfile](Play.current)
  val db = dbConfig.db
  val onboardingPanos = TableQuery[GSVOnboardingPanoTable]

  def selectGSVOnboardingPanos(): Future[Seq[GSVOnboardingPano]] = db.run {
    onboardingPanos.result
  }

  def getOnboardingPanoIds(): Future[Seq[String]] = db.run {
    onboardingPanos.map(_.gsvPanoramaId).result
  }

  def save(newOnboardingPano: GSVOnboardingPano): Future[String] = db.run {
    (onboardingPanos returning onboardingPanos.map(_.gsvPanoramaId)) += newOnboardingPano
  }
}
