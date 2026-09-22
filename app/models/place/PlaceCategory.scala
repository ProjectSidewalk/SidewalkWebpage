package models.place

/**
 * One OpenStreetMap tag test: the key, and the values of it that match.
 *
 * @param key    The OSM tag key, e.g. `amenity`.
 * @param values The values that put an object in the category, e.g. `school`, `kindergarten`.
 */
final case class OsmTagRule(key: String, values: Set[String]) {

  /** @return Whether an object with these tags satisfies the rule. */
  def matches(tags: Map[String, String]): Boolean = tags.get(key).exists(values.contains)

  /** @return The rule as an Overpass selector: `[key=value]` for one value, a regex for several. */
  def overpassSelector: String =
    if (values.size == 1) s"[$key=${values.head}]" else s"""[$key~"^(${values.toSeq.sorted.mkString("|")})$$"]"""
}

/**
 * One kind of place the AccessScore map shows (#5311), and the OSM tags that put an object in it.
 *
 * @param id    The category id, as the `place.category` column, the API, and the tool's URL spell it.
 * @param rules The tag tests, any of which qualifies an object.
 */
final case class PlaceCategory(id: String, rules: Seq[OsmTagRule]) {

  /** @return Whether an object with these tags belongs to the category. */
  def matches(tags: Map[String, String]): Boolean = rules.exists(_.matches(tags))
}

/**
 * The catalog of place categories (#5311): the one source for the `place.category` CHECK (PlaceTableSpec holds the
 * evolution to it), the Overpass query the refresh sends, the tag resolver that files each fetched object, the
 * `category` allowlist on `/v3/api/places`, and the `place_categories` list `/v3/api/accessScoreConfig` publishes
 * so the AccessScore tool never re-declares it.
 *
 * The choice of tags, from Jon's QA of the tool (2026-09-11) and a count over Seattle's OSM: schools carry every
 * level, since a kindergarten and a university both draw daily foot traffic; health includes pharmacies, which are the
 * errand people with mobility impairments make most often; grocery leaves out convenience stores, most of which are
 * not food access; transit is dominated by bus stops (half of all places in Seattle), which is why it is its own
 * toggle; parks include playgrounds, which are otherwise mostly unnamed points inside them; community centers and
 * social facilities cover senior centers, which OSM files under either.
 *
 * Order matters twice: it is the order the tool lists categories in, and the first category whose rule an object
 * satisfies wins, so a school that also sells groceries is a school.
 */
object PlaceCategory {
  val School: PlaceCategory =
    PlaceCategory("school", Seq(OsmTagRule("amenity", Set("school", "kindergarten", "college", "university"))))
  val Health: PlaceCategory =
    PlaceCategory("health", Seq(OsmTagRule("amenity", Set("hospital", "clinic", "doctors", "pharmacy"))))
  val Library: PlaceCategory = PlaceCategory("library", Seq(OsmTagRule("amenity", Set("library"))))
  val Grocery: PlaceCategory = PlaceCategory("grocery", Seq(OsmTagRule("shop", Set("supermarket", "greengrocer"))))
  val Transit: PlaceCategory = PlaceCategory(
    "transit",
    Seq(
      OsmTagRule("highway", Set("bus_stop")),
      OsmTagRule("railway", Set("station", "tram_stop", "halt")),
      OsmTagRule("public_transport", Set("station")),
      OsmTagRule("amenity", Set("bus_station", "ferry_terminal"))
    )
  )
  val Park: PlaceCategory      = PlaceCategory("park", Seq(OsmTagRule("leisure", Set("park", "playground"))))
  val Community: PlaceCategory =
    PlaceCategory("community", Seq(OsmTagRule("amenity", Set("community_centre", "social_facility"))))

  /** Every category, in display and precedence order. */
  val all: Seq[PlaceCategory] = Seq(School, Health, Library, Grocery, Transit, Park, Community)

  /** The category ids, in display order. */
  val ids: Seq[String] = all.map(_.id)

  /** The ids as a set, for allowlisting a query parameter. */
  val idSet: Set[String] = ids.toSet

  /** @return The category with this id, if any. */
  def byId(id: String): Option[PlaceCategory] = all.find(_.id == id)

  /**
   * Files an OSM object under the first category, in catalog order, whose rule its tags satisfy.
   *
   * @param tags The object's tag map.
   * @return     Its category, or None when no rule matches (an object Overpass returned for a tag the catalog no
   *             longer lists, which the refresh drops).
   */
  def resolve(tags: Map[String, String]): Option[PlaceCategory] = all.find(_.matches(tags))

  /** Every rule's Overpass selector, in catalog order, for the union query the refresh sends. */
  val overpassSelectors: Seq[String] = all.flatMap(_.rules).map(_.overpassSelector)
}
