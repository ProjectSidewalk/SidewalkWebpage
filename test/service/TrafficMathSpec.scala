package service

import org.scalatestplus.play.PlaySpec
import play.api.libs.json.Json
import service.TrafficService.GaCredentials

import java.nio.charset.StandardCharsets
import java.security.{KeyPair, KeyPairGenerator, Signature}
import java.time.{Instant, LocalDate}
import java.util.Base64

/**
 * Pure-logic tests for the GA traffic reporting (Planning#8): the weekly bucketing and anomaly rules, and the
 * service-account JWT assembly, verified against a throwaway RSA keypair — no network, no app boot, no database.
 */
class TrafficMathSpec extends PlaySpec {

  private def dailySessions(anchor: LocalDate, perDay: Int, days: Int): Map[LocalDate, Int] =
    0.until(days).map(d => anchor.minusDays(d.toLong) -> perDay).toMap

  "weeklyBuckets" should {
    "sum trailing 7-day buckets anchored on the newest reported day, oldest first" in {
      val anchor = LocalDate.of(2026, 8, 20)
      // 14 days of 10/day: the two newest buckets are full (70), everything older is 0.
      val buckets = TrafficService.weeklyBuckets(dailySessions(anchor, 10, 14), 4)
      buckets mustBe Seq(0, 0, 70, 70)
    }

    "treat missing days as zero rather than shifting the buckets" in {
      val anchor = LocalDate.of(2026, 8, 20)
      val sparse = Map(anchor -> 5, anchor.minusDays(3) -> 7, anchor.minusDays(10) -> 11)
      TrafficService.weeklyBuckets(sparse, 2) mustBe Seq(11, 12)
    }

    "produce all zeros for an empty series" in {
      TrafficService.weeklyBuckets(Map.empty, 3) mustBe Seq(0, 0, 0)
    }

    "anchor on the newest day present, not the server's clock" in {
      // A property whose timezone hasn't reached "today" reports through yesterday; buckets must align to that.
      val anchor  = LocalDate.now().minusDays(400) // Far from the wall clock, so a clock-based anchor would zero it.
      val buckets = TrafficService.weeklyBuckets(dailySessions(anchor, 1, 7), 1)
      buckets mustBe Seq(7)
    }
  }

  "baselineMedian" should {
    "take the median of the complete buckets, excluding the one overlapping the current window" in {
      TrafficService.baselineMedian(Seq.fill(TrafficService.BaselineWeeks)(100) :+ 9999) mustBe Some(100.0)
    }

    "have no baseline for a series shorter than the baseline plus the current week" in {
      TrafficService.baselineMedian(Seq.fill(TrafficService.BaselineWeeks)(100)) mustBe None
    }
  }

  "trafficAnomaly" should {
    // The trailing bucket is dropped as the current week's own, so its value never reaches the baseline.
    val steady = Seq.fill(TrafficService.BaselineWeeks)(100) :+ 0

    "flag a spike at or beyond the multiple of the baseline median" in {
      TrafficService.trafficAnomaly(300, steady) mustBe Some("traffic_spike")
      TrafficService.trafficAnomaly(299, steady) mustBe None
    }

    "flag a drop at or below the inverse multiple of the baseline median" in {
      val busy = Seq.fill(TrafficService.BaselineWeeks)(300) :+ 0
      TrafficService.trafficAnomaly(100, busy) mustBe Some("traffic_drop")
      TrafficService.trafficAnomaly(101, busy) mustBe None
    }

    "never flag a quiet city, where the baseline is too noisy to mean anything" in {
      TrafficService.trafficAnomaly(500, Seq.fill(TrafficService.BaselineWeeks)(30) :+ 0) mustBe None
    }

    "use the median, so one earlier spike week can't mask a real change" in {
      // Mean baseline would be 350 (spike threshold 1050); the median stays 100 and catches the 300.
      val withOutlier = (Seq(2100) ++ Seq.fill(TrafficService.BaselineWeeks - 1)(100)) :+ 0
      TrafficService.trafficAnomaly(300, withOutlier) mustBe Some("traffic_spike")
    }

    "not flag a series shorter than the baseline plus the current week" in {
      TrafficService.trafficAnomaly(300, Seq.fill(TrafficService.BaselineWeeks)(100)) mustBe None
    }

    "judge the rolling-window count the page displays, not the newest bucket" in {
      // The page shows the rolling-window figure, so that is what the flag must be about — not the newest bucket.
      TrafficService.trafficAnomaly(300, Seq.fill(TrafficService.BaselineWeeks)(100) :+ 1) mustBe Some("traffic_spike")
    }
  }

  private lazy val keyPair: KeyPair = {
    val gen = KeyPairGenerator.getInstance("RSA")
    gen.initialize(2048)
    gen.generateKeyPair()
  }

  "buildJwt" should {
    "produce a three-part token whose signature verifies and whose claims name the service account" in {
      val now = Instant.ofEpochSecond(1755900000L)
      val jwt =
        TrafficService.buildJwt(GaCredentials("ga-reader@example.iam.gserviceaccount.com", keyPair.getPrivate), now)

      val parts = jwt.split('.')
      parts.length mustBe 3
      val (header, claims, signature) = (parts(0), parts(1), parts(2))
      val dec                         = Base64.getUrlDecoder

      val verifier = Signature.getInstance("SHA256withRSA")
      verifier.initVerify(keyPair.getPublic)
      verifier.update(s"$header.$claims".getBytes(StandardCharsets.US_ASCII))
      verifier.verify(dec.decode(signature)) mustBe true

      Json.parse(dec.decode(header)) mustBe Json.obj("alg" -> "RS256", "typ" -> "JWT")
      val claimsJson = Json.parse(dec.decode(claims))
      (claimsJson \ "iss").as[String] mustBe "ga-reader@example.iam.gserviceaccount.com"
      (claimsJson \ "scope").as[String] mustBe TrafficService.Scope
      (claimsJson \ "aud").as[String] mustBe TrafficService.TokenUrl
      (claimsJson \ "iat").as[Long] mustBe now.getEpochSecond
      (claimsJson \ "exp").as[Long] mustBe now.getEpochSecond + 3600
    }
  }

  "CityTraffic's Writes" should {
    // The page's renderer and jsdom fixtures read these exact names; JsonNaming.SnakeCase can't produce them
    // (it never breaks before digits), which live QA caught — so the wire contract gets pinned here.
    "emit the page convention's snake_case field names, digits included" in {
      val json = Json.toJson(
        CityTraffic(
          "seattle-wa",
          100,
          90,
          80,
          70,
          40,
          0.4,
          0.05,
          32494L,
          17690L,
          0.116,
          Some(LocalDate.of(2021, 10, 27)),
          Seq(1, 2, 3),
          Some(33.5),
          Some("traffic_spike")
        )
      )
      json.as[play.api.libs.json.JsObject].keys mustBe Set("city_id", "sessions_7d", "sessions_prior_7d",
        "active_users_7d", "active_users_prior_7d", "engaged_sessions_7d", "engagement_rate_7d", "mobile_share_28d",
        "sessions_all_time", "visitors_all_time", "mobile_share_all_time", "ga_since", "weekly_sessions",
        "baseline_median", "anomaly")
      (json \ "sessions_7d").as[Int] mustBe 100
      (json \ "sessions_all_time").as[Long] mustBe 32494L
      (json \ "visitors_all_time").as[Long] mustBe 17690L
      (json \ "ga_since").as[String] mustBe "2021-10-27"
      (json \ "baseline_median").as[Double] mustBe 33.5
      (json \ "anomaly").as[String] mustBe "traffic_spike"
    }
  }

  "parseServiceAccountKey" should {
    "extract the client email and a working private key from a service-account JSON blob" in {
      // A line-wrapped PEM inside a JSON string, the shape Google's key files use.
      val pemBody = Base64
        .getMimeEncoder(64, "\n".getBytes(StandardCharsets.US_ASCII))
        .encodeToString(keyPair.getPrivate.getEncoded)
      val raw = Json
        .obj(
          "type"         -> "service_account",
          "client_email" -> "ga-reader@example.iam.gserviceaccount.com",
          "private_key"  -> s"-----BEGIN PRIVATE KEY-----\n$pemBody\n-----END PRIVATE KEY-----\n"
        )
        .toString

      val creds = TrafficService.parseServiceAccountKey(raw).get
      creds.clientEmail mustBe "ga-reader@example.iam.gserviceaccount.com"

      // The parsed key must sign something the original public key verifies — i.e. it is the same key.
      val signer = Signature.getInstance("SHA256withRSA")
      signer.initSign(creds.privateKey)
      signer.update("round trip".getBytes(StandardCharsets.US_ASCII))
      val verifier = Signature.getInstance("SHA256withRSA")
      verifier.initVerify(keyPair.getPublic)
      verifier.update("round trip".getBytes(StandardCharsets.US_ASCII))
      verifier.verify(signer.sign()) mustBe true
    }

    "fail on a dummy/non-JSON value (how dev and CI disable the feature)" in {
      TrafficService.parseServiceAccountKey("DUMMY_GA_SERVICE_ACCOUNT_KEY").isFailure mustBe true
      TrafficService.parseServiceAccountKey("""{"client_email": "x@y.z"}""").isFailure mustBe true
    }
  }
}
