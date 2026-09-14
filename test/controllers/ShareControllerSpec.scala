package controllers

import models.label.LabelTypeEnum.AccessImpact
import models.label.{CropMarker, LabelMetadata, LabelTypeEnum}
import models.story.Story
import org.apache.pekko.stream.Materializer
import org.scalatestplus.play.PlaySpec
import org.scalatestplus.play.guice.GuiceOneAppPerSuite
import play.api.Application
import play.api.i18n.{Lang, MessagesApi}
import play.api.inject.guice.GuiceApplicationBuilder
import play.api.libs.json.JsObject
import play.api.test.FakeRequest
import play.api.test.Helpers._
import service.{AuthenticationService, LabelService, PanoDataService, ShareImageCache, StoryService}

import java.awt.image.BufferedImage
import java.io.{ByteArrayInputStream, File}
import java.nio.file.Files
import javax.imageio.ImageIO
import scala.concurrent.{Await, Future}
import scala.concurrent.duration._

/**
 * Functional tests for the public label-share surface (issue #456): GET /label/:labelId (rich-preview landing) and
 * GET /label/:labelId/image (crawler-facing preview image), plus the two reads the share landing opened to anonymous
 * access and the image-compositing internals.
 *
 * Both endpoints must be reachable with no auth cookie so social crawlers can read the Open Graph / Twitter Card
 * preview. Asserts response shape (status, content type, the OG/Twitter meta contract, image dimensions), not data
 * values. Boots the full application against the real Slick/PostGIS DB; the eager background actors are disabled so
 * they don't fire DB/WS work during the test.
 *
 * Requires a Postgres+PostGIS database (via DATABASE_URL / DATABASE_USER / DATABASE_PASSWORD env, as in dev/CI).
 * Valid-label tests source ids from the connected DB and cancel (not fail) when no suitable label exists.
 */
class ShareControllerSpec extends PlaySpec with GuiceOneAppPerSuite {

  override def fakeApplication(): Application =
    new GuiceApplicationBuilder()
      .disable[modules.ActorModule] // No eager background actors during tests (nothing else injects their ActorRefs).
      .build()

  // The image endpoint streams a file (sendFile), which needs a real Materializer to consume; the test default is
  // NoMaterializer, which only works for strict bodies.
  implicit lazy val mat: Materializer = app.materializer

  private val labelService: LabelService = app.injector.instanceOf[LabelService]
  private val messagesApi: MessagesApi   = app.injector.instanceOf[MessagesApi]
  implicit private val lang: Lang        = Lang("en") // Requests below send no Accept-Language, so Play serves English.

  /**
   * Recent labels from the connected test DB, providing real ids to exercise. Sourcing ids from the app keeps the
   * assertions valid against whatever data the connected DB happens to contain.
   */
  private lazy val recentLabels: Seq[LabelMetadata] =
    Await.result(labelService.getRecentLabelMetadata(50), 60.seconds)

  private lazy val validLabelId: Option[Int] = recentLabels.headOption.map(_.labelId)

  /** A recent label whose type matches the predicate, or `None`; lets tests target the title-copy fork. */
  private def labelWhere(pred: LabelMetadata => Boolean): Option[LabelMetadata] = recentLabels.find(pred)

  /** The og:url meta tag's content, or a test failure when the page carries none. */
  private def ogUrl(body: String): String =
    "property=\"og:url\" content=\"([^\"]*)\"".r
      .findFirstMatchIn(body)
      .map(_.group(1))
      .getOrElse(fail("No og:url meta tag in the page"))

  "GET /label/:labelId" should {
    "render the share landing (200, no auth) with the full OG/Twitter meta contract" in {
      validLabelId match {
        case None     => cancel("No labels in the connected test DB; cannot exercise the valid-label path.")
        case Some(id) =>
          val resp = route(app, FakeRequest(GET, s"/label/$id")).get
          status(resp) mustBe OK

          val body = contentAsString(resp)
          body must include("og:title")
          // Exactly one og:title: the page's own share meta must suppress the layout's default OG block (#4237).
          "property=\"og:title\"".r.findAllMatchIn(body).size mustBe 1
          body must include("og:description")
          body must include("og:url")
          body must include("og:image")
          body must include("og:image:width")
          body must include("og:image:height")
          body must include("og:image:alt")
          body must include("twitter:card")
          body must include("twitter:image:alt")
          body must include("summary_large_image")
          // Versioned so a platform that cached the card image by URL re-fetches after a generation bump (#3095).
          body must include(s"/label/$id/image?g=${ShareImageCache.Generation}")
      }
    }

    "render the spotlight page (reused LabelDetail hero + legend), never the city-wide LabelMap label layer" in {
      validLabelId match {
        case None     => cancel("No labels in the connected test DB; cannot exercise the valid-label path.")
        case Some(id) =>
          val body = contentAsString(route(app, FakeRequest(GET, s"/label/$id")).get)
          // The whole point of the spotlight pivot (#456, Mikey review): the share landing must NOT pull `/labels/all`,
          // a city's single most expensive endpoint, on every bot-crawled hit. The nearby-labels map uses the cheap,
          // bbox-bounded /v3/api/rawLabels instead — wired client-side from the SharedLabel bundle + config below.
          body must not include "/labels/all"
          body must include("js/shared-label/build/shared-label.js")
          body must include("window.sharedLabelData")
          // The hero reuses the shared LabelDetail component mounted inline; plus the label legend and Explore CTA.
          body must include("label-detail--inline")
          body must include("spotlight-legend")
          body must include("spotlight-explore-cta")
      }
    }

    "lead the OG description with the linked story's words and keep the ?storyId anchor in og:url (#4722)" in {
      validLabelId match {
        case None     => cancel("No labels in the connected test DB; cannot exercise the valid-label path.")
        case Some(id) =>
          val storyService = app.injector.instanceOf[StoryService]
          val anonUser     =
            Await.result(app.injector.instanceOf[AuthenticationService].getDefaultAnonUser, 30.seconds)
          val storyText = "The crossing signal here changes too fast for me to make it across safely."
          Await.result(
            storyService.submitStory(id, anonUser.userId, storyText, Story.DisplayNameAnonymous, None),
            30.seconds
          ) match {
            // One story per user per label (server-enforced), so a leftover story from earlier data can block this.
            case Left(rejection) => cancel(s"Could not seed a story on label $id: $rejection")
            case Right(seeded)   =>
              try {
                val body =
                  contentAsString(route(app, FakeRequest(GET, s"/label/$id?storyId=${seeded.storyId}")).get)
                // The shared og:url keeps the story anchor. Asserted on the meta tag itself — the layout also
                // echoes the request URL elsewhere (language switcher, auth returnUrl), which proves nothing.
                ogUrl(body) must endWith(s"/label/$id?storyId=${seeded.storyId}")
                // The description leads with the storyteller's words, not the label-type boilerplate — Facebook
                // and LinkedIn build their card entirely from these server-rendered tags.
                body must include("changes too fast")
                body must include("a community story")
              } finally {
                val _ = Await.result(storyService.deleteOwnStory(seeded.storyId, anonUser.userId), 30.seconds)
              }
          }
      }
    }

    "degrade an unresolvable story anchor (unknown, malformed, negative) to the plain label page" in {
      validLabelId match {
        case None     => cancel("No labels in the connected test DB; cannot exercise the valid-label path.")
        case Some(id) =>
          // Share links live in the wild for years: a deleted/hidden story, a mangled id, or junk must all render
          // the ordinary label page (200), with no story anchor left in the OG meta. (The layout still echoes the
          // request URL in the language switcher / auth returnUrl, so only the og:url tag is asserted on.)
          for (qs <- Seq("?storyId=2147483646", "?storyId=abc", "?storyId=-4")) {
            val resp = route(app, FakeRequest(GET, s"/label/$id$qs")).get
            status(resp) mustBe OK
            ogUrl(contentAsString(resp)) must endWith(s"/label/$id")
          }
      }
    }

    "resolve a valid in-range location via getLabelLatLng for labels that have one" in {
      // Backs the spotlight minimap centering (#456). Real recent labels carry a label_point location, so at least one
      // of a small sample must resolve, and every resolved coordinate must be geographically in range.
      assume(recentLabels.nonEmpty, "No labels in the connected test DB; cannot exercise the valid-label path.")
      val locations =
        recentLabels.take(10).flatMap(l => Await.result(labelService.getLabelLatLng(l.labelId), 30.seconds))
      locations must not be empty
      locations.foreach { loc =>
        loc.lat must (be >= -90.0 and be <= 90.0)
        loc.lng must (be >= -180.0 and be <= 180.0)
      }
    }

    "not mint a session or account for an anonymous view" in {
      validLabelId match {
        case None     => cancel("No labels in the connected test DB; cannot exercise the valid-label path.")
        case Some(id) =>
          val resp = route(app, FakeRequest(GET, s"/label/$id")).get
          status(resp) mustBe OK
          // The historical behavior this feature deliberately avoids: SecuredAction 302s anonymous visitors through
          // /anonSignUp, creating a DB user + auth cookie per crawler hit. The share landing must set no session.
          val sessionCookieName = app.configuration.get[String]("play.http.session.cookieName")
          headers(resp).get(SET_COOKIE).getOrElse("") must not include sessionCookieName
      }
    }

    "use the issue title framing for access-issue label types" in {
      labelWhere(_.labelType.accessImpact == AccessImpact.Problem) match {
        case None        => cancel("No recent access-issue label in the test DB.")
        case Some(label) =>
          val body = contentAsString(route(app, FakeRequest(GET, s"/label/${label.labelId}")).get)
          body must include(messagesApi("share.meta.title.issue", messagesApi(label.labelType.nameKey)))
      }
    }

    "use the feature title framing for non-issue label types" in {
      labelWhere(_.labelType.accessImpact != AccessImpact.Problem) match {
        case None        => cancel("No recent non-issue label in the test DB.")
        case Some(label) =>
          val body = contentAsString(route(app, FakeRequest(GET, s"/label/${label.labelId}")).get)
          body must include(messagesApi("share.meta.title.feature", messagesApi(label.labelType.nameKey)))
      }
    }

    "state the severity in the description for an access-issue label that has one" in {
      labelWhere(l => l.labelType.accessImpact == AccessImpact.Problem && l.severity.isDefined) match {
        case None        => cancel("No recent access-issue label with a severity in the test DB.")
        case Some(label) =>
          val body = contentAsString(route(app, FakeRequest(GET, s"/label/${label.labelId}")).get)
          body must include(messagesApi("share.meta.description.severity", label.severity.get))
      }
    }

    "list tags in the description for a label that has them" in {
      labelWhere(_.tags.nonEmpty) match {
        case None        => cancel("No recent tagged label in the test DB.")
        case Some(label) =>
          val body = contentAsString(route(app, FakeRequest(GET, s"/label/${label.labelId}")).get)
          body must include(messagesApi("share.meta.description.tags", label.tags.take(3).mkString(", ")))
      }
    }

    "return 404 for a nonexistent label id" in {
      status(route(app, FakeRequest(GET, "/label/999999999")).get) mustBe NOT_FOUND
    }
  }

  "GET /label/:labelId/image" should {
    "serve a JPEG (200, no auth) at exactly the advertised share dimensions" in {
      validLabelId match {
        case None     => cancel("No labels in the connected test DB; cannot exercise the valid-label path.")
        case Some(id) =>
          val resp = route(app, FakeRequest(GET, s"/label/$id/image")).get
          status(resp) mustBe OK
          contentType(resp) mustBe Some("image/jpeg")
          header(CACHE_CONTROL, resp).getOrElse("") must include("max-age")

          // The meta advertises og:image:width/height 1440x960; the pipeline must make that true for every source
          // (stored crop, GSV still, or fallback), so decode the actual bytes and check.
          val img = ImageIO.read(new ByteArrayInputStream(contentAsBytes(resp).toArray))
          img.getWidth mustBe 1440
          img.getHeight mustBe 960
      }
    }

    "serve identical bytes on a repeat request (disk-cached, stable URL)" in {
      validLabelId match {
        case None     => cancel("No labels in the connected test DB; cannot exercise the valid-label path.")
        case Some(id) =>
          val first  = contentAsBytes(route(app, FakeRequest(GET, s"/label/$id/image")).get)
          val second = contentAsBytes(route(app, FakeRequest(GET, s"/label/$id/image")).get)
          second mustBe first
      }
    }

    "return 404 for a nonexistent label id" in {
      status(route(app, FakeRequest(GET, "/label/999999999/image")).get) mustBe NOT_FOUND
    }
  }

  // Public reads the spotlight surface relies on. /label/id/:labelId was relaxed from SecuredAction to a public read
  // as part of #456 (per-user fields fall back to the no-user case) and still backs the shared label-detail popup on
  // Gallery/LabelMap; /v3/api/rawLabels is the cheap, bbox-bounded API the spotlight's nearby-labels map fetches.
  "public reads the spotlight surface relies on" should {
    "serve label detail JSON at /label/id/:labelId with no auth cookie" in {
      validLabelId match {
        case None     => cancel("No labels in the connected test DB; cannot exercise the valid-label path.")
        case Some(id) =>
          val resp = route(app, FakeRequest(GET, s"/label/id/$id")).get
          status(resp) mustBe OK
          contentType(resp) mustBe Some("application/json")
          contentAsString(resp) must include("label_id")
      }
    }

    "carry the pano_data.address field in the label detail JSON (#4489)" in {
      validLabelId match {
        case None     => cancel("No labels in the connected test DB; cannot exercise the valid-label path.")
        case Some(id) =>
          val json = contentAsJson(route(app, FakeRequest(GET, s"/label/id/$id")).get)
          // The shared label-detail component reads pano_data.address for its visible Address row. The key must be
          // present (null until an address is captured for the pano) — a missing key would mean the positional
          // SQL→GetResult mapping in getSingleLabelMetadata dropped or misaligned the column.
          (json \ "pano_data").toOption must not be empty
          ((json \ "pano_data").get \ "address").isDefined mustBe true
      }
    }

    "carry the card's comment contract fields when a label has validator comments (#4572)" in {
      recentLabels.find(_.comments.nonEmpty) match {
        case None    => cancel("No commented labels among recent labels in the connected test DB.")
        case Some(l) =>
          val json     = contentAsJson(route(app, FakeRequest(GET, s"/label/id/${l.labelId}")).get)
          val comments = (json \ "comments").as[Seq[JsObject]]
          comments must not be empty
          // The card renders the You chip from `mine`, the relative-time pill from `time_created`, and the
          // anonymous avatar from `commenter`; usernames must NOT appear on this public payload.
          comments.foreach { c =>
            c.keys must contain allOf ("comment", "mine", "time_created", "commenter")
            c.keys must not contain "username"
          }
      }
    }

    "serve nearby labels as GeoJSON from /v3/api/rawLabels with no auth cookie" in {
      val resp = route(app, FakeRequest(GET, "/v3/api/rawLabels?filetype=geojson")).get
      status(resp) mustBe OK
      contentAsString(resp) must include("FeatureCollection")
    }
  }

  // Regression guard for #456: the GET /label/:labelId share route binds a non-optional Int, so Play returns 400 (it
  // does NOT fall through) whenever a non-numeric /label/<x> path matches it. Placed above its literal siblings in
  // conf/routes, the wildcard silently shadowed /label/tags, /label/resumeMission and /label/countInRegion, 400ing the
  // Explore tag menu / mission-resume / region-count and the Gallery tag filter. The literal routes must be matched
  // first. /label/tags needs no query param, so it is the cleanest probe: a 400 here means the wildcard shadows again.
  "the /label/:labelId share route" should {
    "not shadow the literal /label/tags route (conf/routes order)" in {
      val resp = route(app, FakeRequest(GET, "/label/tags")).get
      status(resp) mustBe OK // A 400 would mean /label/:labelId captured "tags" and failed to bind it as an Int.
      contentType(resp) mustBe Some("application/json")
    }
  }

  "storyExcerpt" should {
    val controller = app.injector.instanceOf[ShareController]

    "pass short text through with whitespace collapsed" in {
      controller.storyExcerpt("  Snow   piles\nup here.  ") mustBe "Snow piles up here."
    }

    "cut long text at a word boundary inside the cap and append an ellipsis" in {
      val excerpt = controller.storyExcerpt(("word " * 40).trim, cap = 90)
      excerpt mustBe ("word " * 18).trim + "…"
    }

    "hard-cut text with no usable word boundary (e.g. CJK)" in {
      controller.storyExcerpt("字" * 200, cap = 90) mustBe "字" * 90 + "…"
    }
  }

  "compositeMarker" should {
    val controller = app.injector.instanceOf[ShareController]

    /** Builds a solid-color base image for compositing tests. */
    def solidBase(w: Int, h: Int, rgb: Int): BufferedImage = {
      val img = new BufferedImage(w, h, BufferedImage.TYPE_INT_RGB)
      val g   = img.createGraphics()
      g.setColor(new java.awt.Color(rgb))
      g.fillRect(0, 0, w, h)
      g.dispose()
      img
    }

    /** Center of the bounding box of all pixels that differ from the background color. */
    def markerCenter(img: BufferedImage, bgRgb: Int): (Int, Int) = {
      var (minX, minY, maxX, maxY) = (Int.MaxValue, Int.MaxValue, -1, -1)
      for {
        y <- 0 until img.getHeight
        x <- 0 until img.getWidth
      } {
        if ((img.getRGB(x, y) & 0xffffff) != bgRgb) {
          minX = math.min(minX, x); minY = math.min(minY, y)
          maxX = math.max(maxX, x); maxY = math.max(maxY, y)
        }
      }
      withClue("expected the marker icon to change at least one pixel: ") { maxX must be >= 0 }
      ((minX + maxX) / 2, (minY + maxY) / 2)
    }

    val bg           = 0xcc0000 // Solid red; no label-type icon is red, so any non-red pixel is the marker.
    val canvasCenter = CropMarker(0.5, 0.5)

    "output the fixed share dimensions and keep a centered marker centered when a taller base is cover-cropped" in {
      val out = controller.compositeMarker(solidBase(640, 480, bg), LabelTypeEnum.CurbRamp, canvasCenter)
      out.getWidth mustBe 1440
      out.getHeight mustBe 960
      val (cx, cy) = markerCenter(out, bg)
      cx must be(720 +- 3)
      cy must be(480 +- 3)
    }

    "put an edge marker on a Street View still where the crop path puts it (#3095)" in {
      // The marker is the label's fraction of the Explore frame on both bases, so the still only agrees with the crop
      // if it is that frame — any extra rows would shift the same fraction (a 640x480 still lands this one 42 px up).
      val nearTop = CropMarker(0.62, 0.15)
      val still   = solidBase(PanoDataService.StaticStillWidth, PanoDataService.StaticStillHeight, bg)
      val onStill = markerCenter(controller.compositeMarker(still, LabelTypeEnum.Crosswalk, nearTop), bg)
      val onCrop  =
        markerCenter(controller.compositeMarker(solidBase(1440, 960, bg), LabelTypeEnum.Crosswalk, nearTop), bg)
      onStill._1 must be(onCrop._1 +- 3)
      onStill._2 must be(onCrop._2 +- 3)
      onCrop._2 must be(144 +- 3)
    }

    "keep a centered marker centered for a crop-sized (already 3:2) base" in {
      val out      = controller.compositeMarker(solidBase(1440, 960, bg), LabelTypeEnum.NoCurbRamp, canvasCenter)
      val (cx, cy) = markerCenter(out, bg)
      cx must be(720 +- 3)
      cy must be(480 +- 3)
    }

    "map an off-center marker through the cover-crop transform" in {
      // A marker at 1/4 width on a 3:2 base (scale-only, no crop): marker center must land at 1/4 output width.
      val quarter  = CropMarker(0.25, 0.5)
      val out      = controller.compositeMarker(solidBase(1440, 960, bg), LabelTypeEnum.Obstacle, quarter)
      val (cx, cy) = markerCenter(out, bg)
      cx must be(360 +- 3)
      cy must be(480 +- 3)
    }
  }

  "looksLikeBlankImagery" should {
    val controller = app.injector.instanceOf[ShareController]

    "detect a flat placeholder even with a small text overlay" in {
      // Shaped like GSV's "Sorry, we have no imagery here" card: uniform background, a few dark text pixels.
      val img = new BufferedImage(640, 480, BufferedImage.TYPE_INT_RGB)
      val g   = img.createGraphics()
      g.setColor(new java.awt.Color(0xe0ded8))
      g.fillRect(0, 0, 640, 480)
      g.setColor(java.awt.Color.DARK_GRAY)
      g.fillRect(230, 235, 180, 12)
      g.dispose()
      controller.looksLikeBlankImagery(img) mustBe true
    }

    "pass a structured photo-like image" in {
      val img = new BufferedImage(640, 480, BufferedImage.TYPE_INT_RGB)
      for {
        y <- 0 until 480
        x <- 0 until 640
      }
        img.setRGB(x, y, ((x * 31 + y * 17) % 200 << 16) | ((x * 13 + y * 7) % 200 << 8) | ((x + y) % 200))
      controller.looksLikeBlankImagery(img) mustBe false
    }
  }

  "shareImageDir" should {
    "resolve the relative default under the application root, not the process working directory" in {
      // A staged prod app runs from the stage dir, so a CWD-relative cache path would silently point somewhere else
      // there (the same trap the clustering-script packaging hit).
      val controller  = app.injector.instanceOf[ShareController]
      val environment = app.injector.instanceOf[play.api.Environment]
      controller.shareImageDir.getAbsolutePath must startWith(environment.rootPath.getAbsolutePath)
    }
  }

  "ShareImageCache" should {
    val cache = app.injector.instanceOf[service.ShareImageCache]

    // Well outside the range of any real label id, so a test can create and delete one without touching the cache
    // a running app is serving from.
    val syntheticLabelId = -987654

    "name a label's preview inside the cache directory, and recognize what it named" in {
      cache.fileFor(syntheticLabelId).getParentFile.getAbsolutePath mustBe cache.dir.getAbsolutePath
      cache.fileFor(syntheticLabelId).getName mustBe ShareImageCache.fileName(syntheticLabelId)
      // The sweep trusts generationOf to find every preview fileFor writes: a name the two disagree on would either
      // never be evicted or be evicted on every build.
      ShareImageCache.generationOf(cache.fileFor(syntheticLabelId)) mustBe Some(ShareImageCache.Generation)
      ShareImageCache.generationOf(new File(cache.dir, ShareImageCache.fileName(syntheticLabelId, 1))) mustBe Some(1)
      ShareImageCache.fileName(12, 1) mustBe "share_12.jpg" // Generation 1 predates the suffix.
      ShareImageCache.generationOf(new File(cache.dir, "share_12_g1.jpg")) mustBe None // Never written; a stray.
      ShareImageCache.generationOf(new File(cache.dir, "share_fallback.jpg")) mustBe None
      ShareImageCache.generationOf(new File(cache.dir, "share_12_g2.jpg.8675309.tmp")) mustBe None
      ShareImageCache.generationOf(new File(cache.dir, "story_12.jpg")) mustBe None
    }

    "promote the newest earlier-generation preview to current, and drop them all once the current one exists" in {
      val _          = cache.dir.mkdirs()
      val legacyGen1 = new File(cache.dir, ShareImageCache.fileName(syntheticLabelId, 1))
      val current    = cache.fileFor(syntheticLabelId)
      try {
        cache.promoteLegacy(syntheticLabelId) mustBe None
        Files.write(legacyGen1.toPath, Array[Byte](7))
        cache.promoteLegacy(syntheticLabelId) mustBe Some(current)
        legacyGen1.exists() mustBe false
        Files.readAllBytes(current.toPath) mustBe Array[Byte](7)
        // A concurrent build that already wrote the real thing must win over the promotion.
        Files.write(legacyGen1.toPath, Array[Byte](1))
        cache.promoteLegacy(syntheticLabelId) mustBe Some(current)
        Files.readAllBytes(current.toPath) mustBe Array[Byte](7)
        cache.dropLegacy(syntheticLabelId)
        legacyGen1.exists() mustBe false
        cache.dropLegacy(syntheticLabelId) // Nothing left: must not throw or warn its way into a failure.
      } finally { val _ = legacyGen1.delete(); val _ = current.delete() }
    }

    "delete a cached preview so the next request rebuilds it from the crop that just landed (#4726)" in {
      val _      = cache.dir.mkdirs()
      val file   = cache.fileFor(syntheticLabelId)
      val legacy = new File(cache.dir, ShareImageCache.fileName(syntheticLabelId, 1))
      val _      = file.createNewFile()
      val _      = legacy.createNewFile() // An old still-based preview is just as stale once the crop is here.
      file.exists() mustBe true

      cache.invalidate(syntheticLabelId)

      file.exists() mustBe false
      legacy.exists() mustBe false
    }

    "do nothing when the label has no cached preview, which is the common case" in {
      cache.invalidate(syntheticLabelId)
      cache.fileFor(syntheticLabelId).exists() mustBe false
    }
  }

  "evictStaleShareImages" should {
    val controller = app.injector.instanceOf[ShareController]

    /** Creates `n` empty current-generation cache files with strictly increasing mtimes (index 0 = oldest). */
    def fillCache(dir: File, n: Int): Seq[File] =
      (1 to n).map { i =>
        val f = new File(dir, s"share_${i}_g${ShareImageCache.Generation}.jpg")
        val _ = f.createNewFile()
        val _ = f.setLastModified(1700000000000L + i * 60000L)
        f
      }

    "delete only the least-recently-modified files past the ceiling" in {
      val dir = Files.createTempDirectory("share-evict-spec").toFile
      try {
        val files = fillCache(dir, 5)
        controller.evictStaleShareImages(dir, maxFiles = 3)
        files.map(_.exists()) mustBe Seq(false, false, true, true, true)
      } finally {
        Option(dir.listFiles()).getOrElse(Array.empty[File]).foreach(f => f.delete())
        val _ = dir.delete()
      }
    }

    "leave a cache at or under the ceiling untouched" in {
      val dir = Files.createTempDirectory("share-evict-spec").toFile
      try {
        val files = fillCache(dir, 3)
        controller.evictStaleShareImages(dir, maxFiles = 3)
        files.map(_.exists()) mustBe Seq(true, true, true)
      } finally {
        Option(dir.listFiles()).getOrElse(Array.empty[File]).foreach(f => f.delete())
        val _ = dir.delete()
      }
    }

    "count earlier-generation previews toward the ceiling and evict them by age like any other (#3095)" in {
      val dir = Files.createTempDirectory("share-evict-spec").toFile
      try {
        val current = fillCache(dir, 2)
        val legacy  = Seq(new File(dir, "share_7.jpg"), new File(dir, "share_8.jpg"))
        legacy.zipWithIndex.foreach { case (f, i) =>
          val _ = f.createNewFile()
          val _ = f.setLastModified(1600000000000L + i * 60000L) // Both older than every current file.
        }
        controller.evictStaleShareImages(dir, maxFiles = 10)
        legacy.map(_.exists()) mustBe Seq(true, true) // Under the ceiling nothing goes, whatever its generation.
        controller.evictStaleShareImages(dir, maxFiles = 3)
        legacy.map(_.exists()) mustBe Seq(false, true)
        current.map(_.exists()) mustBe Seq(true, true)
      } finally {
        Option(dir.listFiles()).getOrElse(Array.empty[File]).foreach(f => f.delete())
        val _ = dir.delete()
      }
    }

    "never touch the branded fallback or a temp file another build is still writing, even past the ceiling" in {
      // ImageUtils.writeJpeg fills `<name>.<random>.tmp` beside the target and renames it into place; unlinking it
      // mid-write fails that rename and 500s the other request. The fallback is rebuilt on demand but serves from
      // disk in the meantime, so evicting it races every fallback serve.
      val dir = Files.createTempDirectory("share-evict-spec").toFile
      try {
        val current   = fillCache(dir, 4)
        val untouched = Seq(new File(dir, "share_fallback.jpg"), new File(dir, "share_9_g2.jpg.12345.tmp"))
        untouched.foreach { f =>
          val _ = f.createNewFile()
          val _ = f.setLastModified(1600000000000L) // Older than everything: age alone would evict these first.
        }
        controller.evictStaleShareImages(dir, maxFiles = 2)
        untouched.map(_.exists()) mustBe Seq(true, true)
        current.map(_.exists()) mustBe Seq(false, false, true, true)
      } finally {
        Option(dir.listFiles()).getOrElse(Array.empty[File]).foreach(f => f.delete())
        val _ = dir.delete()
      }
    }
  }

  "serveLegacyOrFallbackImage" should {
    val controller = app.injector.instanceOf[ShareController]
    val cache      = app.injector.instanceOf[service.ShareImageCache]
    val labelId    = -987655 // Its own synthetic id: the ShareImageCache block above creates and deletes -987654.

    "serve the label's earlier-generation preview when nothing better can be built, as the current one (#3095)" in {
      val _       = cache.dir.mkdirs()
      val legacy  = new File(cache.dir, ShareImageCache.fileName(labelId, 1))
      val current = cache.fileFor(labelId)
      try {
        Files.write(legacy.toPath, Array[Byte](1, 2, 3)) // Any bytes: the point is which file is served.
        val result = Future.successful(controller.serveLegacyOrFallbackImage(labelId))
        status(result) mustBe OK
        contentAsBytes(result).toArray mustBe Array[Byte](1, 2, 3)
        current.exists() mustBe true // The next request is a plain cache hit, not another build attempt.
        legacy.exists() mustBe false
      } finally { val _ = legacy.delete(); val _ = current.delete() }
    }

    "fall back to the branded image when the label has no preview of any generation" in {
      val result = Future.successful(controller.serveLegacyOrFallbackImage(labelId))
      status(result) mustBe OK
      val img = ImageIO.read(new ByteArrayInputStream(contentAsBytes(result).toArray))
      img.getWidth mustBe 1440
      img.getHeight mustBe 960
    }
  }

  "buildFallbackImage" should {
    "write a branded fallback at exactly the advertised share dimensions" in {
      val controller = app.injector.instanceOf[ShareController]
      val tmp        = new File(System.getProperty("java.io.tmpdir"), s"share-fallback-spec-${System.nanoTime()}.jpg")
      try {
        controller.buildFallbackImage(tmp)
        assert(tmp.exists(), "fallback image file was not written (is public/images/sidewalk-logo.png present?)")
        val img = ImageIO.read(tmp)
        img.getWidth mustBe 1440
        img.getHeight mustBe 960
      } finally { val _ = tmp.delete() }
    }
  }
}
