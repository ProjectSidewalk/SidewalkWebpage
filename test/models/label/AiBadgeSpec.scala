package models.label

import models.pano.PanoSource
import models.utils.MyPostgresProfile.api.{given, *}
import org.scalatestplus.play.guice.GuiceOneAppPerSuite
import play.api.Application
import play.api.inject.guice.GuiceApplicationBuilder
import util.{RolledBackDb, SidewalkSpec}

/**
 * Pins when a label gets the AI badge (#5925): the AI placed it and no one has changed its type since. A severity or
 * tag edit keeps the badge; a type change takes it away.
 *
 * The dev DB has no AI labels, so the spec borrows a real label and gives its labeler the AI role, all inside a
 * transaction that is rolled back.
 */
class AiBadgeSpec extends SidewalkSpec with GuiceOneAppPerSuite with RolledBackDb {

  override def fakeApplication(): Application =
    GuiceApplicationBuilder().disable[modules.ActorModule].build()

  private lazy val labelTable = app.injector.instanceOf[LabelTable]

  /** A label both the label popup and Gallery can load, with a rated type so a severity-only edit is possible. */
  private def pickLabel(): (Int, String, String, String) =
    run(
      sql"""SELECT label.label_id, label.user_id, label.label_type::text, pano_data.source::text
            FROM label
            INNER JOIN label_point ON label.label_id = label_point.label_id
            INNER JOIN pano_data ON label.pano_id = pano_data.pano_id
            INNER JOIN user_stat ON label.user_id = user_stat.user_id
            WHERE NOT label.deleted AND NOT label.tutorial AND label_point.lat IS NOT NULL
              AND label.label_type IN ('CurbRamp', 'NoCurbRamp', 'Obstacle', 'SurfaceProblem')
            ORDER BY label.label_id
            LIMIT 1""".as[(Int, String, String, String)].headOption
    ).getOrElse(cancel("no label in this database fits"))

  "the AI badge" should {
    "stay through a severity edit and go away after a type change" in {
      val (labelId, userId, labelType, source) = pickLabel()
      val newType                              = if (labelType == "Obstacle") "SurfaceProblem" else "Obstacle"
      val viewer                               = PanoSource.withName(source)

      /** The badge as the label popup and Gallery each read it. */
      def badges: DBIO[(Boolean, Boolean)] = for {
        popup   <- labelTable.getRecentLabelsMetadata(1, None, Some(labelId))
        gallery <- labelTable.getGalleryLabelsByIdQuery(viewer, Seq(labelId), userId).result
      } yield (popup.head.aiGenerated, gallery.head.aiGenerated)

      def edit(newTypeSql: String, newSeveritySql: String): DBIO[Int] =
        sqlu"""INSERT INTO label_edit (label_id, user_id, old_label_type, new_label_type, old_severity, new_severity,
                                       old_tags, new_tags, source)
               SELECT label_id, user_id, label_type, #$newTypeSql, severity, #$newSeveritySql, tags, tags, 'Validate'
               FROM label WHERE label_id = $labelId"""

      val (human, aiPlaced, afterSeverityEdit, afterTypeChange) = runRolledBack(for {
        human <- badges
        _     <- sqlu"UPDATE sidewalk_login.user_role SET role = 'AI' WHERE user_id = $userId"
        ai    <- badges
        _     <- edit("label_type", "CASE WHEN severity = 1 THEN 2 ELSE 1 END")
        sev   <- badges
        _     <- edit(s"'$newType'", "severity")
        typed <- badges
      } yield (human, ai, sev, typed))

      human mustBe ((false, false))
      aiPlaced mustBe ((true, true))
      afterSeverityEdit mustBe ((true, true))
      afterTypeChange mustBe ((false, false))
    }
  }
}
