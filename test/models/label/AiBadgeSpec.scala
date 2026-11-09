package models.label

import models.pano.PanoSource
import models.utils.CommonUtils.UiSource
import models.utils.MyPostgresProfile.api.{given, *}
import org.scalatestplus.play.guice.GuiceOneAppPerSuite
import play.api.Application
import play.api.inject.guice.GuiceApplicationBuilder
import service.LabelEditService
import util.{RolledBackDb, SidewalkSpec}

/**
 * Pins when a label shows the AI badge (#5925): the AI placed it and it still has the type it was placed with. A
 * severity edit keeps the badge, a new type takes it away, and going back to the placed type brings it back, whether
 * the two type changes folded into one edit or not.
 *
 * The dev DB has no AI labels, so the spec hands a human's label to the AI account inside a transaction that is
 * rolled back, and edits it through `LabelEditService.applyEdit`, the path the label popup and Validate take.
 */
class AiBadgeSpec extends SidewalkSpec with GuiceOneAppPerSuite with RolledBackDb {

  override def fakeApplication(): Application =
    GuiceApplicationBuilder().disable[modules.ActorModule].build()

  private lazy val labelTable       = app.injector.instanceOf[LabelTable]
  private lazy val labelEditService = app.injector.instanceOf[LabelEditService]

  /**
   * A human's label that both the label popup and Gallery's by-id query load, never edited and with no saved crop, so
   * its type is the one it was placed with and a type change has no crop file to move.
   *
   * @return The label's id, type and pano source, and the labeler's id.
   */
  private def pickLabel(): (Int, String, String, String) =
    run(
      sql"""SELECT label.label_id, label.label_type::text, pano_data.source::text, label.user_id
            FROM label
            INNER JOIN audit_task ON label.audit_task_id = audit_task.audit_task_id
            INNER JOIN user_stat ON audit_task.user_id = user_stat.user_id
            INNER JOIN sidewalk_login.user_role ON label.user_id = user_role.user_id
            INNER JOIN label_point ON label.label_id = label_point.label_id
            INNER JOIN pano_data ON label.pano_id = pano_data.pano_id
            INNER JOIN street_edge_region ON label.street_edge_id = street_edge_region.street_edge_id
            WHERE NOT label.deleted AND NOT label.tutorial AND NOT user_stat.excluded AND user_role.role <> 'AI'
              AND label.street_edge_id <> (SELECT tutorial_street_edge_id FROM config)
              AND audit_task.street_edge_id <> (SELECT tutorial_street_edge_id FROM config)
              AND label_point.lat IS NOT NULL
              AND label.label_type IN ('CurbRamp', 'NoCurbRamp', 'Obstacle', 'SurfaceProblem')
              AND NOT EXISTS (SELECT 1 FROM label_edit WHERE label_edit.label_id = label.label_id)
              AND NOT EXISTS (SELECT 1 FROM label_crop WHERE label_crop.label_id = label.label_id)
            ORDER BY label.label_id
            LIMIT 1""".as[(Int, String, String, String)].headOption
    ).getOrElse(cancel("no label in this database fits"))

  /** @return The AI account, which Gallery can load labels from only if it has a user_stat row that isn't excluded. */
  private def aiUserId(): String =
    run(
      sql"""SELECT user_role.user_id
            FROM sidewalk_login.user_role
            INNER JOIN user_stat ON user_role.user_id = user_stat.user_id
            WHERE user_role.role = 'AI' AND NOT user_stat.excluded
            LIMIT 1""".as[String].headOption
    ).getOrElse(cancel("this database has no AI account Gallery can show labels from"))

  "the AI badge" should {
    "follow whether an AI label still has the type it was placed with" in {
      val (labelId, placedName, source, labelerId) = pickLabel()
      val aiId                                     = aiUserId()
      val placed                                   = LabelType.withName(placedName)
      val other  = if (placed == LabelType.Obstacle) LabelType.SurfaceProblem else LabelType.Obstacle
      val viewer = PanoSource.withName(source)

      /** @return The badge as the label popup and Gallery each read it. */
      def badges: DBIO[(Boolean, Boolean)] = for {
        popup   <- labelTable.getRecentLabelsMetadata(1, None, Some(labelId))
        gallery <- labelTable.getGalleryLabelsByIdQuery(viewer, Seq(labelId), labelerId).result
      } yield (popup.head.aiGenerated, gallery.head.aiGenerated)

      /**
       * Edits the label as the labeler. Edits from one source within the fold window fold into one row; a different
       * source starts a new row.
       *
       * @return The badges once the edit is in.
       */
      def edit(labelType: LabelType, severity: Int, source: UiSource): DBIO[(Boolean, Boolean)] =
        labelEditService
          .applyEdit(labelId, labelerId, Some(labelType), Some(severity), Seq.empty, source, None)
          .andThen(badges)

      val steps: Seq[(Boolean, Boolean)] = runRolledBack(for {
        human     <- badges
        _         <- sqlu"UPDATE label SET user_id = $aiId WHERE label_id = $labelId"
        ai        <- badges
        rated     <- edit(placed, 3, UiSource.GalleryExpandedImage)
        retyped   <- edit(other, 3, UiSource.GalleryExpandedImage)
        foldBack  <- edit(placed, 3, UiSource.GalleryExpandedImage)
        retyped2  <- edit(other, 3, UiSource.LabelMap)
        splitBack <- edit(placed, 3, UiSource.Validate)
      } yield Seq(human, ai, rated, retyped, foldBack, retyped2, splitBack))

      steps mustBe Seq(
        (false, false), // A human's label.
        (true, true),   // The AI's.
        (true, true),   // A new rating keeps the badge.
        (false, false), // A new type takes it away.
        (true, true),   // Back to the placed type, folded into the same edit.
        (false, false), // A new type again, in an edit of its own.
        (true, true)    // Back to the placed type in another edit of its own.
      )
    }
  }
}
