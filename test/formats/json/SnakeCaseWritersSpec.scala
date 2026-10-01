package formats.json

import formats.json.AdminFormats.given
import formats.json.ClusterFormats.given
import formats.json.ExploreFormats.given
import formats.json.LabelFormats.given
import formats.json.MissionFormats.given
import formats.json.RouteBuilderFormats.given
import formats.json.UserFormats.given
import models.api.AiConcurrence
import models.audit.{AuditTask, AuditTaskInteraction, ContributionTimeStat, GenericComment}
import models.cluster.LabelToCluster
import models.label.{Label, LabelCount, LabelType, LocationXY, POV}
import models.mission.{Mission, MissionType}
import models.pano.{PanoDataSlim, PanoSource}
import models.street.StreetEdgePriority
import models.route.RouteWithStats
import models.user.*
import models.utils.{AiTagConfidence, ClusteringThreshold, ExcludedTag}
import models.utils.CommonUtils.UiSource
import org.locationtech.jts.geom.{Coordinate, GeometryFactory}
import org.scalatest.funsuite.AnyFunSuite
import org.scalatest.matchers.should.Matchers
import play.api.libs.json.{Json, Writes}
import service.{CityHours, TeamMemberStats, TeamOverview, TeamTotals, TimeInterval, UpdatedStreets}

import java.time.{OffsetDateTime, ZoneOffset}

/**
 * Pins the JSON of every writer derived with `Json.writes` under a snake_case `JsonConfiguration`. Those writers take
 * their keys from the Scala field names, so renaming a field would silently rename a key that pages and API clients
 * read; the expected strings are the output of the hand-listed writers they replaced (#5567, #5622). The `None` cases pin
 * which writers drop the key and which write `null`.
 */
class SnakeCaseWritersSpec extends AnyFunSuite with Matchers {
  private val t = OffsetDateTime.of(2026, 9, 29, 12, 30, 0, 0, ZoneOffset.UTC)
  private def check[A: Writes](a: A, expected: String): Unit = Json.stringify(Json.toJson(a)) shouldBe expected

  test("derived snake_case writers keep the keys the hand-listed writers produced") {
    check(
      AiConcurrence(1, 2, 3, 4),
      """{"ai_yes_maj_vote_concurs":1,"ai_yes_maj_vote_differs":2,"ai_no_maj_vote_differs":3,"ai_no_maj_vote_concurs":4}"""
    )
    check(LabelTypeStat(1, 2, 3, 4), """{"labels":1,"validated_correct":2,"validated_incorrect":3,"not_validated":4}""")
    check(
      PanoDataSlim("p1", true, Some(1), Some(2), Some(1.5), Some(2.5), Some(3.5), Some(4.5), Some(5.5), PanoSource.Gsv),
      """{"pano_id":"p1","has_labels":true,"width":1,"height":2,"lat":1.5,"lng":2.5,"camera_heading":3.5,"camera_pitch":4.5,"camera_roll":5.5,"source":"gsv"}"""
    )
    check(
      PanoDataSlim("p2", false, None, None, None, None, None, None, None, PanoSource.Mapillary),
      """{"pano_id":"p2","has_labels":false,"source":"mapillary"}"""
    )
    check(
      Mission(1, MissionType.Audit, "u", t, t, true, 0.5, false, Some(1.0), Some(2.0), Some(3), Some(4), Some(5),
        Some(LabelType.CurbRamp), false, Some(6), Some(7)),
      """{"mission_id":1,"mission_type":"audit","user_id":"u","mission_start":"2026-09-29T12:30:00Z","mission_end":"2026-09-29T12:30:00Z","completed":true,"pay":0.5,"paid":false,"distance_meters":1,"distance_progress":2,"region_id":3,"labels_validated":4,"labels_progress":5,"label_type":"CurbRamp","skipped":false,"current_audit_task_id":6,"user_route_id":7}"""
    )
    check(
      Mission(2, MissionType.Audit, "u", t, t, true, 0.5, false, None, None, None, None, None, None, true, None, None),
      """{"mission_id":2,"mission_type":"audit","user_id":"u","mission_start":"2026-09-29T12:30:00Z","mission_end":"2026-09-29T12:30:00Z","completed":true,"pay":0.5,"paid":false,"skipped":true}"""
    )
    check(
      TeamMemberStats("u", "n", Role.Registered, 1, 2, 3.5, 4, 5, Some(t), true, false),
      """{"user_id":"u","username":"n","role":"Registered","labels":1,"validations":2,"distance_meters":3.5,"labels_validated":4,"labels_agreed":5,"last_active":"2026-09-29T12:30:00Z","high_quality":true,"excluded":false}"""
    )
    check(
      TeamMemberStats("u", "n", Role.Turker, 1, 2, 3.5, 4, 5, None, true, false),
      """{"user_id":"u","username":"n","role":"Turker","labels":1,"validations":2,"distance_meters":3.5,"labels_validated":4,"labels_agreed":5,"high_quality":true,"excluded":false}"""
    )
    check(
      TeamTotals(1, 2, 3, 4.5, 5, 6),
      """{"members":1,"labels":2,"validations":3,"distance_meters":4.5,"labels_validated":5,"labels_agreed":6}"""
    )
    check(
      TeamOverview(Team(1, "n", "d", true, false), Seq.empty, TeamTotals(0, 0, 0, 0.0, 0, 0)),
      """{"team":{"team_id":1,"name":"n","description":"d","open":true,"visible":false},"members":[],"totals":{"members":0,"labels":0,"validations":0,"distance_meters":0,"labels_validated":0,"labels_agreed":0}}"""
    )
    check(
      UserSearchResult("u", "n", "e", Role.Registered, Some("t")),
      """{"user_id":"u","username":"n","email":"e","role":"Registered","team":"t"}"""
    )
    check(
      UserSearchResult("u", "n", "e", Role.Registered, None),
      """{"user_id":"u","username":"n","email":"e","role":"Registered"}"""
    )
    check(
      Label(
        1,
        2,
        3,
        "u",
        "p",
        LabelType.Obstacle,
        false,
        4,
        t,
        false,
        5,
        6,
        7,
        8,
        Some(true),
        Some(2),
        Some("d"),
        List("a", "b"),
        Some("x"),
        Some(t),
        Some(UiSource.Explore)
      ),
      """{"label_id":1,"audit_task_id":2,"mission_id":3,"user_id":"u","pano_id":"p","label_type":"Obstacle","deleted":false,"temporary_label_id":4,"time_created":"2026-09-29T12:30:00Z","tutorial":false,"street_edge_id":5,"agree_count":6,"disagree_count":7,"unsure_count":8,"correct":true,"severity":2,"description":"d","tags":["a","b"],"deleted_by":"x","deleted_at":"2026-09-29T12:30:00Z","deleted_source":"Explore"}"""
    )
    check(
      Label(1, 2, 3, "u", "p", LabelType.Obstacle, false, 4, t, false, 5, 6, 7, 8, None, None, None, Nil),
      """{"label_id":1,"audit_task_id":2,"mission_id":3,"user_id":"u","pano_id":"p","label_type":"Obstacle","deleted":false,"temporary_label_id":4,"time_created":"2026-09-29T12:30:00Z","tutorial":false,"street_edge_id":5,"agree_count":6,"disagree_count":7,"unsure_count":8,"tags":[]}"""
    )
    check(POV(1.5, 2.5, 3.5), """{"heading":1.5,"pitch":2.5,"zoom":3.5}""")
    check(LocationXY(1, 2), """{"x":1,"y":2}""")
    check(
      UserCount(1, "explore", "all", TimeInterval.values.head, true, false),
      """{"count":1,"tool_used":"explore","role":"all","time_interval":"all_time","task_completed_only":true,"high_quality_only":false}"""
    )
    check(
      ContributionTimeStat(Some(1.5), "explore_total", TimeInterval.values.head),
      """{"time":1.5,"stat":"explore_total","time_interval":"all_time"}"""
    )
    check(
      ContributionTimeStat(None, "explore_total", TimeInterval.values.head),
      """{"time":null,"stat":"explore_total","time_interval":"all_time"}"""
    )
    check(
      LabelCount(1, TimeInterval.values.head, "CurbRamp"),
      """{"count":1,"time_interval":"all_time","label_type":"CurbRamp"}"""
    )
    check(
      GenericComment("c", "n", "p", t, "text", 1.5, 2.5, 3.5, Some(1)),
      """{"comment_type":"c","username":"n","pano_id":"p","timestamp":"2026-09-29T12:30:00Z","comment":"text","heading":1.5,"pitch":2.5,"zoom":3.5,"label_id":1}"""
    )
    check(
      GenericComment("c", "n", "p", t, "text", 1.5, 2.5, 3.5, None),
      """{"comment_type":"c","username":"n","pano_id":"p","timestamp":"2026-09-29T12:30:00Z","comment":"text","heading":1.5,"pitch":2.5,"zoom":3.5,"label_id":null}"""
    )
    check(
      AuditTaskInteraction(1L, 2, 3, "a", Some("p"), Some(1.5), Some(2.5), Some(3.5), Some(4.5), Some(5.5), Some("n"),
        Some(6), t),
      """{"audit_task_interaction_id":1,"audit_task_id":2,"mission_id":3,"action":"a","pano_id":"p","lat":1.5,"lng":2.5,"heading":3.5,"pitch":4.5,"zoom":5.5,"note":"n","temporary_label_id":6,"timestamp":"2026-09-29T12:30:00Z"}"""
    )
    check(
      AuditTaskInteraction(1L, 2, 3, "a", None, None, None, None, None, None, None, None, t),
      """{"audit_task_interaction_id":1,"audit_task_id":2,"mission_id":3,"action":"a","timestamp":"2026-09-29T12:30:00Z"}"""
    )
    check(
      UpdatedStreets(t, Seq(StreetEdgePriority(1, 2, 3.5))),
      """{"last_priority_update_time":"2026-09-29T12:30:00Z","updated_street_priorities":[{"street_edge_id":2,"priority":3.5}]}"""
    )
    check(
      AuditTask(
        1,
        Some(2),
        "u",
        3,
        t,
        t,
        true,
        1.5,
        2.5,
        false,
        Some(4),
        Some(GeometryFactory().createPoint(Coordinate(3.5, 4.5))),
        false,
        true,
        false,
        Some(5.5),
        Some(6.5),
        true,
        Some(t)
      ),
      """{"audit_task_id":1,"amt_assignment_id":2,"user_id":"u","street_edge_id":3,"task_start":"2026-09-29T12:30:00Z","task_end":"2026-09-29T12:30:00Z","completed":true,"current_lat":1.5,"current_lng":2.5,"start_point_reversed":false,"current_mission_id":4,"current_mission_start":{"lat":3.5,"lng":4.5},"low_quality":false,"incomplete":true,"stale":false,"audited_distance_m":5.5,"start_offset_m":6.5,"outdated_imagery":true,"outdated_imagery_at":"2026-09-29T12:30:00Z"}"""
    )
    check(
      AuditTask(1, None, "u", 3, t, t, true, 1.5, 2.5, false, None, None, false, true, false, None),
      """{"audit_task_id":1,"user_id":"u","street_edge_id":3,"task_start":"2026-09-29T12:30:00Z","task_end":"2026-09-29T12:30:00Z","completed":true,"current_lat":1.5,"current_lng":2.5,"start_point_reversed":false,"low_quality":false,"incomplete":true,"stale":false,"outdated_imagery":false}"""
    )
    check(
      LabelToCluster(1, "u", "p", 2, "CurbRamp", 1.5, 2.5, Some(3)),
      """{"region_id":1,"user_id":"u","pano_id":"p","label_id":2,"label_type":"CurbRamp","lat":1.5,"lng":2.5,"severity":3}"""
    )
    check(
      LabelToCluster(1, "u", "p", 2, "CurbRamp", 1.5, 2.5, None),
      """{"region_id":1,"user_id":"u","pano_id":"p","label_id":2,"label_type":"CurbRamp","lat":1.5,"lng":2.5,"severity":null}"""
    )
    check(ClusteringThreshold("CurbRamp", 1.5), """{"label_type":"CurbRamp","threshold":1.5}""")
    check(ExcludedTag("CurbRamp", "t"), """{"label_type":"CurbRamp","tag":"t"}""")
    check(AiTagConfidence("t", 0.5), """{"tag":"t","confidence":0.5}""")
    check(
      RouteWithStats(1, 2, "r", 3, "n", "s", Some("d"), 1.5, 4, t, 5, 6, "e", "th"),
      """{"route_id":1,"region_id":2,"region_name":"r","region_count":3,"name":"n","slug":"s","description":"d","distance_meters":1.5,"street_count":4,"created_at":"2026-09-29T12:30:00Z","started_count":5,"completed_count":6,"encoded_polyline":"e","thumbnail_url":"th"}"""
    )
    check(
      RouteWithStats(1, 2, "r", 3, "n", "s", None, 1.5, 4, t),
      """{"route_id":1,"region_id":2,"region_name":"r","region_count":3,"name":"n","slug":"s","distance_meters":1.5,"street_count":4,"created_at":"2026-09-29T12:30:00Z","started_count":0,"completed_count":0,"encoded_polyline":"","thumbnail_url":""}"""
    )
    check(
      SidewalkUserWithRole("u", "n", "e", Role.Researcher, true, false, Some(MeasurementSystem.Metric)),
      """{"user_id":"u","username":"n","email":"e","role":"Researcher","community_service":true,"infra3d_access":false,"measurement_system":"metric"}"""
    )
    check(
      SidewalkUserWithRole("u", "n", "e", Role.Researcher, true, false, None),
      """{"user_id":"u","username":"n","email":"e","role":"Researcher","community_service":true,"infra3d_access":false}"""
    )
    check(
      CityHours("c", "City", 1.5, true),
      """{"city_id":"c","city_name":"City","hours":1.5,"is_current_city":true}"""
    )
    check(
      UserStatsForAdminPage("u", "n", "e", Role.Registered, Some("t"), Some(t), Some(t), 1, 2, 3, 4.5, 5, 6.5, true,
        Some(false)),
      """{"user_id":"u","username":"n","email":"e","role":"Registered","team":"t","sign_up_time":"2026-09-29T12:30:00Z","last_sign_in_time":"2026-09-29T12:30:00Z","sign_in_count":1,"labels":2,"own_validated":3,"own_validated_agreed_pct":4.5,"others_validated":5,"others_validated_agreed_pct":6.5,"high_quality":true,"high_quality_manual":false}"""
    )
    check(
      UserStatsForAdminPage("u", "n", "e", Role.Registered, None, None, None, 1, 2, 3, 4.5, 5, 6.5, true, None),
      """{"user_id":"u","username":"n","email":"e","role":"Registered","sign_in_count":1,"labels":2,"own_validated":3,"own_validated_agreed_pct":4.5,"others_validated":5,"others_validated_agreed_pct":6.5,"high_quality":true}"""
    )
    check(Team(1, "n", "d", true, false), """{"team_id":1,"name":"n","description":"d","open":true,"visible":false}""")
  }
}
