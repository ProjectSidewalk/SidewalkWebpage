package formats.json

import models.audit.{AuditedStreetWithTimestamp, ContributionTimeStat, GenericComment, InteractionWithLabel}
import models.label.LabelCount
import models.user.UserCount
import models.utils.MyPostgresProfile.api._
import models.validation.ValidationCount
import play.api.libs.functional.syntax._
import play.api.libs.json._
import service.TimeInterval.TimeInterval

import java.time.OffsetDateTime

object AdminFormats {
  case class UserRoleSubmission(userId: String, roleId: String)
  case class TaskFlagsByDateSubmission(userId: String, date: OffsetDateTime, flag: String, state: Boolean)
  case class TaskFlagSubmission(auditTaskId: Int, flag: String, state: Boolean) {
    require(flag == "low_quality" || flag == "incomplete" || flag == "stale")
  }

  implicit val userRoleSubmissionReads: Reads[UserRoleSubmission] = (
    (JsPath \ "user_id").read[String] and
      (JsPath \ "role_id").read[String]
    )(UserRoleSubmission.apply _)

  implicit val taskFlagsByDateSubmissionReads: Reads[TaskFlagsByDateSubmission] = (
    (JsPath \ "userId").read[String] and
      (JsPath \ "date").read[OffsetDateTime] and
      (JsPath \ "flag").read[String] and
      (JsPath \ "state").read[Boolean]
    )(TaskFlagsByDateSubmission.apply _)

  implicit val taskFlagSubmissionReads: Reads[TaskFlagSubmission] = (
    (JsPath \ "auditTaskId").read[Int] and
      (JsPath \ "flag").read[String] and
      (JsPath \ "state").read[Boolean]
    )(TaskFlagSubmission.apply _)

  // Fixes the default writes now working when the keys are an Enumeration.
  implicit def timeIntervalMapWrites[A](implicit writesA: Writes[A]): Writes[Map[TimeInterval, A]] =
    (map: Map[TimeInterval, A]) => {
      val stringMap = map.map { case (interval, value) => (interval.toString, value) }
      Json.toJson(stringMap)(Writes.map[A](writesA))
    }

  implicit val userCountWrites: Writes[UserCount] = (
    (__ \ "count").write[Int] and
      (__ \ "tool_used").write[String] and
      (__ \ "role").write[String] and
      (__ \ "time_interval").write[TimeInterval] and
      (__ \ "task_completed_only").write[Boolean] and
      (__ \ "high_quality_only").write[Boolean]
    )(unlift(UserCount.unapply))

  implicit val contributionTimeStatWrites: Writes[ContributionTimeStat] = (
    (__ \ "time").write[Option[Float]] and
      (__ \ "stat").write[String] and
      (__ \ "time_interval").write[TimeInterval]
    )(unlift(ContributionTimeStat.unapply))

  implicit val labelCountWrites: Writes[LabelCount] = (
    (__ \ "count").write[Int] and
      (__ \ "time_interval").write[TimeInterval] and
      (__ \ "label_type").write[String]
    )(unlift(LabelCount.unapply))

  implicit val validationCountWrites: Writes[ValidationCount] = (
    (__ \ "count").write[Int] and
      (__ \ "time_interval").write[TimeInterval] and
      (__ \ "label_type").write[String] and
      (__ \ "result").write[String]
    )(unlift(ValidationCount.unapply))

  implicit val genericCommentWrites: Writes[GenericComment] = (
    (__ \ "comment_type").write[String] and
      (__ \ "username").write[String] and
      (__ \ "gsv_panorama_id").write[Option[String]] and
      (__ \ "timestamp").write[OffsetDateTime] and
      (__ \ "comment").write[String] and
      (__ \ "heading").write[Option[Double]] and
      (__ \ "pitch").write[Option[Double]] and
      (__ \ "zoom").write[Option[Int]] and
      (__ \ "label_id").write[Option[Int]]
    )(unlift(GenericComment.unapply))

  def auditedStreetWithTimestampToGeoJSON(street: AuditedStreetWithTimestamp): JsObject = {
    Json.obj(
      "type" -> "Feature",
      "geometry" -> street.geom,
      "properties" -> Json.obj(
        "street_edge_id" -> street.streetEdgeId,
        "audit_task_id" -> street.auditTaskId,
        "user_id" -> street.userId,
        "role" -> street.role,
        "high_quality_user" -> street.highQuality,
        "task_start" -> street.taskStart,
        "task_end" -> street.taskEnd
      )
    )
  }
  def auditTaskInteractionsToGeoJSON(interactions: Seq[InteractionWithLabel]): JsObject = {
    val features: Seq[JsObject] = interactions.filter(_.lat.isDefined).sortBy(_.timestamp).map { interaction =>
      val geom = Json.obj(
        "type" -> "Point",
        "coordinates" -> Json.arr(interaction.lng.get.toDouble, interaction.lat.get.toDouble)
      )
      val properties = if (interaction.labelType.isEmpty) {
        Json.obj(
          "panoId" -> interaction.gsvPanoramaId,
          "heading" -> interaction.heading.get.toDouble,
          "pitch" -> interaction.pitch,
          "zoom" -> interaction.zoom,
          "timestamp" -> interaction.timestamp,
          "action" -> interaction.action,
          "note" -> interaction.note
        )
      } else {
        Json.obj(
          "panoId" -> interaction.gsvPanoramaId,
          "heading" -> interaction.heading.get.toDouble,
          "pitch" -> interaction.pitch,
          "zoom" -> interaction.zoom,
          "timestamp" -> interaction.timestamp,
          "action" -> interaction.action,
          "note" -> interaction.note,
          "label" -> Json.obj(
            "label_id" -> interaction.labelId,
            "label_type" -> interaction.labelType,
            "coordinates" -> Seq(interaction.labelLng, interaction.labelLat),
            "canvasX" -> interaction.canvasX,
            "canvasY" -> interaction.canvasY
          )
        )
      }
      Json.obj("type" -> "Feature", "geometry" -> geom, "properties" -> properties)
    }
    Json.obj("type" -> "FeatureCollection", "features" -> features)
  }
}
