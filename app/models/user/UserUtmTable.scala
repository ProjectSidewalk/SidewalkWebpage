package models.user

import com.google.inject.ImplementedBy
import models.utils.MyPostgresProfile
import models.utils.MyPostgresProfile.api._
import play.api.db.slick.{DatabaseConfigProvider, HasDatabaseConfigProvider}

import java.time.OffsetDateTime
import javax.inject._

case class UserUtm(
    userUtmId: Int,
    userId: String,
    utmSource: Option[String],
    utmMedium: Option[String],
    utmCampaign: Option[String],
    utmContent: Option[String],
    utmTerm: Option[String],
    cityId: String,
    timestamp: OffsetDateTime
)

class UserUtmTableDef(tag: Tag) extends Table[UserUtm](tag, "user_utm") {
  def userUtmId: Rep[Int]              = column[Int]("user_utm_id", O.PrimaryKey, O.AutoInc)
  def userId: Rep[String]              = column[String]("user_id")
  def utmSource: Rep[Option[String]]   = column[Option[String]]("utm_source")
  def utmMedium: Rep[Option[String]]   = column[Option[String]]("utm_medium")
  def utmCampaign: Rep[Option[String]] = column[Option[String]]("utm_campaign")
  def utmContent: Rep[Option[String]]  = column[Option[String]]("utm_content")
  def utmTerm: Rep[Option[String]]     = column[Option[String]]("utm_term")
  def cityId: Rep[String]              = column[String]("city_id")
  def timestamp: Rep[OffsetDateTime]   = column[OffsetDateTime]("timestamp")

  def * = (userUtmId, userId, utmSource, utmMedium, utmCampaign, utmContent, utmTerm, cityId, timestamp) <> (
    (UserUtm.apply _).tupled,
    UserUtm.unapply
  )
}

@ImplementedBy(classOf[UserUtmTable])
trait UserUtmTableRepository {}

/**
 * Records UTM tracking parameters (utm_source, utm_medium, utm_campaign, etc.) captured when users land on the site
 * via campaign URLs. Lives in the global `sidewalk_login` schema (rather than per-city) so that a user's campaign
 * attribution persists even if they switch between city deployments via the navbar dropdown. Each visit with UTM
 * params produces a new row, allowing first-touch, last-touch, or any-touch attribution at query time.
 */
@Singleton
class UserUtmTable @Inject() (protected val dbConfigProvider: DatabaseConfigProvider)
    extends UserUtmTableRepository
    with HasDatabaseConfigProvider[MyPostgresProfile] {

  val userUtms = TableQuery[UserUtmTableDef]

  def insert(utm: UserUtm): DBIO[Int] = {
    (userUtms returning userUtms.map(_.userUtmId)) += utm
  }
}
