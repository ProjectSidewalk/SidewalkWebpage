package controllers

import models.audit.AuditTaskTableDef
import models.street.{StreetEdgeRegionTableDef, StreetEdgeTableDef}
import models.utils.MyPostgresProfile.api._
import org.scalatestplus.play.PlaySpec
import org.scalatestplus.play.guice.GuiceOneAppPerSuite
import play.api.Application
import play.api.inject.guice.GuiceApplicationBuilder
import play.api.libs.json.{JsArray, JsValue}
import play.api.test.FakeRequest
import play.api.test.Helpers._
import play.silhouette.api.util.PasswordInfo
import service.AuthenticationService
import util.{AnonSession, RolledBackDb, StreetFixtures}

import scala.concurrent.{Await, Future}

/**
 * Pins the freshness contract of the per-mapper street feed the dashboard and public-profile maps draw from (#4896).
 *
 * The map styles a street from its `audited`/`outdated` pair, so the serializer has to say which of the two a street
 * is -- and it can only be checked by looking at a mapper who has one of each. Hence the fixture: a throwaway mapper
 * with exactly two streets, one refreshed and one still needing a re-audit. Asserting only that the keys are present
 * and never both true would pass just as happily against a feed that had gone back to hardcoding `audited = true`,
 * which is the regression this endpoint carries (#4384). The three-state contract itself is the same one
 * `/contribution/streets/all` carries (StreetAuditStatusSpec), minus the unaudited arm: every street in this feed is
 * one the mapper audited.
 *
 * The endpoint reads through its own connection, so unlike the model-level specs this one's rows have to be
 * committed; `afterAll` deletes every one of them, which is mandatory rather than tidy on a shared dev DB. Requires
 * a Postgres+PostGIS database (DATABASE_URL / DATABASE_USER / DATABASE_PASSWORD, as in dev/CI).
 */
// BeforeAndAfterAll must be mixed in BEFORE GuiceOneAppPerSuite: linearization then runs afterAll inside the running
// app, rather than after the app (and its DB pool) has already been stopped.
class UserStreetsFreshnessSpec
    extends PlaySpec
    with org.scalatest.BeforeAndAfterAll
    with GuiceOneAppPerSuite
    with RolledBackDb
    with StreetFixtures
    with AnonSession {

  // The limiter counts every session this suite mints against one loopback address, and a 429 would surface as a
  // failed session mint rather than as anything about the feed.
  override def fakeApplication(): Application =
    new GuiceApplicationBuilder()
      .disable[modules.ActorModule]
      .configure("rate-limit.anon-signup.enabled" -> false)
      .build()

  private val authService = app.injector.instanceOf[AuthenticationService]

  private val auditTasks        = TableQuery[AuditTaskTableDef]
  private val streetEdges       = TableQuery[StreetEdgeTableDef]
  private val streetEdgeRegions = TableQuery[StreetEdgeRegionTableDef]

  private def awaitF[T](f: Future[T]): T = Await.result(f, dbTimeout)

  /** The streets this suite seeded, held for afterAll to sweep. */
  private val seededStreetIds = scala.collection.mutable.Set[Int]()

  /** A mapper with one refreshed street and one that still needs a re-audit. */
  private case class Mapper(username: String, freshStreet: Int, staleStreet: Int)

  private var seeded: Option[Mapper] = None
  private def mapper: Mapper         = seeded.getOrElse(fail("The mapper fixture was not seeded."))

  // Seeded here rather than from a lazy val: a lazy val's initializer holds the suite instance's monitor for as long
  // as it runs, and these helpers finish their work on a Slick thread that would need the same monitor -- which
  // deadlocks until the await gives up.
  override def beforeAll(): Unit = {
    super.beforeAll()
    val user = awaitF(
      authService.createUser(
        awaitF(authService.generateUniqueAnonUser()),
        "credentials",
        PasswordInfo("bcrypt-sha256", "spec-only-not-a-hash", None),
        oldUserId = None
      )
    )
    // Set rather than assumed: a private profile answers 403 and the feed would never be reached.
    val _     = run(sqlu"""UPDATE user_stat SET public_profile = TRUE WHERE user_id = ${user.userId}""")
    val fresh = seedStreet()
    val stale = seedStreet()
    val _     = run(audit(fresh, user.userId))
    val _     = run(audit(stale, user.userId, outdated = true))
    seeded = Some(Mapper(user.username, fresh, stale))
  }

  /** Registers each street as it is created, so a failure part-way through the seed still leaves it to be swept. */
  private def seedStreet(): Int = {
    val streetEdgeId = run(insertStreet())
    seededStreetIds += streetEdgeId
    streetEdgeId
  }

  override def afterAll(): Unit = {
    val streetIds = seededStreetIds.toSeq
    if (streetIds.nonEmpty) {
      val _ = run(
        DBIO
          .seq(
            auditTasks.filter(_.streetEdgeId inSet streetIds).delete,
            streetEdgeRegions.filter(_.streetEdgeId inSet streetIds).delete,
            streetEdges.filter(_.streetEdgeId inSet streetIds).delete
          )
          .transactionally
      )
    }
    super.afterAll()
  }

  private def features(body: JsValue): Seq[JsValue] = (body \ "features").as[JsArray].value.toSeq

  /** The audited/outdated pair each feature carries, keyed by street. */
  private def freshnessByStreet(body: JsValue): Map[Int, (Boolean, Boolean)] =
    features(body).map { feature =>
      (feature \ "properties" \ "street_edge_id").as[Int] ->
        ((feature \ "properties" \ "audited").as[Boolean], (feature \ "properties" \ "outdated").as[Boolean])
    }.toMap

  /** The mapper's feed, as a signed-in visitor sees it. */
  private def feed: JsValue = {
    val resp = route(
      app,
      FakeRequest(GET, s"/userapi/public/${mapper.username}/streets").withCookies(freshAnonSession(): _*)
    ).get
    status(resp) mustBe OK
    contentAsJson(resp)
  }

  "The per-mapper street feed" should {
    "mark a street whose audits predate newer imagery as outdated, not audited" in {
      freshnessByStreet(feed).get(mapper.staleStreet) mustBe Some((false, true))
    }

    "mark a street with an audit on the current imagery as audited, not outdated" in {
      freshnessByStreet(feed).get(mapper.freshStreet) mustBe Some((true, false))
    }

    "carry every street the mapper audited, whichever state it is in" in {
      // Credit for the work doesn't depend on freshness: a street needing a re-audit still belongs on their map.
      freshnessByStreet(feed).keySet mustBe Set(mapper.freshStreet, mapper.staleStreet)
    }

    "give every street a mutually exclusive pair and the id the map keys features on" in {
      features(feed) must not be empty
      features(feed).foreach { feature =>
        val (audited, outdated) = freshnessByStreet(feed)((feature \ "properties" \ "street_edge_id").as[Int])
        (audited && outdated) mustBe false
        (feature \ "properties" \ "way_type").asOpt[String] mustBe defined
        (feature \ "geometry" \ "type").as[String] mustBe "LineString"
      }
    }
  }
}
