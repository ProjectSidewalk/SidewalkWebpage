package service

import org.scalatestplus.play.PlaySpec
import play.api.libs.json.{JsObject, Json}

/**
 * The wire contract between the media-storage panel's payload and the page that renders it (#4926).
 *
 * `HealthPage.js` reads these fields by name, and nothing else connects the two: rename a case-class field and the
 * writer quietly emits a different key, every value the panel reads goes undefined, and the page renders a table of
 * blanks — a storage monitor that reports nothing, which is indistinguishable from a storage monitor reporting that
 * nothing is wrong. Each key set below is exactly what `#renderMediaStorage` and `#mediaKpi` consume.
 *
 * Pure serialization — no app boot, no database.
 */
class HealthMediaPayloadSpec extends PlaySpec {

  import HealthService._

  private val dir = MediaDirStatus(
    key = "story.media.directory", envVar = "SIDEWALK_STORY_MEDIA_DIR", irreplaceable = true,
    path = "/srv/sidewalk/story-media", status = "unsafe", label = "a deploy will delete this", severity = "bad",
    detail = Some("resolves inside the build output tree")
  )

  private val city = CityStoryMedia(
    cityId = Some("chicago-il"),
    schema = "sidewalk_chicago",
    rows = 3,
    missing = 1,
    orphans = 2,
    missingIds = Seq(1),
    orphanIds = Seq(7, 8),
    scanned = true,
    unscannedReason = Some("not scanned")
  )

  private val health = MediaStorageHealth(
    directories = Seq(dir),
    enforced = true,
    storyMedia = Some(StoryMediaIntegrity("/srv/sidewalk/story-media", Seq(city), 1, 2)),
    unavailable = Some("storage may be offline")
  )

  private def keysOf(json: JsObject): Set[String] = json.keys.toSet

  "The media storage payload" should {
    "carry every field the panel's directory table reads, under the names it reads them by" in {
      keysOf(Json.toJson(dir).as[JsObject]) mustBe
        Set("key", "env_var", "irreplaceable", "path", "status", "label", "severity", "detail")
    }

    "carry every field the panel's per-city table reads" in {
      keysOf(Json.toJson(city).as[JsObject]) mustBe
        Set("city_id", "schema", "rows", "missing", "orphans", "missing_ids", "orphan_ids", "scanned",
          "unscanned_reason")
    }

    "carry the scan's own totals and base directory" in {
      keysOf(Json.toJson(StoryMediaIntegrity("/srv/media", Seq(city), 1, 2)).as[JsObject]) mustBe
        Set("base_dir", "cities", "missing", "orphans")
    }

    "carry the panel's own four fields" in {
      keysOf(Json.toJson(health).as[JsObject]) mustBe Set("directories", "enforced", "story_media", "unavailable")
    }

    "hang the whole panel off media_storage, which is the key the page looks for" in {
      val payload = DbHealthData(
        generatedAt = "2026-08-20T00:00:00Z",
        currentDatabase = "sidewalk",
        currentRole = "sidewalk",
        canSeeAllQueries = true,
        blockingSessions = Seq.empty,
        idleInTransaction = Seq.empty,
        activeQueries = Seq.empty,
        stuckEvolutions = Seq.empty,
        tableBloat = Seq.empty,
        connections = Seq.empty,
        panoBackups = None,
        mediaStorage = Some(health),
        thresholds = HealthThresholds(1, 2, 3, 4, 5, 6, 0.2, 0.4, 1000, 60, 40, 20, 30)
      )
      (Json.toJson(payload) \ "media_storage" \ "story_media" \ "missing").as[Int] mustBe 1
    }

    "omit the optional fields rather than send nulls, which is what the page's fallbacks expect" in {
      // `unscanned_reason` absent is how a scanned city says it has nothing to explain, and `detail` absent is how a
      // healthy directory does; the page falls back on absence, so emitting an explicit null would be a change.
      val clean = Json.toJson(city.copy(unscannedReason = None)).as[JsObject]
      clean.keys must not contain "unscanned_reason"
      Json.toJson(dir.copy(detail = None)).as[JsObject].keys must not contain "detail"
    }
  }
}
