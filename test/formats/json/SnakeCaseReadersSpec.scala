package formats.json

import controllers.helper.ValidateHelper.ValidateParams
import models.audit.CoveredRange
import models.label.LabelType
import models.mission.MissionType
import models.pano.PanoSource
import models.utils.{AiTagConfidence, ClusteringThreshold, ExcludedTag}
import models.utils.CommonUtils.{UiSource, ViewerType}
import models.validation.ValidationOption
import org.locationtech.jts.geom.{Coordinate, GeometryFactory}
import org.scalatest.funsuite.AnyFunSuite
import org.scalatest.matchers.should.Matchers
import play.api.libs.json.{Json, Reads}

import java.time.{OffsetDateTime, ZoneOffset}

/**
 * Pins the keys every `Json.reads`-derived reader accepts. Keys come from Scala field names, so renaming a field would
 * silently stop reading what the frontend sends.
 */
class SnakeCaseReadersSpec extends AnyFunSuite with Matchers {
  private val t  = OffsetDateTime.of(2026, 9, 29, 12, 30, 0, 0, ZoneOffset.UTC)
  private val ts = "\"2026-09-29T12:30:00Z\""
  private def check[A: Reads](json: String, expected: A): Unit = Json.parse(json).as[A] shouldBe expected

  test("AdminFormats readers") {
    import AdminFormats.{*, given}
    check("""{"user_id":"u","role_id":"Researcher"}""", UserRoleSubmission("u", "Researcher"))
    check(
      s"""{"user_id":"u","date":$ts,"flag":"stale","state":true}""",
      TaskFlagsByDateSubmission("u", t, "stale", true)
    )
    check("""{"audit_task_id":1,"flag":"incomplete","state":false}""", TaskFlagSubmission(1, "incomplete", false))
    check(
      """{"user_id":"u","username":"  n  ","role":"Researcher","team_id":3,"high_quality_manual":true,"excluded":false,
        |"community_service":true,"on_leaderboard":false,"public_profile":true,"infra3d_access":false}""".stripMargin,
      AdminUserSettingsSubmission("u", "n", "Researcher", Some(3), Some(true), false, true, false, true, Some(false))
    )
    check(
      """{"user_id":"u","username":"n","role":"Researcher","excluded":true,"community_service":false,
        |"on_leaderboard":true,"public_profile":false}""".stripMargin,
      AdminUserSettingsSubmission("u", "n", "Researcher", None, None, true, false, true, false, None)
    )
  }

  test("ClusterFormats readers") {
    import ClusterFormats.{*, given}
    check(
      """{"thresholds":[{"label_type":"CurbRamp","threshold":1.5}],
        |"labels":[{"label_id":1,"label_type":"CurbRamp","cluster":2}],
        |"clusters":[{"label_type":"CurbRamp","cluster":2,"lat":1.5,"lng":2.5,"severity":3}]}""".stripMargin,
      ClusteringSubmission(
        Seq(ClusteringThreshold("CurbRamp", 1.5)),
        Seq(ClusteredLabelSubmission(1, "CurbRamp", 2)),
        Seq(ClusterSubmission("CurbRamp", 2, 1.5, 2.5, Some(3)))
      )
    )
  }

  test("JSONB column readers") {
    check("""{"label_type":"CurbRamp","tag":"t"}""", ExcludedTag("CurbRamp", "t"))
    check("""{"tag":"t","confidence":0.5}""", AiTagConfidence("t", 0.5))
  }

  test("CommentSubmissionFormats readers") {
    import CommentSubmissionFormats.{*, given}
    check(
      """{"audit_task_id":1,"mission_id":2,"street_edge_id":3,"comment":"c","pano_id":"p","heading":1.5,
        |"pitch":2.5,"zoom":3.5,"lat":4.5,"lng":5.5}""".stripMargin,
      CommentSubmission(1, 2, 3, "c", "p", 1.5, 2.5, 3.5, 4.5, 5.5)
    )
    check(
      """{"mission_id":2,"label_id":3,"comment":"c","pano_id":"p","heading":1.5,"pitch":2.5,"zoom":3.5,"lat":4.5,
        |"lng":5.5}""".stripMargin,
      ValidationCommentSubmission(2, 3, "c", "p", 1.5, 2.5, 3.5, 4.5, 5.5)
    )
    check(
      """{"label_id":3,"label_type":"Obstacle","comment":"c","pano_id":"p","heading":1.5,"pitch":2.5,"zoom":3.5,
        |"lat":4.5,"lng":5.5}""".stripMargin,
      LabelMapValidationCommentSubmission(3, "Obstacle", "c", "p", 1.5, 2.5, 3.5, 4.5, 5.5)
    )
  }

  test("ExploreFormats readers") {
    import ExploreFormats.{*, given}
    check(
      """{"browser":"b","browser_version":"v","browser_width":1,"browser_height":2,"avail_width":3,"avail_height":4,
        |"screen_width":5,"screen_height":6,"operating_system":"os","language":"en","css_zoom":100}""".stripMargin,
      EnvironmentSubmission(Some("b"), Some("v"), Some(1), Some(2), Some(3), Some(4), Some(5), Some(6), Some("os"),
        "en", 100)
    )
    check(
      """{"language":"en","css_zoom":100}""",
      EnvironmentSubmission(None, None, None, None, None, None, None, None, None, "en", 100)
    )
    check(
      s"""{"action":"a","pano_id":"p","lat":1.5,"lng":2.5,"heading":3.5,"pitch":4.5,"zoom":5.5,"note":"n",
         |"temporary_label_id":6,"timestamp":$ts}""".stripMargin,
      InteractionSubmission("a", Some("p"), Some(1.5), Some(2.5), Some(3.5), Some(4.5), Some(5.5), Some("n"), Some(6),
        t)
    )
    check(
      s"""{"action":"a","timestamp":$ts}""",
      InteractionSubmission("a", None, None, None, None, None, None, None, None, t)
    )
    check(
      """{"target_pano_id":"p","yaw_deg":1.5,"description":"d"}""",
      PanoLinkSubmission("p", 1.5, Some("d"))
    )
    check(
      s"""{"street_edge_id":1,"task_start":$ts,"audit_task_id":2,"completed":true,"current_lat":1.5,
         |"current_lng":2.5,"start_point_reversed":false,"current_mission_start":{"lat":3.5,"lng":4.5},
         |"last_priority_update_time":$ts,"request_updated_street_priority":true,"audited_distance_m":5.5,
         |"route_street_id":3,"covered_ranges":[[0,12.5],[20,30]]}""".stripMargin,
      TaskSubmission(
        1,
        t,
        Some(2),
        Some(true),
        1.5,
        2.5,
        false,
        Some(GeometryFactory().createPoint(Coordinate(3.5, 4.5))),
        t,
        true,
        Some(5.5),
        Some(3),
        Some(Seq(CoveredRange(0d, 12.5d), CoveredRange(20d, 30d)))
      )
    )
    check(
      """{"mission_id":1,"distance_progress":1.5,"region_id":2,"completed":true,"audit_task_id":3,"skipped":false}""",
      AuditMissionProgress(1, Some(1.5), 2, true, Some(3), false)
    )
    val pano: PanoSubmission =
      PanoSubmission("p", PanoSource.Gsv, "2020-01", None, None, None, None, None, None, None, None, None, Nil, None,
        None, None, Nil, None)
    check(
      """{"label_type":"CurbRamp","model_id":"m","model_training_date":"d","api_version":"v",
        |"pano":{"pano_id":"p","source":"gsv","capture_date":"2020-01","links":[],"history":[]},
        |"labels":[{"pano_x":1,"pano_y":2,"confidence":0.5}]}""".stripMargin,
      AiLabelsSubmission(LabelType.CurbRamp, "m", "d", "v", pano, Seq(AiLabelDetection(1, 2, 0.5)))
    )
  }

  test("GalleryFormats readers") {
    import GalleryFormats.{*, given}
    val env: GalleryEnvironmentSubmission =
      GalleryEnvironmentSubmission(Some("b"), Some("v"), Some(1), Some(2), Some(3), Some(4), Some(5), Some(6),
        Some("os"), "en")
    check(
      s"""{"environment":{"browser":"b","browser_version":"v","browser_width":1,"browser_height":2,"screen_width":3,
         |"screen_height":4,"avail_width":5,"avail_height":6,"operating_system":"os","language":"en"},
         |"interactions":[{"action":"a","pano_id":"p","note":"n","timestamp":$ts}]}""".stripMargin,
      GalleryTaskSubmission(env, Seq(GalleryInteractionSubmission("a", Some("p"), Some("n"), t)))
    )
    check(
      """{"language":"en"}""",
      GalleryEnvironmentSubmission(None, None, None, None, None, None, None, None, None, "en")
    )
    check(
      """{"n":5,"label_types":["CurbRamp"],"validation_options":["correct"],"region_ids":[1],"severities":["2"],
        |"tags_by_label_type":{"CurbRamp":["points into traffic"]},"ai_validation_options":["unvalidated"],
        |"loaded_labels":[7],"sort":"random","static_imagery_only":true,"label_ids":[8]}""".stripMargin,
      GalleryLabelsRequest(
        5,
        Some(Seq("CurbRamp")),
        Some(Seq("correct")),
        Some(Seq(1)),
        Some(Seq("2")),
        Some(Map("CurbRamp" -> Seq("points into traffic"))),
        Some(Seq("unvalidated")),
        Seq(7),
        Some("random"),
        Some(true),
        Some(Seq(8))
      )
    )
    check(
      """{"n":5,"loaded_labels":[]}""",
      GalleryLabelsRequest(5, None, None, None, None, None, None, Nil, None, None, None)
    )
  }

  test("PanoFormats readers") {
    import PanoFormats.{*, given}
    check(
      s"""{"curr_pano_id":"p","history":[{"pano_id":"q","date":"2020-01"}],"pano_history_saved":$ts}""",
      PanoHistorySubmission("p", Seq(PanoDate("q", "2020-01")), t)
    )
  }

  test("RouteBuilderFormats readers") {
    import RouteBuilderFormats.{*, given}
    check(
      """{"name":"n","description":"d","streets":[{"street_id":1,"reverse":true}]}""",
      RouteUpdate(Some("n"), Some("d"), Some(Seq(NewRouteStreet(1, true))))
    )
    check("{}", RouteUpdate(None, None, None))
  }

  test("UserFormats readers") {
    import UserFormats.{*, given}
    check(
      """{"username":" n ","on_leaderboard":true,"public_profile":false,"team_id":3,"community_service":true,
        |"measurement_system":"metric"}""".stripMargin,
      SettingsSubmission(Some("n"), true, false, Some(3), Some(true), Some("metric"))
    )
    check(
      """{"on_leaderboard":false,"public_profile":true}""",
      SettingsSubmission(None, false, true, None, None, None)
    )
  }

  test("ValidateFormats readers") {
    import CommentSubmissionFormats.ValidationCommentSubmission
    import PanoFormats.PanoHistorySubmission
    import ValidateFormats.{*, given}
    check(
      """{"mission_id":1,"browser":"b","browser_version":"v","browser_width":1,"browser_height":2,"avail_width":3,
        |"avail_height":4,"screen_width":5,"screen_height":6,"operating_system":"os","language":"en",
        |"css_zoom":100}""".stripMargin,
      EnvironmentSubmission(Some(1), Some("b"), Some("v"), Some(1), Some(2), Some(3), Some(4), Some(5), Some(6),
        Some("os"), "en", 100)
    )
    check(
      s"""{"action":"a","mission_id":1,"pano_id":"p","lat":1.5,"lng":2.5,"heading":3.5,"pitch":4.5,"zoom":5.5,
         |"note":"n","timestamp":$ts}""".stripMargin,
      InteractionSubmission("a", Some(1), Some("p"), Some(1.5), Some(2.5), Some(3.5), Some(4.5), Some(5.5), Some("n"),
        t)
    )
    val voteKeys: String =
      s""""validation_result":"Agree","severity":2,"tags":["t"],"canvas_x":1,"canvas_y":2,"heading":1.5,
         |"pitch":2.5,"zoom":3.5,"canvas_width":640,"canvas_height":480,"start_timestamp":$ts,
         |"end_timestamp":$ts,"source":"Validate","undone":false,"redone":true,"viewer_type":"Pannellum"""".stripMargin
    val vote: LabelValidationSubmission =
      LabelValidationSubmission(
        7,
        8,
        Some(LabelType.CurbRamp),
        Some(LabelType.Obstacle),
        ValidationOption.Agree,
        Some(2),
        List("t"),
        Some(ValidationCommentSubmission(8, 7, "c", "p", 1.5, 2.5, 3.5, 4.5, 5.5)),
        Some(1),
        Some(2),
        1.5,
        2.5,
        3.5,
        640,
        480,
        t,
        t,
        UiSource.Validate,
        false,
        true,
        ViewerType.Pannellum
      )
    check(
      s"""{"label_id":7,"mission_id":8,"label_type":"CurbRamp","new_label_type":"Obstacle",
         |"comment":{"mission_id":8,"label_id":7,"comment":"c","pano_id":"p","heading":1.5,"pitch":2.5,"zoom":3.5,
         |"lat":4.5,"lng":5.5},$voteKeys}""".stripMargin,
      vote
    )
    check(
      s"""{"interactions":[],"environment":{"language":"en","css_zoom":100},"validations":[],
         |"mission_progress":{"mission_id":8,"mission_type":"validation","labels_progress":1,"labels_total":10,
         |"label_type":"CurbRamp","completed":false},
         |"validate_params":{"admin_version":false,"unvalidated_only":true},
         |"pano_histories":[{"curr_pano_id":"p","history":[],"pano_history_saved":$ts}],"source":"Validate",
         |"timestamp":$ts}""".stripMargin,
      ValidationTaskSubmission(
        Nil,
        EnvironmentSubmission(None, None, None, None, None, None, None, None, None, None, "en", 100),
        Nil,
        Some(ValidationMissionProgress(8, MissionType.Validation, 1, 10, LabelType.CurbRamp, false)),
        ValidateParams(false, unvalidatedOnly = true),
        Seq(PanoHistorySubmission("p", Nil, t)),
        UiSource.Validate,
        t
      )
    )
    check(
      s"""{"label_id":7,"label_type":"CurbRamp","new_label_type":"Obstacle",$voteKeys}""",
      LabelMapValidationSubmission(7, LabelType.CurbRamp, Some(LabelType.Obstacle), ValidationOption.Agree, Some(2),
        List("t"), Some(1), Some(2), 1.5, 2.5, 3.5, 640, 480, t, t, UiSource.Validate, false, true,
        ViewerType.Pannellum)
    )
    check(
      """{"label_id":7,"label_type":"CurbRamp","new_label_type":"Obstacle","severity":2,"tags":["t"],
        |"source":"LabelMap"}""".stripMargin,
      LabelEditSubmission(7, Some(LabelType.CurbRamp), Some(LabelType.Obstacle), Some(2), List("t"), UiSource.LabelMap)
    )
    check(
      """{"label_id":7,"tags":[],"source":"LabelMap"}""",
      LabelEditSubmission(7, None, None, None, Nil, UiSource.LabelMap)
    )
    check(
      """{"label_type":"CurbRamp","labels_needed":3,"excluded_label_ids":[1,2],
        |"validate_params":{"admin_version":false,"unvalidated_only":false}}""".stripMargin,
      MoreLabelsRequest(LabelType.CurbRamp, 3, Seq(1, 2), ValidateParams(false))
    )
    check(
      """{"validate_params":{"admin_version":false,"unvalidated_only":true}}""",
      MissionRequest(ValidateParams(false, unvalidatedOnly = true))
    )
  }
}
