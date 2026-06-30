package models.utils

import com.google.inject.ImplementedBy
import models.user.{RoleTableDef, UserRoleTableDef}
import models.utils.MyPostgresProfile.api._
import play.api.db.slick.{DatabaseConfigProvider, HasDatabaseConfigProvider}
import slick.jdbc.GetResult

import java.time.OffsetDateTime
import javax.inject.{Inject, Singleton}

case class WebpageActivity(
    webpageActivityId: Int,
    userId: String,
    ipAddress: String,
    description: String,
    timestamp: OffsetDateTime
)

/** Analytics data types for the v3 API usage dashboard. */
case class ApiEndpointCount(endpoint: String, count: Long)
case class ApiDailyCount(date: String, count: Long)
case class ApiFormatCount(endpoint: String, format: String, count: Long)

/**
 * Source-split analytics rows: each count is tagged with `source` = "apiDocs" (the docs "Try it" widgets) or
 * "external" (everything else), so the dashboard can distinguish real external API adoption from our own docs traffic.
 */
case class ApiEndpointSourceCount(endpoint: String, source: String, count: Long)
case class ApiDailySourceCount(date: String, source: String, count: Long)
case class ApiFormatSourceCount(format: String, source: String, count: Long)
case class ApiSourceIpCount(source: String, uniqueIps: Long)

class WebpageActivityTableDef(tag: Tag) extends Table[WebpageActivity](tag, "webpage_activity") {
  def webpageActivityId: Rep[Int]    = column[Int]("webpage_activity_id", O.PrimaryKey, O.AutoInc)
  def userId: Rep[String]            = column[String]("user_id")
  def ipAddress: Rep[String]         = column[String]("ip_address")
  def activity: Rep[String]          = column[String]("activity")
  def timestamp: Rep[OffsetDateTime] = column[OffsetDateTime]("timestamp")

  def * = (webpageActivityId, userId, ipAddress, activity, timestamp) <> (
    (WebpageActivity.apply _).tupled,
    WebpageActivity.unapply
  )

//  def user: ForeignKeyQuery[UserTable, DBUser] =
//    foreignKey("webpage_activity_user_id_fkey", userId, TableQuery[UserTableDef])(_.userId)
}

@ImplementedBy(classOf[WebpageActivityTable])
trait WebpageActivityTableRepository {}

@Singleton
class WebpageActivityTable @Inject() (protected val dbConfigProvider: DatabaseConfigProvider)
    extends WebpageActivityTableRepository
    with HasDatabaseConfigProvider[MyPostgresProfile] {

  val activities = TableQuery[WebpageActivityTableDef]
  val userRoles  = TableQuery[UserRoleTableDef]
  val roles      = TableQuery[RoleTableDef]

  def insert(activity: WebpageActivity): DBIO[Int] = {
    (activities returning activities.map(_.webpageActivityId)) += activity
  }

  /**
   * Returns a list of signin counts, each element being a count of logins for a user.
   * @return DBIO[Seq[(userId: String, role: String, count: Int)]]
   */
  def getSignInCounts: DBIO[Seq[(String, String, Int)]] = {
    val signIns = for {
      _activity <- activities if _activity.activity like "SignIn%"
      _userRole <- userRoles if _activity.userId === _userRole.userId
      _role     <- roles if _userRole.roleId === _role.roleId
      if _role.role =!= "Anonymous"
    } yield (_userRole.userId, _role.role, _activity.webpageActivityId)

    // Count sign in counts by grouping by (user_id, role).
    signIns.groupBy(x => (x._1, x._2)).map { case ((uId, role), group) => (uId, role, group.length) }.result
  }

  /**
   * Get the time that each user signed up (if we have it logged).
   */
  def getSignUpTimes: DBIO[Seq[(String, Option[OffsetDateTime])]] = {
    activities
      .filter(_.activity inSet Seq("AnonAutoSignUp", "SignUp"))
      .groupBy(_.userId)
      .map { case (_userId, group) => (_userId, group.map(_.timestamp).max) }
      .result
  }

  /**
   * For each user, gets count of number of sign ins and the timestamp of their most recent sign-in.
   */
  def getSignInTimesAndCounts: DBIO[Seq[(String, (Int, Option[OffsetDateTime]))]] = {
    activities
      .filter(row => row.activity === "AnonAutoSignUp" || (row.activity like "SignIn%"))
      .groupBy(_.userId)
      .map { case (_userId, rows) => (_userId, (rows.length, rows.map(_.timestamp).max)) }
      .result
  }

  /**
   * Daily count of successful sign-in events, split by whether the signer is anonymous.
   *
   * Registered logins log `SignIn` / `SignInSuccess`; anonymous sessions log `AnonAutoSignUp`. Failed attempts
   * (`SignInAttempt`, `SignInFailed`) are excluded — they aren't sign-ins, and their activity strings embed the typed
   * email address. The anon flag is derived from the activity name, which already distinguishes the two cases, so no
   * role join is needed.
   *
   * @return DBIO[Seq[(day, isAnonymous, count)]] — `day` is the timestamp truncated to the day; sorted ascending.
   */
  def getSignInCountsByDate: DBIO[Seq[(OffsetDateTime, Boolean, Int)]] = {
    val successfulSignIns = Seq("SignIn", "SignInSuccess")
    activities
      .filter(a => (a.activity inSet successfulSignIns) || a.activity === "AnonAutoSignUp")
      .map(a => (a.timestamp.trunc("day"), a.activity === "AnonAutoSignUp", a.webpageActivityId))
      .groupBy(x => (x._1, x._2))
      .map { case ((day, isAnon), group) => (day, isAnon, group.length) }
      .sortBy(_._1)
      .result
  }

  /**
   * Daily count of distinct active users (anyone with logged webpage activity that day), split by anonymous vs not.
   *
   * "Active" is intentionally broad — any logged activity counts — so this measures how many people showed up, not how
   * much they did. Split on role "Anonymous" so registered engagement can be read separately from drive-by anon traffic.
   *
   * @return DBIO[Seq[(day, isAnonymous, distinctUserCount)]] — sorted ascending by day.
   */
  def getActiveUserCountsByDate: DBIO[Seq[(OffsetDateTime, Boolean, Int)]] = {
    val activeUsers = for {
      _activity <- activities
      _userRole <- userRoles if _activity.userId === _userRole.userId
      _role     <- roles if _userRole.roleId === _role.roleId
    } yield (_activity.timestamp.trunc("day"), _role.role === "Anonymous", _activity.userId)

    activeUsers
      .groupBy(x => (x._1, x._2))
      .map { case ((day, isAnon), group) => (day, isAnon, group.map(_._3).countDistinct) }
      .sortBy(_._1)
      .result
  }

  /**
   * Daily count of newly registered users, bucketed by their `SignUp` event.
   *
   * Only registered sign-ups count — anonymous `AnonAutoSignUp` events fire for every drive-by session and would swamp
   * the signal, so they're excluded; this is "new accounts per day".
   *
   * @return DBIO[Seq[(day, count)]] — sorted ascending by day.
   */
  def getNewUserCountsByDate: DBIO[Seq[(OffsetDateTime, Int)]] = {
    activities
      .filter(_.activity === "SignUp")
      .map(_.timestamp.trunc("day"))
      .groupBy(x => x)
      .map { case (day, group) => (day, group.length) }
      .sortBy(_._1)
      .result
  }

  /**
   * See if the user has previous logs for a specific activity.
   */
  def findUserActivity(activity: String, userId: String): DBIO[Seq[WebpageActivity]] = {
    activities.filter(a => a.userId === userId && a.activity === activity).result
  }

  /**
   * Returns per-endpoint call counts for v3 API requests.
   *
   * The `activity` column stores Play's `request.toString`, which is "METHOD /path?query", so filtering on
   * `'GET /v3/api/%'` catches all v3 API GETs. The endpoint is extracted by stripping the HTTP method and
   * any query string using `SPLIT_PART`.
   *
   * @param excludeApiDocs If true, excludes requests with `source=apiDocs` in the query string.
   * @param days           Number of past days to include (0 = no date filter / all time).
   * @return DBIO with a sequence of (endpoint, count) tuples, ordered by count descending.
   */
  def getApiEndpointCounts(excludeApiDocs: Boolean, days: Int): DBIO[Seq[ApiEndpointCount]] = {
    implicit val gr: GetResult[ApiEndpointCount] = GetResult(r => ApiEndpointCount(r.nextString(), r.nextLong()))
    val dateFilter    = if (days > 0) s"AND timestamp >= NOW() - INTERVAL '$days days'" else ""
    val apiDocsFilter = if (excludeApiDocs) "AND activity NOT LIKE '%source=apiDocs%'" else ""
    sql"""
      SELECT SPLIT_PART(SPLIT_PART(activity, ' ', 2), '?', 1) AS endpoint, COUNT(*) AS call_count
      FROM webpage_activity
      WHERE activity LIKE 'GET /v3/api/%'
        #$dateFilter
        #$apiDocsFilter
      GROUP BY endpoint
      ORDER BY call_count DESC
    """.as[ApiEndpointCount]
  }

  /**
   * Returns daily call counts for v3 API requests, ordered by date ascending.
   *
   * @param excludeApiDocs If true, excludes requests with `source=apiDocs` in the query string.
   * @param days           Number of past days to include (0 = all time).
   * @return DBIO with a sequence of (date string, count) tuples.
   */
  def getApiDailyCounts(excludeApiDocs: Boolean, days: Int): DBIO[Seq[ApiDailyCount]] = {
    implicit val gr: GetResult[ApiDailyCount] = GetResult(r => ApiDailyCount(r.nextString(), r.nextLong()))
    val dateFilter                            = if (days > 0) s"AND timestamp >= NOW() - INTERVAL '$days days'" else ""
    val apiDocsFilter                         = if (excludeApiDocs) "AND activity NOT LIKE '%source=apiDocs%'" else ""
    sql"""
      SELECT DATE(timestamp)::text AS date, COUNT(*) AS call_count
      FROM webpage_activity
      WHERE activity LIKE 'GET /v3/api/%'
        #$dateFilter
        #$apiDocsFilter
      GROUP BY date
      ORDER BY date ASC
    """.as[ApiDailyCount]
  }

  /**
   * Returns the count of distinct IP addresses that have made v3 API requests.
   *
   * @param excludeApiDocs If true, excludes requests with `source=apiDocs` in the query string.
   * @param days           Number of past days to include (0 = all time).
   * @return DBIO with the unique IP count.
   */
  def getApiUniqueIpCount(excludeApiDocs: Boolean, days: Int): DBIO[Long] = {
    val dateFilter    = if (days > 0) s"AND timestamp >= NOW() - INTERVAL '$days days'" else ""
    val apiDocsFilter = if (excludeApiDocs) "AND activity NOT LIKE '%source=apiDocs%'" else ""
    sql"""
      SELECT COUNT(DISTINCT ip_address)
      FROM webpage_activity
      WHERE activity LIKE 'GET /v3/api/%'
        #$dateFilter
        #$apiDocsFilter
    """.as[Long].head
  }

  /**
   * Returns per-endpoint, per-format call counts for v3 API requests.
   *
   * The `filetype` query parameter is extracted from the activity string; requests without a `filetype`
   * param are counted under `"json"` (the default output format for all v3 endpoints).
   *
   * @param excludeApiDocs If true, excludes requests with `source=apiDocs` in the query string.
   * @param days           Number of past days to include (0 = all time).
   * @return DBIO with a sequence of (endpoint, format, count) tuples.
   */
  def getApiFormatCounts(excludeApiDocs: Boolean, days: Int): DBIO[Seq[ApiFormatCount]] = {
    implicit val gr: GetResult[ApiFormatCount] =
      GetResult(r => ApiFormatCount(r.nextString(), r.nextString(), r.nextLong()))
    val dateFilter    = if (days > 0) s"AND timestamp >= NOW() - INTERVAL '$days days'" else ""
    val apiDocsFilter = if (excludeApiDocs) "AND activity NOT LIKE '%source=apiDocs%'" else ""
    sql"""
      SELECT
        SPLIT_PART(SPLIT_PART(activity, ' ', 2), '?', 1) AS endpoint,
        COALESCE((REGEXP_MATCH(activity, '[?&]filetype=([^&\s]+)'))[1], 'json') AS format,
        COUNT(*) AS call_count
      FROM webpage_activity
      WHERE activity LIKE 'GET /v3/api/%'
        #$dateFilter
        #$apiDocsFilter
      GROUP BY endpoint, format
      ORDER BY endpoint, call_count DESC
    """.as[ApiFormatCount]
  }

  /** SQL CASE that tags each v3 API request as docs-driven ("apiDocs") vs "external". */
  private val sourceCase = "CASE WHEN activity LIKE '%source=apiDocs%' THEN 'apiDocs' ELSE 'external' END"

  /**
   * Per-endpoint v3 API call counts split by source (external vs apiDocs).
   * @param days Number of past days to include (0 = all time).
   */
  def getApiEndpointCountsBySource(days: Int): DBIO[Seq[ApiEndpointSourceCount]] = {
    implicit val gr: GetResult[ApiEndpointSourceCount] =
      GetResult(r => ApiEndpointSourceCount(r.nextString(), r.nextString(), r.nextLong()))
    val dateFilter = if (days > 0) s"AND timestamp >= NOW() - INTERVAL '$days days'" else ""
    sql"""
      SELECT SPLIT_PART(SPLIT_PART(activity, ' ', 2), '?', 1) AS endpoint,
             #$sourceCase AS source,
             COUNT(*) AS call_count
      FROM webpage_activity
      WHERE activity LIKE 'GET /v3/api/%'
        #$dateFilter
      GROUP BY endpoint, source
      ORDER BY call_count DESC
    """.as[ApiEndpointSourceCount]
  }

  /**
   * Daily v3 API call counts split by source (external vs apiDocs), ordered by date ascending.
   * @param days Number of past days to include (0 = all time).
   */
  def getApiDailyCountsBySource(days: Int): DBIO[Seq[ApiDailySourceCount]] = {
    implicit val gr: GetResult[ApiDailySourceCount] =
      GetResult(r => ApiDailySourceCount(r.nextString(), r.nextString(), r.nextLong()))
    val dateFilter = if (days > 0) s"AND timestamp >= NOW() - INTERVAL '$days days'" else ""
    sql"""
      SELECT DATE(timestamp)::text AS date,
             #$sourceCase AS source,
             COUNT(*) AS call_count
      FROM webpage_activity
      WHERE activity LIKE 'GET /v3/api/%'
        #$dateFilter
      GROUP BY date, source
      ORDER BY date ASC
    """.as[ApiDailySourceCount]
  }

  /**
   * v3 API call counts by requested format (filetype, defaulting to json) split by source (external vs apiDocs).
   * @param days Number of past days to include (0 = all time).
   */
  def getApiFormatCountsBySource(days: Int): DBIO[Seq[ApiFormatSourceCount]] = {
    implicit val gr: GetResult[ApiFormatSourceCount] =
      GetResult(r => ApiFormatSourceCount(r.nextString(), r.nextString(), r.nextLong()))
    val dateFilter = if (days > 0) s"AND timestamp >= NOW() - INTERVAL '$days days'" else ""
    sql"""
      SELECT COALESCE((REGEXP_MATCH(activity, '[?&]filetype=([^&\s]+)'))[1], 'json') AS format,
             #$sourceCase AS source,
             COUNT(*) AS call_count
      FROM webpage_activity
      WHERE activity LIKE 'GET /v3/api/%'
        #$dateFilter
      GROUP BY format, source
      ORDER BY call_count DESC
    """.as[ApiFormatSourceCount]
  }

  /**
   * Distinct IP counts for v3 API requests split by source (external vs apiDocs). Note: per-source distinct counts
   * cannot be summed to a grand total (an IP may appear in both), so the dashboard's overall unique-IP figure comes
   * from getApiUniqueIpCount.
   * @param days Number of past days to include (0 = all time).
   */
  def getApiUniqueIpCountsBySource(days: Int): DBIO[Seq[ApiSourceIpCount]] = {
    implicit val gr: GetResult[ApiSourceIpCount] = GetResult(r => ApiSourceIpCount(r.nextString(), r.nextLong()))
    val dateFilter = if (days > 0) s"AND timestamp >= NOW() - INTERVAL '$days days'" else ""
    sql"""
      SELECT #$sourceCase AS source, COUNT(DISTINCT ip_address) AS ip_count
      FROM webpage_activity
      WHERE activity LIKE 'GET /v3/api/%'
        #$dateFilter
      GROUP BY source
    """.as[ApiSourceIpCount]
  }

  /**
   * The date of the most recent v3 API call across all time (window-independent). Lets the dashboard explain an empty
   * trend — "no calls in the last N days; the most recent was on ..." — and distinguish that from a never-used API.
   *
   * @return ISO date (`YYYY-MM-DD`) of the latest v3 API call, or `None` if the API has never been called.
   */
  def getLastApiCallDate: DBIO[Option[String]] = {
    sql"""
      SELECT MAX(DATE(timestamp))::text
      FROM webpage_activity
      WHERE activity LIKE 'GET /v3/api/%'
    """.as[Option[String]].head
  }
}
