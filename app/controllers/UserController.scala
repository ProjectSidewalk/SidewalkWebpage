package controllers

import controllers.base._
import controllers.helper.ControllerUtils
import controllers.helper.ControllerUtils.{parseURL, safeLocalPath}
import forms._
import models.auth.DefaultEnv
import models.user.{Role, SidewalkUserWithRole, UserUtm}
import models.utils.ProfanityGuard
import net.ceedubs.ficus.Ficus._
import play.api.i18n.Messages
import play.api.libs.json.{JsError, JsObject, JsString, Json}
import play.api.libs.mailer.{Email, MailerClient}
import play.api.{Configuration, Logger}
import play.silhouette.api.Authenticator.Implicits._
import play.silhouette.api._
import play.silhouette.api.exceptions.ProviderException
import play.silhouette.api.util.{Clock, PasswordHasher}
import play.silhouette.impl.exceptions.IdentityNotFoundException
import play.silhouette.impl.providers.CredentialsProvider

import java.util.UUID
import javax.inject._
import scala.concurrent.duration.FiniteDuration
import scala.concurrent.{ExecutionContext, Future}
import scala.util.Random

@Singleton
class UserController @Inject() (
    cc: CustomControllerComponents,
    config: Configuration,
    val silhouette: Silhouette[DefaultEnv],
    configService: service.ConfigService,
    authenticationService: service.AuthenticationService,
    userService: service.UserService,
    passwordHasher: PasswordHasher,
    clock: Clock,
    mailerClient: MailerClient,
    rateLimiter: service.RateLimiter
)(implicit ec: ExecutionContext, assets: AssetsFinder)
    extends CustomBaseController(cc) {
  implicit val implicitConfig: Configuration = config
  private val logger                         = Logger(this.getClass)

  /**
   * True when the auth dialog submitted via fetch and wants JSON back instead of a redirect/page.
   */
  private def wantsJson(implicit request: play.api.mvc.RequestHeader): Boolean =
    request.headers.get("X-Requested-With").contains("XMLHttpRequest")

  /**
   * Maps form binding errors to the async error contract: `{"errors": {field -> localized message}}`.
   *
   * Form-level (global) errors, like a password mismatch, land under the `_summary` key that the dialog renders as
   * its top banner.
   */
  private def formErrorsJson(formWithErrors: play.api.data.Form[_])(implicit messages: Messages): JsObject = {
    val fields = formWithErrors.errors.groupBy(_.key).toSeq.map { case (key, errs) =>
      (if (key.isEmpty) "_summary" else key) -> JsString(Messages(errs.head.message, errs.head.args: _*))
    }
    Json.obj("errors" -> JsObject(fields))
  }

  /**
   * The async error contract for a single field: `{"errors": {field -> localized message}}`.
   */
  private def fieldErrorJson(field: String, message: String): JsObject =
    Json.obj("errors" -> Json.obj(field -> message))

  /**
   * Counts this attempt against a named rate limit's keys; if any is exceeded, returns a ready 429, else `None`.
   *
   * On by default via `rate-limit.enabled` (see `RateLimiter`). Every key is counted (so IP- and email-scoped limits
   * both register the attempt) before deciding. Suits the endpoints whose cost is the request itself — a bcrypt hash,
   * a mailer send — where a legitimate caller has to pay too; `failureThrottled` covers the ones that should only
   * charge for failures.
   *
   * @param name     The `rate-limit.<name>` block to read the max/window from.
   * @param keys     The keys to count this attempt against (e.g. IP and email scopes).
   * @param redirect Where the no-JS fallback should bounce to when throttled.
   * @return `Some(result)` if throttled, `None` if the attempt is allowed.
   */
  private def rateLimited(name: String, keys: Seq[String], redirect: String)(implicit
      request: play.api.mvc.RequestHeader
  ): Option[play.api.mvc.Result] = {
    val limit       = rateLimiter.limit(name)
    val blockedKeys = keys.filterNot(k => rateLimiter.allow(k, limit))
    if (blockedKeys.isEmpty) None else Some(throttledResponse(blockedKeys, limit, redirect))
  }

  /**
   * Reports whether `key` has already spent a named limit's budget, without counting the current attempt.
   *
   * The caller is expected to charge the budget itself — via `rateLimiter.record`/`clear` — once it knows the outcome.
   * That is what keeps a per-account sign-in throttle from being tripped by *successful* logins, which would lock out
   * a shared classroom account and would leave the counter running after the right password finally arrived.
   *
   * @param name     The `rate-limit.<name>` block to read the max/window from.
   * @param key      The single key whose budget to inspect.
   * @param redirect Where the no-JS fallback should bounce to when throttled.
   * @return `Some(result)` if already over budget, `None` if there is room.
   */
  private def failureThrottled(name: String, key: String, redirect: String)(implicit
      request: play.api.mvc.RequestHeader
  ): Option[play.api.mvc.Result] = {
    val limit = rateLimiter.limit(name)
    if (rateLimiter.isBlocked(key, limit)) Some(throttledResponse(Seq(key), limit, redirect)) else None
  }

  /**
   * The throttle response: JSON for async submits, a flashed redirect for the no-JS fallback, so both surfaces show
   * the same message.
   *
   * @param blockedKeys The tripped keys, whose windows set the honest `Retry-After`.
   * @param limit       The limit they tripped; its window is the fallback when a key has no live window.
   * @param redirect    Where the no-JS fallback should bounce to.
   */
  private def throttledResponse(blockedKeys: Seq[String], limit: service.RateLimiter.Limit, redirect: String)(implicit
      request: play.api.mvc.RequestHeader
  ): play.api.mvc.Result = {
    // Quote the longest wait among the tripped scopes, from when its window actually clears (#4740).
    val retryAfter = blockedKeys.flatMap(rateLimiter.retryAfterSeconds).reduceOption(_ max _)
    val msg        = Messages("authenticate.error.too.many")
    val result     =
      if (wantsJson) TooManyRequests(fieldErrorJson("_summary", msg))
      else Redirect(redirect).flashing("error" -> msg)
    result.withHeaders("Retry-After" -> retryAfter.getOrElse(limit.window.toSeconds).toString)
  }

  /**
   * Handles the Sign In action.
   */
  def signIn() = silhouette.UserAwareAction.async { implicit request =>
    if (request.identity.isEmpty || request.identity.get.role == Role.Anonymous) {
      configService.getCommonPageData(request2Messages.lang).map { commonData =>
        cc.loggingService.insert(request.identity.map(_.userId), request.ipAddress, "Visit_SignIn")
        Ok(views.html.authentication.signIn(SignInForm.form, commonData, request.identity))
      }
    } else Future.successful(Redirect("/"))
  }

  /**
   * Permanent redirect for the retired mobile sign-in page: the responsive /signIn serves all devices (#4884).
   *
   * The query string (e.g. the `url` return-to parameter) is carried over so old bookmarks and links keep working.
   */
  def signInMobile() = Action { request =>
    Redirect(routes.UserController.signIn().url, request.queryString, MOVED_PERMANENTLY)
  }

  /**
   * Handles the sign-up action.
   */
  def signUp() = silhouette.UserAwareAction.async { implicit request =>
    if (request.identity.isEmpty || request.identity.get.role == Role.Anonymous) {
      configService.getCommonPageData(request2Messages.lang).map { commonData =>
        cc.loggingService.insert(request.identity.map(_.userId), request.ipAddress, "Visit_SignUp")
        Ok(views.html.authentication.signUp(SignUpForm.form, commonData, request.identity))
      }
    } else Future.successful(Redirect("/"))
  }

  /**
   * Permanent redirect for the retired mobile sign-up page: the responsive /signUp serves all devices (#4884).
   *
   * The query string (e.g. the `url` return-to parameter) is carried over so old bookmarks and links keep working.
   */
  def signUpMobile() = Action { request =>
    Redirect(routes.UserController.signUp().url, request.queryString, MOVED_PERMANENTLY)
  }

  /**
   * Handles the sign-out action.
   */
  def signOut(url: String) = cc.securityService.SecuredAction { implicit request =>
    cc.loggingService.insert(request.identity.userId, request.ipAddress, "SignOut")
    silhouette.env.eventBus.publish(LogoutEvent(request.identity, request))
    silhouette.env.authenticatorService.discard(request.authenticator, Redirect(url))
  }

  /**
   * Handles the 'forgot password' action
   */
  def forgotPassword(url: String) = silhouette.UserAwareAction.async { implicit request =>
    if (request.identity.isEmpty || request.identity.get.role == Role.Anonymous) {
      configService.getCommonPageData(request2Messages.lang).map { commonData =>
        cc.loggingService.insert(request.identity.map(_.userId), request.ipAddress, "Visit_ForgotPassword")
        Ok(views.html.authentication.forgotPassword(ForgotPasswordForm.form, commonData))
      }
    } else Future.successful(Redirect(url))
  }

  /**
   * Get the reset password page.
   */
  def resetPasswordPage(token: String) = silhouette.UserAwareAction.async { implicit request =>
    authenticationService.validateToken(token).flatMap {
      case Some(_) =>
        configService.getCommonPageData(request2Messages.lang).map { commonData =>
          cc.loggingService.insert(request.identity.map(_.userId), request.ipAddress, "Visit_ResetPassword")
          Ok(views.html.authentication.resetPassword(ResetPasswordForm.form, commonData, token))
        }
      case None =>
        Future.successful(
          Redirect(routes.UserController.signIn()).flashing("error" -> Messages("reset.pw.invalid.reset.link"))
        )
    }
  }

  // Post function that receives a String and saves it into WebpageActivityTable with userId, ipAddress, timestamp.
  // User-aware (#4643): public pages log page-view/interaction beacons through this for cookie-less visitors too;
  // a missing identity is logged under the shared default anonymous user inside LoggingService.
  def logWebpageActivity() = cc.securityService.UserAwareAction(parse.json) { implicit request =>
    request.body
      .validate[String]
      .fold(
        errors => { Future.successful(BadRequest(Json.obj("status" -> "Error", "message" -> JsError.toJson(errors)))) },
        submission => {
          cc.loggingService.insert(request.identity.map(_.userId), request.ipAddress, submission)
          Future.successful(Ok(Json.obj()))
        }
      )
  }

  /**
   * Turns the signed-in user's service-hour tracking on or off, then returns to a same-origin page.
   *
   * Powers the one-click opt-in on `/welcome` and the toggle on `/serviceHoursInstructions` (both plain form POSTs so
   * they work without JS). Anonymous users can't opt in — they're sent to sign-up instead.
   *
   * @param enabled Whether to enable (true) or disable (false) `user_role.community_service`.
   * @param next    Same-origin path to return to; defaults to (and is constrained to) `/serviceHoursInstructions`.
   */
  def setServiceHours(enabled: Boolean, next: Option[String]) =
    cc.securityService.SecuredAction { implicit request =>
      val target = safeLocalPath(next.getOrElse("/serviceHoursInstructions"), "/serviceHoursInstructions")
      if (request.identity.role == Role.Anonymous) Future.successful(Redirect(routes.UserController.signUp()))
      else
        authenticationService.setCommunityServiceStatus(request.identity.userId, enabled).map { _ =>
          cc.loggingService.insert(request.identity.userId, request.ipAddress, s"ServiceHours_Set=$enabled")
          Redirect(target)
        }
    }

  /**
   * Authenticates a user.
   */
  def authenticate() = silhouette.UserAwareAction.async { implicit request =>
    val ipAddress: String          = request.ipAddress
    val currUserId: Option[String] = request.identity.map(_.userId)

    // Two per-IP bounds, both before any work happens. The per-minute one caps how *fast* one address can drive the
    // bcrypt path while staying generous enough for a classroom behind a single NAT; the per-hour one caps how *many*
    // accounts it can work through in a sitting, which is credential stuffing — a shape the per-account limit below is
    // blind to, since every guess there targets a different account. Both are evaluated rather than short-circuited so
    // that each records the attempt.
    val burstLimited     = rateLimited("login", Seq(s"login:ip:$ipAddress"), "/signIn")
    val sustainedLimited = rateLimited("login-ip-hourly", Seq(s"login:ip:hour:$ipAddress"), "/signIn")
    burstLimited.orElse(sustainedLimited).map(Future.successful).getOrElse {
      SignInForm.form
        .bindFromRequest()
        .fold(
          formWithErrors => {
            if (wantsJson) Future.successful(BadRequest(formErrorsJson(formWithErrors)))
            else {
              configService
                .getCommonPageData(request2Messages.lang)
                .map(commonData => {
                  BadRequest(views.html.authentication.signIn(formWithErrors, commonData, request.identity))
                })
            }
          },
          data => {
            // A user may sign in with either their email or their username (#4375). A username is resolved to its
            // email below; an unrecognized identifier passes through unchanged so authentication fails with the same
            // generic "email and password don't match" error — no account-enumeration signal.
            val identifier: String = data.email.trim

            // Per-account throttle keyed on the submitted email-or-username, which only exists after form binding.
            // This is the actual brute-force backstop (#1102): the per-IP bounds above stay generous for classrooms
            // behind one NAT, so a targeted account needs its own, tighter limit. Keyed case-insensitively and
            // length-capped so a flood of giant identifiers can't bloat the limiter's key set.
            //
            // Only *failed* attempts are charged (recorded in the ProviderException branch below, refunded on
            // success): a budget that counted successes too would lock a shared classroom account out of its own
            // logins, and would leave the counter running even after the right password arrived. The remaining
            // tradeoff is deliberate — someone who knows a username can still deny it to its owner for one window by
            // spending the budget on bad guesses, which is inherent to any per-account limit and is bounded by that
            // window. One residual: the key is the submitted string, so an account reachable by both username and
            // email has a bucket for each. Collapsing them would mean a DB lookup before the throttle, i.e. doing the
            // work the throttle exists to avoid.
            val idKey   = s"login:id:${identifier.toLowerCase.take(255)}"
            val idLimit = rateLimiter.limit("login-identifier")

            failureThrottled("login-identifier", idKey, "/signIn") match {
              case Some(throttledResult) =>
                cc.loggingService.insert(currUserId, ipAddress, s"""SignInThrottled_Email="$identifier"""")
                Future.successful(throttledResult)

              case None =>
                cc.loggingService.insert(currUserId, ipAddress, s"""SignInAttempt_Email="$identifier"""")

                // Grab the URL we want to redirect to that was passed as a hidden field in the form.
                val returnUrl = request.body.asFormUrlEncoded
                  .flatMap(_.get("returnUrl"))
                  .flatMap(_.headOption)
                  .getOrElse("/") // Default redirect path if no returnUrl.
                val (returnUrlPath, returnUrlQuery) = parseURL(returnUrl)
                // Constrain to a same-origin path so a crafted returnUrl can't open-redirect a signed-in user
                // off-site. Async submits get the destination as JSON (the dialog navigates itself); the
                // authenticator cookie is embedded into whichever result we hand Silhouette below.
                val redirectTarget = safeLocalPath(returnUrl)
                val result = if (wantsJson) Ok(Json.obj("redirect" -> redirectTarget)) else Redirect(redirectTarget)

                // Resolve the identifier to an email: pass an email through as-is; look a username up to its email;
                // and fall back to the identifier unchanged when it matches nothing, so auth fails with the generic
                // error.
                val emailFut: Future[String] =
                  if (identifier.contains("@")) Future.successful(identifier.toLowerCase)
                  else
                    authenticationService
                      .findByUsername(identifier)
                      .map(_.map(_.email).getOrElse(identifier.toLowerCase))

                // Try to authenticate the user.
                emailFut.flatMap { email =>
                  authenticationService
                    .authenticate(email, data.password)
                    .flatMap { loginInfo =>
                      authenticationService.retrieve(loginInfo).flatMap {
                        case Some(user) =>
                          // Correct credentials: refund the account's budget so a run of typos doesn't follow the
                          // user into their next session.
                          rateLimiter.clear(idKey)
                          val c = config.underlying
                          silhouette.env.authenticatorService
                            .create(loginInfo)
                            .map {
                              case authenticator if data.rememberMe =>
                                // Set up the remember me cookie.
                                authenticator.copy(
                                  expirationDateTime = clock.now + c
                                    .as[FiniteDuration]("silhouette.authenticator.rememberMe.authenticatorExpiry"),
                                  idleTimeout = c.getAs[FiniteDuration](
                                    "silhouette.authenticator.rememberMe.authenticatorIdleTimeout"
                                  ),
                                  cookieMaxAge =
                                    c.getAs[FiniteDuration]("silhouette.authenticator.rememberMe.cookieMaxAge")
                                )
                              case authenticator => authenticator
                            }
                            .flatMap { authenticator =>
                              // Log successful sign in attempt.
                              val activity: String = s"""SignInSuccess_Email="${user.email}""""
                              cc.loggingService.insert(user.userId, ipAddress, activity)

                              // Sign in the user.
                              silhouette.env.eventBus.publish(LoginEvent(user, request))
                              silhouette.env.authenticatorService.init(authenticator).flatMap { v =>
                                silhouette.env.authenticatorService.embed(v, result)
                              }
                            }
                        case None =>
                          // Log failed sign-in due to a database issue.
                          val activity: String = s"""SignInFailed_Email="$email"_Reason="user not found in db""""
                          cc.loggingService.insert(currUserId, ipAddress, activity)
                          Future.failed(new IdentityNotFoundException("Couldn't find the user in db"))
                      }
                    }
                    .recover {
                      case e: ProviderException =>
                        // A rejected credential is exactly what the per-account budget is for, so charge it here and
                        // nowhere else. The generic branch below deliberately doesn't: an outage on our side must not
                        // spend a real user's budget.
                        rateLimiter.record(idKey, idLimit)

                        // Log failed sign-in due to invalid credentials. Should be the only reason for a failure.
                        val activity: String = s"""SignInFailed_Email="$email"_Reason="invalid credentials""""
                        cc.loggingService.insert(currUserId, ipAddress, activity)

                        if (wantsJson)
                          Unauthorized(
                            fieldErrorJson("_summary", Messages("authenticate.error.invalid.credentials.detail"))
                          )
                        else
                          Redirect("/signIn", returnUrlQuery + ("url" -> Seq(returnUrlPath)))
                            .flashing("error" -> Messages("authenticate.error.invalid.credentials"))
                      case e: Exception =>
                        val activity: String = s"""SignInFailed_Email="$email"_Reason="unexpected""""
                        cc.loggingService.insert(currUserId, ipAddress, activity)

                        if (wantsJson)
                          InternalServerError(fieldErrorJson("_summary", Messages("authenticate.error.generic")))
                        else
                          Redirect("/signIn", returnUrlQuery + ("url" -> Seq(returnUrlPath)))
                            .flashing("error" -> "Unexpected error")
                    }
                }
            }
          }
        )
    }
  }

  /**
   * Registers a new user.
   */
  def signUpPost() = silhouette.UserAwareAction.async { implicit request =>
    val ipAddress: String         = request.ipAddress
    val oldUserId: Option[String] = request.identity.map(_.userId)

    // Grab the URL we want to redirect to that was passed as a hidden field in the form.
    val returnUrl: String = request.body.asFormUrlEncoded
      .flatMap(_.get("returnUrl"))
      .flatMap(_.headOption)
      .getOrElse("/") // Default redirect path if no returnUrl.
    val (returnUrlPath, returnUrlQuery) = parseURL(returnUrl)

    // Per-IP throttle on account creation, checked pre-bind so rejected POSTs count too — each one still costs a form
    // bind and, past it, a bcrypt hash.
    rateLimited("signup", Seq(s"signup:ip:$ipAddress"), "/signUp").map(Future.successful).getOrElse {
      SignUpForm.form
        .bindFromRequest()
        .fold(
          formWithErrors => {
            // Errors determined by the form validation in SignUpForm.scala show up here.
            if (wantsJson) Future.successful(BadRequest(formErrorsJson(formWithErrors)))
            else
              Future.successful(
                Redirect("/signUp", returnUrlQuery + ("url" -> Seq(returnUrlPath)))
                  .flashing(
                    "error" -> Messages(formWithErrors.errors.headOption.map(_.message).getOrElse("unknown.error"))
                  )
              )
          },
          data => {
            val email: String = data.email.toLowerCase

            // Every new registration lands on /welcome, which hands the interrupted page back via ?next=.
            // safeLocalPath constrains returnUrl to a same-origin path (open-redirect guard).
            val resumeUrl: String   = safeLocalPath(returnUrl)
            val redirectUrl: String = s"/welcome?next=${java.net.URLEncoder.encode(resumeUrl, "UTF-8")}"
            val result              = if (wantsJson) Ok(Json.obj("redirect" -> redirectUrl)) else Redirect(redirectUrl)

            /** One rejection shape for both submit modes: JSON for the dialog, flash-redirect for the no-JS pages. */
            def rejection(logLabel: String, field: String, message: String, status: Status = BadRequest) = {
              cc.loggingService.insert(oldUserId, ipAddress, logLabel)
              if (wantsJson) Future.successful(status(fieldErrorJson(field, message)))
              else
                Future.successful(
                  Redirect("/signUp", returnUrlQuery + ("url" -> Seq(returnUrlPath))).flashing("error" -> message)
                )
            }

            (for {
              userFromEmail: Option[SidewalkUserWithRole]    <- authenticationService.findByEmail(email)
              userFromUsername: Option[SidewalkUserWithRole] <- authenticationService.findByUsername(data.username)
            } yield {
              // Cheap, pure moderation check first; then uniqueness. "user.exists" is overriding a Play default key.
              if (!ProfanityGuard.isClean(data.username)) {
                rejection(
                  "Inappropriate_Username_Error",
                  "username",
                  Messages("authenticate.error.username.inappropriate")
                )
              } else if (userFromEmail.isDefined) {
                rejection("Duplicate_Email_Error", "email", Messages("user.exists"), Conflict)
              } else if (userFromUsername.isDefined) {
                rejection(
                  "Duplicate_Username_Error",
                  "username",
                  Messages("authenticate.error.username.exists"),
                  Conflict
                )
              } else {
                // If username and email are unique, create the new user.
                val loginInfo         = LoginInfo(CredentialsProvider.ID, email)
                val newUserId: String = oldUserId.getOrElse(UUID.randomUUID().toString)
                val newUser           =
                  SidewalkUserWithRole(newUserId, data.username, email, Role.Registered, communityService = false,
                    false)
                val pwInfo = passwordHasher.hash(data.password)

                for {
                  user          <- authenticationService.createUser(newUser, CredentialsProvider.ID, pwInfo, oldUserId)
                  authenticator <- silhouette.env.authenticatorService.create(loginInfo)
                  value         <- silhouette.env.authenticatorService.init(authenticator)
                  result        <- silhouette.env.authenticatorService.embed(value, result)
                } yield {
                  // Log the sign-up/in.
                  cc.loggingService.insert(user.userId, ipAddress, "SignUp")
                  cc.loggingService.insert(user.userId, ipAddress, "SignIn")

                  silhouette.env.eventBus.publish(SignUpEvent(user, request))
                  silhouette.env.eventBus.publish(LoginEvent(user, request))
                  result
                }
              }
            }).flatMap(identity) // Flatten the Future[Future[T]] to Future[T].
          }
        )
    }
  }

  /**
   * The post-registration welcome page: confirms the account and shows what it unlocks (#4375).
   *
   * Rendered only for signed-in, non-anonymous users so a stray hit (or an anonymous auto-signup) can't land here.
   *
   * @param next Same-origin path to resume via the "Keep exploring" CTA; defaults to /explore.
   */
  def welcome(next: Option[String]) = silhouette.UserAwareAction.async { implicit request =>
    request.identity match {
      case Some(user) if user.role != Role.Anonymous =>
        configService.getCommonPageData(request2Messages.lang).map { commonData =>
          cc.loggingService.insert(user.userId, request.ipAddress, "Visit_Welcome")
          val resumeUrl = safeLocalPath(next.getOrElse("/explore"), "/explore")
          // Landing on a generic entry point isn't an interruption worth naming; anything else is a page the user
          // was pulled out of mid-task, and the CTA should say so rather than read as "go start something new".
          val resumedPath = resumeUrl.takeWhile(_ != '?')
          val resumed     = resumedPath != "/" && resumedPath != "/explore"
          Ok(views.html.authentication.welcome(commonData, user, resumeUrl, resumed))
        }
      case _ => Future.successful(Redirect("/"))
    }
  }

  /**
   * If there is no user signed in, an anon user with randomly generated username/password is created.
   */
  def signUpAnon(url: String) = silhouette.UserAwareAction.async { implicit request =>
    val qString = request.queryString.-("url") // Query string to pass along; remove the url parameter.
    request.identity match {
      case Some(user) =>
        Future.successful(Redirect(url, qString))
      case None =>
        // Each anon sign-up costs a bcrypt hash and inserts across several tables, unauthenticated, so it needs its
        // own IP bound. Checked directly rather than via rateLimited(): that helper's no-JS branch redirects, and any
        // redirect from here can loop — every SecuredAction bounces cookie-less clients back to /anonSignUp
        // (CustomSecuredErrorHandler), so the throttle response must stay a plain 429.
        val anonKey   = s"anon-signup:ip:${request.ipAddress}"
        val anonLimit = rateLimiter.limit("anon-signup")
        if (!rateLimiter.allow(anonKey, anonLimit)) {
          val retryAfter = rateLimiter.retryAfterSeconds(anonKey).getOrElse(anonLimit.window.toSeconds)
          Future.successful(
            TooManyRequests(Messages("authenticate.error.too.many"))
              .withHeaders("Retry-After" -> retryAfter.toString)
          )
        } else signUpAnonUser(url, qString)
    }
  }

  /** Creates an anon user with a randomly generated username/password, signs them in, and redirects to `url`. */
  private def signUpAnonUser(url: String, qString: Map[String, Seq[String]])(implicit
      request: play.silhouette.api.actions.UserAwareRequest[DefaultEnv, play.api.mvc.AnyContent]
  ): Future[play.api.mvc.Result] = {
    val randomPassword: String = Random.alphanumeric take 16 mkString ""
    val pwInfo                 = passwordHasher.hash(randomPassword)

    for {
      newAnonUser: SidewalkUserWithRole <- authenticationService.generateUniqueAnonUser()
      loginInfo: LoginInfo = LoginInfo(CredentialsProvider.ID, newAnonUser.email)

      user          <- authenticationService.createUser(newAnonUser, loginInfo.providerID, pwInfo, oldUserId = None)
      authenticator <- silhouette.env.authenticatorService.create(loginInfo)
      value         <- silhouette.env.authenticatorService.init(authenticator)
      // Strip UTM params from redirect to avoid double-capture in index().
      qStringNoUtm = qString.filterNot { case (k, _) => k.startsWith("utm_") }
      result <- silhouette.env.authenticatorService.embed(value, Redirect(url, qStringNoUtm))

      // Save UTM parameters if present, awaiting the write so failures surface to the error handler (#4229). UTM
      // params are stripped from the redirect URL (above) to avoid double-capture when index() also checks for UTM
      // params on returning users.
      _ <- {
        if (ControllerUtils.hasUtmParams(qString)) {
          val flat = qString.map { case (k, v) => k -> v.mkString }
          userService.insertUserUtm(
            UserUtm(
              0, user.userId, flat.get("utm_source"), flat.get("utm_medium"), flat.get("utm_campaign"),
              flat.get("utm_content"), flat.get("utm_term"), configService.getCityId, java.time.OffsetDateTime.now
            )
          )
        } else Future.successful(())
      }
    } yield {
      // Log the anon sign-up along with url and query string of the page they came from.
      val activityStr =
        if (qString.isEmpty) s"""AnonAutoSignUp_url="$url""""
        else s"""AnonAutoSignUp_url="$url?${qString.map { case (k, v) => k + "=" + v.mkString }.mkString("&")}""""
      cc.loggingService.insert(user.userId, request.ipAddress, activityStr)

      silhouette.env.eventBus.publish(SignUpEvent(user, request))
      silhouette.env.eventBus.publish(LoginEvent(user, request))

      result
    }
  }

  /**
   * Sends an email with password reset instructions.
   *
   * It sends an email to the given address if it exists in the database. Otherwise we do not show the user
   * a notice for not existing email addresses to prevent the leak of existing email addresses.
   */
  def submitForgottenPassword = silhouette.UserAwareAction.async { implicit request =>
    val ipAddress: String      = request.ipAddress
    val userId: Option[String] = request.identity.map(_.userId)

    // Per-IP throttle on reset requests; the per-target-email one is post-bind, further down.
    rateLimited("forgot", Seq(s"forgot:ip:$ipAddress"), "/forgotPassword").map(Future.successful).getOrElse {

      ForgotPasswordForm.form
        .bindFromRequest()
        .fold(
          form =>
            configService.getCommonPageData(request2Messages.lang).map { commonData =>
              BadRequest(views.html.authentication.forgotPassword(form, commonData))
            },
          email => {
            // Per-target-email throttle (only possible after form binding) so one address can't be reset-mail bombed
            // from many IPs; the pre-bind check above bounds per-IP volume. Same block, disjoint key namespaces.
            rateLimited("forgot", Seq(s"forgot:email:${email.trim.toLowerCase.take(255)}"), "/forgotPassword")
              .map(Future.successful)
              .getOrElse(submitForgottenPasswordForEmail(email, userId, ipAddress))
          }
        )
    }
  }

  /** Emails password reset instructions to `email` if it belongs to an account, responding identically either way. */
  private def submitForgottenPasswordForEmail(email: String, userId: Option[String], ipAddress: String)(implicit
      request: play.silhouette.api.actions.UserAwareRequest[DefaultEnv, play.api.mvc.AnyContent]
  ): Future[play.api.mvc.Result] = {
    val result = Redirect(routes.UserController.forgotPassword())
      .flashing("info" -> Messages("reset.pw.email.reset.pw.sent"))
    cc.loggingService.insert(userId, ipAddress, s"""PasswordResetAttempt_Email="$email"""")

    authenticationService.findByEmail(email).flatMap {
      case Some(user) =>
        // User exists, create a new token and send an email with the reset link.
        authenticationService.createToken(user.userId).flatMap { authTokenID =>
          val url = routes.UserController.resetPasswordPage(authTokenID).absoluteURL()

          val resetEmail = Email(
            Messages("reset.pw.email.reset.title"),
            s"Project Sidewalk <${config.get[String]("noreply-email-address")}>",
            Seq(email),
            bodyHtml = Some(views.html.authentication.resetPasswordEmail(user, url).body)
          )

          try {
            mailerClient.send(resetEmail)
            cc.loggingService.insert(userId, ipAddress, s"""PasswordResetSuccess_Email="$email"""")
            Future.successful(result)
          } catch {
            case e: Exception =>
              cc.loggingService.insert(
                userId,
                ipAddress,
                s"""PasswordResetFail_Email="$email"_Reason=${e.getClass.getCanonicalName}"""
              )
              logger.error("Failed to send password reset email", e)
              // Show the same confirmation regardless: a mailer outage must not 500 the user, nor reveal
              // (via a differing response) that this email is registered. Delivery health is ops' concern.
              Future.successful(result)
          }
        }

      // This is the case where the email was not found in the database.
      case None =>
        cc.loggingService
          .insert(userId, ipAddress, s"""PasswordResetFail_Email="$email"_Reason=EmailNotFound""")
        Future.successful(result)
    }
  }

  /**
   * Resets the password.
   * @param token The token to identify a user.
   */
  def resetPassword(token: String) = silhouette.UserAwareAction.async { implicit request =>
    // Per-IP throttle before the token lookup and bcrypt hash; bounds reset-token guessing (#1102). Reset links point
    // at /resetPassword/:token (a GET page), so bouncing the no-JS fallback to /signIn is a safe, loop-free target.
    rateLimited("reset-password", Seq(s"reset-password:ip:${request.ipAddress}"), "/signIn")
      .map(Future.successful)
      .getOrElse(resetPasswordWithToken(token))
  }

  /** Validates the reset `token` and updates the account's password from the submitted form. */
  private def resetPasswordWithToken(token: String)(implicit
      request: play.silhouette.api.actions.UserAwareRequest[DefaultEnv, play.api.mvc.AnyContent]
  ): Future[play.api.mvc.Result] = {
    authenticationService.validateToken(token).flatMap {
      case Some(authToken) =>
        ResetPasswordForm.form
          .bindFromRequest()
          .fold(
            form =>
              configService.getCommonPageData(request2Messages.lang).map { commonData =>
                cc.loggingService.insert(request.identity.map(_.userId), request.ipAddress, "Visit_ResetPassword")
                BadRequest(views.html.authentication.resetPassword(form, commonData, token))
              },
            passwordData =>
              authenticationService.findByUserId(authToken.userID).flatMap {
                case Some(user) =>
                  val passwordInfo = passwordHasher.hash(passwordData.password)
                  authenticationService.updatePassword(user.userId, passwordInfo).map { _ =>
                    authenticationService.removeToken(token)
                    cc.loggingService.insert(user.userId, request.ipAddress, "PasswordReset")
                    Redirect(routes.UserController.signIn()).flashing("success" -> Messages("reset.pw.successful"))
                  }
                case _ =>
                  Future.successful(
                    Redirect(routes.UserController.signIn())
                      .flashing("error" -> Messages("reset.pw.invalid.reset.link"))
                  )
              }
          )
      case None =>
        Future.successful(
          Redirect(routes.UserController.signIn()).flashing("error" -> Messages("reset.pw.invalid.reset.link"))
        )
    }
  }
}
