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

  "trafficAnomaly" should {
    val steadyBaseline = Seq.fill(TrafficService.BaselineWeeks)(100)

    "flag a spike at or beyond the multiple of the baseline median" in {
      TrafficService.trafficAnomaly(steadyBaseline :+ 300) mustBe Some("traffic_spike")
      TrafficService.trafficAnomaly(steadyBaseline :+ 299) mustBe None
    }

    "flag a drop at or below the inverse multiple of the baseline median" in {
      val busy = Seq.fill(TrafficService.BaselineWeeks)(300)
      TrafficService.trafficAnomaly(busy :+ 100) mustBe Some("traffic_drop")
      TrafficService.trafficAnomaly(busy :+ 101) mustBe None
    }

    "never flag a quiet city, where the baseline is too noisy to mean anything" in {
      val quiet = Seq.fill(TrafficService.BaselineWeeks)(30)
      TrafficService.trafficAnomaly(quiet :+ 500) mustBe None
    }

    "use the median, so one earlier spike week can't mask a real change" in {
      // Mean baseline would be 350 (spike threshold 1050); the median stays 100 and catches the 300.
      val withOutlier = Seq(2100) ++ Seq.fill(TrafficService.BaselineWeeks - 1)(100)
      TrafficService.trafficAnomaly(withOutlier :+ 300) mustBe Some("traffic_spike")
    }

    "not flag a series shorter than the baseline plus the current week" in {
      TrafficService.trafficAnomaly(Seq.fill(TrafficService.BaselineWeeks)(100)) mustBe None
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
