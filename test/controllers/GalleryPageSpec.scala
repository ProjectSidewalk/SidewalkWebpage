package controllers

import org.scalatestplus.play.PlaySpec
import org.scalatestplus.play.guice.GuiceOneAppPerSuite
import play.api.Application
import play.api.inject.guice.GuiceApplicationBuilder
import play.api.libs.json.{JsObject, JsValue, Json}
import play.api.test.FakeRequest
import play.api.test.Helpers._
import util.UserAgents

import java.net.URLEncoder

/**
 * Locks the `tags` deep-link contract of GET /gallery: the selection a shared link carries has to come back on the
 * page, including for tag names that contain a comma (#4783).
 *
 * The filter is invisible when it breaks — an unrecognized tag is dropped rather than reported, so the page renders
 * a perfectly normal grid of unfiltered cards. That is how a comma-joined `tags` param hid the fact that it was
 * shredding "yellow box, accessibility features not visible" into two names that matched nothing.
 *
 * Also locks the review-list contract of `?labelIds=` (#5444): the page carries the list through in the order it was
 * given, and the card query behind it returns exactly those labels and names the ones it could not serve.
 *
 * Reads the tag vocabulary off the page itself rather than hardcoding one, since which tags exist depends on the
 * city the connected database holds.
 *
 * Requires a Postgres+PostGIS database (via DATABASE_URL / DATABASE_USER / DATABASE_PASSWORD env, as in dev/CI).
 */
class GalleryPageSpec extends PlaySpec with GuiceOneAppPerSuite {

  override def fakeApplication(): Application =
    new GuiceApplicationBuilder()
      .disable[modules.ActorModule] // No eager background actors during tests.
      .build()

  // Matches a whole tag-pill element so the active-class check doesn't depend on attribute order within the tag.
  // Twirl HTML-escapes ">" in attribute values, so [^>]* can't end the element early.
  private val tagPillElement = """<button\b[^>]*\bdata-tag="([^"]*)"[^>]*>""".r

  /** Fetches /gallery with the given query and returns its HTML. */
  private def galleryPage(query: String = ""): String = {
    val resp = route(app, FakeRequest(GET, s"/gallery$query")).get
    status(resp) mustBe OK
    contentAsString(resp)
  }

  private def renderedTags(body: String): Seq[String] =
    tagPillElement.findAllMatchIn(body).map(_.group(1)).distinct.toSeq
  private def activeTags(body: String): Set[String] =
    tagPillElement.findAllMatchIn(body).filter(_.matched.contains("tag-pill--active")).map(_.group(1)).toSet

  private def encode(tag: String): String = URLEncoder.encode(tag, "UTF-8")

  /** An id no city's `label` serial has reached, so a review list naming it is always short one label. */
  private val missingLabelId: Int = Int.MaxValue

  /** The `labelIds: [...]` array the page carries into its card query, as rendered. */
  private val renderedLabelIds                     = """labelIds: \[([^\]]*)\]""".r
  private def pageLabelIds(body: String): Seq[Int] =
    renderedLabelIds.findFirstMatchIn(body).map(_.group(1)).filter(_.nonEmpty).toSeq.flatMap(_.split(",").map(_.toInt))

  /** POSTs a card query and returns its JSON body. */
  private def labelsFor(request: JsObject): JsValue = {
    val resp = route(app, FakeRequest(POST, "/label/labels").withJsonBody(request)).get
    status(resp) mustBe OK
    contentAsJson(resp)
  }

  private def labelIdsIn(json: JsValue): Seq[Int] = (json \ "labelsOfType" \\ "label_id").map(_.as[Int]).toSeq

  "GET /gallery" should {
    "render with no tags selected by default" in {
      activeTags(galleryPage()) mustBe empty
    }

    "restore every tag a repeated tags parameter names" in {
      val tags = renderedTags(galleryPage()).take(2)
      assume(tags.size == 2, "connected database renders fewer than two tags")

      val query = tags.map(tag => s"tags=${encode(tag)}").mkString("?", "&", "")
      activeTags(galleryPage(query)) must contain allElementsOf tags
    }

    "restore a tag whose name contains a comma" in {
      val commaTag = renderedTags(galleryPage()).find(_.contains(","))
      assume(commaTag.isDefined, "connected database has no tag containing a comma")

      activeTags(galleryPage(s"?tags=${encode(commaTag.get)}")) must contain(commaTag.get)
    }

    "still restore a link written in the older comma-joined form" in {
      val tags = renderedTags(galleryPage()).filterNot(_.contains(",")).take(2)
      assume(tags.size == 2, "connected database renders fewer than two comma-free tags")

      activeTags(galleryPage(s"?tags=${encode(tags.mkString(","))}")) must contain allElementsOf tags
    }

    "drop a tag the city does not have, rather than failing the page" in {
      activeTags(galleryPage("?tags=definitely-not-a-real-tag")) mustBe empty
    }

    "filter by a regions parameter, and still by the older neighborhoods name" in {
      val regionIds = contentAsJson(route(app, FakeRequest(GET, "/regions")).get) \ "features" \\ "region_id"
      assume(regionIds.nonEmpty, "connected database has no regions")

      val regionId = regionIds.head.as[Int]
      galleryPage(s"?regions=$regionId") must include(s"regionIds: [$regionId]")
      galleryPage(s"?neighborhoods=$regionId") must include(s"regionIds: [$regionId]")
    }

    "carry a label list to the page in the order it was given, deduped" in {
      pageLabelIds(galleryPage("?labelIds=8,3,3,5")) mustBe Seq(8, 3, 5)
    }

    "drop a token of a label list that isn't an integer" in {
      pageLabelIds(galleryPage("?labelIds=7,x,7,8")) mustBe Seq(7, 8)
    }

    "leave the label list empty when the parameter is absent" in {
      pageLabelIds(galleryPage()) mustBe empty
    }

    // The list named the cards, so there is nothing left to filter and the grid takes the whole width. Rendering
    // the sidebar hidden instead would leave the grid three columns wide for no reason a reader could see.
    "render no sidebar at all in list mode, and the strip instead" in {
      val listPage = galleryPage("?labelIds=8,3")
      listPage must not include """class="sidebar""""
      listPage must not include """id="card-filter""""
      listPage must not include "gallery-filter-sections"
      listPage must include("gallery-list-bar")
      listPage must include("""id="gallery-list-count"""")
    }

    // A link, since it navigates; as a button it read as acting on the list. The arrow is decoration, not name.
    "offer the way out as a link rather than as a button" in {
      val listPage = galleryPage("?labelIds=8,3")
      listPage must include("""<a class="gallery-list-bar__browse-all" href="/gallery">""")
      listPage must include("""<span class="gallery-list-bar__arrow" aria-hidden="true">""")
      listPage must include("Browse all labels")
      listPage must not include "gallery-list-bar__show-all"
    }

    // /gallery?labelIds= is a sharing URL as much as a review queue, so the strip carries no heading and no
    // instructions about how to run a review pass.
    "leave the review hint and the mode heading off the list page" in {
      val listPage = galleryPage("?labelIds=8,3")
      listPage must not include "gallery:list-hint"
      listPage must not include "gallery:list-heading"
    }

    "still render the filter sidebar, and no strip, without a list" in {
      val filteredPage = galleryPage()
      filteredPage must include("""id="card-filter"""")
      filteredPage must include("gallery-filter-sections")
      filteredPage must not include "gallery-list-bar"
    }

    "cap a label list at MaxLabelIds rather than trusting its length" in {
      val ids = (1 to GalleryController.MaxLabelIds + 100).mkString(",")
      pageLabelIds(galleryPage(s"?labelIds=$ids")) must have size GalleryController.MaxLabelIds.toLong
    }

    "say how many ids the cap dropped, rather than silently serving a short list" in {
      val ids  = (1 to GalleryController.MaxLabelIds + 100).mkString(",")
      val page = galleryPage(s"?labelIds=$ids")
      page must include("""data-dropped="100"""")
      page must include(s"""data-max="${GalleryController.MaxLabelIds}"""")
      page must include(s"100 ids were past the ${GalleryController.MaxLabelIds}-id limit")
    }

    "say nothing about the cap for a list that fits under it" in {
      galleryPage("?labelIds=8,3") must not include "gallery-list-truncated"
    }

    // The server-rendered count is what a reviewer reads before the cards land, so its plural has to be right then
    // — i18next only takes over once the card query returns.
    "render the count with the plural the number calls for" in {
      galleryPage("?labelIds=8") must include(">1 label in this list<")
      galleryPage("?labelIds=8,3") must include(">2 labels in this list<")
    }

    // The client turns this into "N of M" once it knows how many came back, so M has to reach it without the
    // client re-parsing the URL the server already parsed.
    "carry the requested count to the client for the partial-count wording" in {
      galleryPage("?labelIds=8,3,5") must include("""data-requested="3"""")
    }

    "serve the page to a mobile visitor instead of redirecting to /mobileLanding" in {
      val resp = route(app, FakeRequest(GET, "/gallery").withHeaders(UserAgents.mobile)).get
      status(resp) mustBe OK
    }
  }

  /**
   * The review-list half of the card query (#5444). A list is explicit, so the contract is that every id asked for
   * either comes back as a card or is named as unavailable — a silently shorter grid would read as "these are all
   * the labels there were", which is exactly the wrong thing to tell someone building ground truth.
   */
  "POST /label/labels with a label list" should {
    // Ids the ordinary card query already served, so they are known to be renderable in the connected city. Every
    // correctness option is named because an empty set means "none of them", which serves nothing at all.
    val allValOptions          = Json.arr("correct", "incorrect", "unsure", "unvalidated")
    lazy val seedIds: Seq[Int] =
      labelIdsIn(labelsFor(Json.obj("n" -> 10, "loaded_labels" -> Json.arr(), "validation_options" -> allValOptions)))

    "return exactly the requested labels, in the requested order, ignoring the other filters" in {
      assume(seedIds.size >= 2, "connected database served fewer than two gallery labels")
      val requested = Seq(seedIds(1), seedIds.head, missingLabelId)

      val json = labelsFor(
        Json.obj(
          "n"             -> requested.size,
          "loaded_labels" -> Json.arr(),
          "label_ids"     -> requested,
          // Filters that between them match nothing: list mode has to ignore them rather than intersect with them.
          "label_types"        -> Json.arr("Signal"),
          "region_ids"         -> Json.arr(-1),
          "validation_options" -> Json.arr("incorrect")
        )
      )

      labelIdsIn(json) mustBe Seq(seedIds(1), seedIds.head)
      (json \ "unavailableLabelIds").as[Seq[Int]] mustBe Seq(missingLabelId)
    }

    "say nothing about unavailable ids when no list was asked for" in {
      val json = labelsFor(Json.obj("n" -> 1, "loaded_labels" -> Json.arr(), "validation_options" -> allValOptions))
      (json \ "unavailableLabelIds").toOption mustBe None
    }

    "report every id of a list that served nothing" in {
      val json = labelsFor(
        Json.obj("n" -> 1, "loaded_labels" -> Json.arr(), "label_ids" -> Json.arr(missingLabelId))
      )
      labelIdsIn(json) mustBe empty
      (json \ "unavailableLabelIds").as[Seq[Int]] mustBe Seq(missingLabelId)
    }
  }
}
