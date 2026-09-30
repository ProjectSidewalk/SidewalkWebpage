package models.utils

import models.label.{AiImageSource, ComputationMethod, CropSource, LabelType, StreetSide}
import models.mission.MissionType
import models.pano.{PanoImageryChangeSource, PanoSource}
import models.street._
import models.user.{MeasurementSystem, Role}
import models.utils.CommonUtils.{UiSource, ViewerType}
import models.utils.MyPostgresProfile.api.given
import models.validation.{ValidationCommentChangeType, ValidationOption}
import org.scalatestplus.play.guice.GuiceOneAppPerSuite
import play.api.Application
import play.api.inject.guice.GuiceApplicationBuilder
import util.{RolledBackDb, SidewalkSpec}

/**
 * Checks that every Scala enum stored as a Postgres enum type still has exactly that type's labels.
 *
 * Each pair is otherwise held together only by a `NOTE:` comment asking the next person to change both sides, and
 * the failure mode is bad: values are matched up by name, so a label present on one side and not the other throws
 * `NoSuchElementException` mid-read on the Scala side, or a "invalid input value for enum" on the Postgres side — at
 * runtime, on whichever page happens to touch that row first, long after the change that caused it.
 *
 * Deliberately asserts set equality in both directions. A one-way check would pass while the DB quietly grew a label
 * no Scala code can read, which is the direction an `ALTER TYPE ... ADD VALUE` in a later evolution takes.
 *
 * Requires a Postgres database (DATABASE_URL / DATABASE_USER / DATABASE_PASSWORD, as in dev/CI).
 */
class EnumTypeParitySpec extends SidewalkSpec with GuiceOneAppPerSuite with RolledBackDb {

  override def fakeApplication(): Application =
    new GuiceApplicationBuilder().disable[modules.ActorModule].build()

  // A new enum has to be added here by hand: nothing lists the companions for us.
  private val enums: Seq[PgEnumCompanion[_ <: NamedEnum]] = Seq(
    AiImageSource, ComputationMethod, CropSource, JobRunStatus, JobRunTrigger, LabelType, MeasurementSystem,
    MissionType, PanoImageryChangeSource, PanoSource, Role, SidewalkPresenceBasis, SidewalkPresenceStatus,
    StreetEdgeIssueType, StreetEdgeStatus, StreetEdgeStatusChangeSource, StreetGradientConfidence,
    StreetGradientQuality, StreetImagerySource, StreetSide, UiSource, ValidationCommentChangeType, ValidationOption,
    ViewerType, WayType
  )

  /** The labels Postgres holds for an enum type, in the city's schema or the shared login one. */
  private def labelsOf(typeName: String): Set[String] = {
    run(
      sql"""SELECT enumlabel
            FROM pg_enum
            JOIN pg_type ON pg_type.oid = pg_enum.enumtypid
            WHERE pg_type.typname = $typeName
                AND pg_type.typnamespace IN (current_schema()::regnamespace, 'sidewalk_login'::regnamespace)"""
        .as[String]
    ).toSet
  }

  "every enum stored as a Postgres enum type" should {
    enums.foreach { companion =>
      s"match ${companion.pgType} exactly" in {
        labelsOf(companion.pgType) mustBe companion.names.toSet
      }
    }
  }
}
