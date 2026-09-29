package modules

import com.google.inject.name.Named
import com.google.inject.{AbstractModule, Provides}
import models.auth.{
  CustomSecuredErrorHandler,
  CustomUnsecuredErrorHandler,
  DefaultEnv,
  RevocableCookieAuthenticatorService
}
import net.codingwell.scalaguice.ScalaModule
import play.api.Configuration
import play.api.libs.ws.WSClient
import play.api.mvc.{Cookie, CookieHeaderEncoding}
import play.silhouette.api.actions.{SecuredErrorHandler, UnsecuredErrorHandler}
import play.silhouette.api.crypto.{Crypter, CrypterAuthenticatorEncoder, Signer}
import play.silhouette.api.repositories.AuthInfoRepository
import play.silhouette.api.services._
import play.silhouette.api.util._
import play.silhouette.api.{Environment, EventBus, Silhouette, SilhouetteProvider}
import play.silhouette.crypto._
import play.silhouette.impl.authenticators._
import play.silhouette.impl.providers.CredentialsProvider
import play.silhouette.impl.util._
import play.silhouette.password.{BCryptPasswordHasher, BCryptSha256PasswordHasher}
import play.silhouette.persistence.daos.{DelegableAuthInfoDAO, InMemoryAuthInfoDAO}
import play.silhouette.persistence.repositories.DelegableAuthInfoRepository
import service.{AuthenticationService, AuthenticationServiceImpl}

import scala.concurrent.ExecutionContext.Implicits.global
import scala.concurrent.duration.FiniteDuration

/**
 * The Guice module which wires all Silhouette dependencies. Based off of this example:
 * https://github.com/mohiva/play-silhouette-seed/blob/master/app/modules/SilhouetteModule.scala
 */
class SilhouetteModule extends AbstractModule with ScalaModule {

  /**
   * Configures the module.
   */
  override def configure(): Unit = {
    bind[Silhouette[DefaultEnv]].to[SilhouetteProvider[DefaultEnv]]
    bind[UnsecuredErrorHandler].to[CustomUnsecuredErrorHandler]
    bind[SecuredErrorHandler].to[CustomSecuredErrorHandler]
    bind[AuthenticationService].to[AuthenticationServiceImpl]
    bind[CacheLayer].to[PlayCacheLayer]
    bind[IDGenerator].toInstance(new SecureRandomIDGenerator())
    bind[PasswordHasher].toInstance(new BCryptPasswordHasher)
    bind[FingerprintGenerator].toInstance(new DefaultFingerprintGenerator(false))
    bind[EventBus].toInstance(EventBus())
    bind[Clock].toInstance(Clock())
    bind[DelegableAuthInfoDAO[PasswordInfo]].toInstance(new InMemoryAuthInfoDAO[PasswordInfo])
  }

  /**
   * Provides the HTTP layer implementation.
   *
   * @param client Play's WS client.
   * @return The HTTP layer implementation.
   */
  @Provides
  def provideHTTPLayer(client: WSClient): HTTPLayer = new PlayHTTPLayer(client)

  /**
   * Provides the Silhouette environment.
   * @param authenticationService The user service implementation.
   * @param authenticatorService The authentication service implementation.
   * @param eventBus The event bus instance.
   * @return The Silhouette environment.
   */
  @Provides
  def provideEnvironment(
      authenticationService: AuthenticationService,
      authenticatorService: AuthenticatorService[CookieAuthenticator],
      eventBus: EventBus
  ): Environment[DefaultEnv] = {
    Environment[DefaultEnv](authenticationService, authenticatorService, Seq(), eventBus)
  }

  /**
   * Provides the crypter for the authenticator.
   * @param configuration The Play configuration.
   * @return The crypter for the authenticator.
   */
  @Provides @Named("authenticator-crypter")
  def provideAuthenticatorCrypter(configuration: Configuration): Crypter = {
    new JcaCrypter(JcaCrypterSettings(configuration.get[String]("silhouette.authenticator.crypter.key")))
  }

  /**
   * Provides the authenticator service.
   * @param signer The signer implementation.
   * @param crypter The crypter implementation.
   * @param cookieHeaderEncoding Logic for encoding and decoding `Cookie` and `Set-Cookie` headers.
   * @param fingerprintGenerator The fingerprint generator implementation.
   * @param idGenerator The ID generator implementation.
   * @param configuration The Play configuration.
   * @param clock The clock instance.
   * @param authenticationService Looks up when an account's sessions were revoked.
   * @return The authenticator service.
   */
  @Provides
  def provideAuthenticatorService(
      @Named("authenticator-signer") signer: Signer,
      @Named("authenticator-crypter") crypter: Crypter,
      cookieHeaderEncoding: CookieHeaderEncoding,
      fingerprintGenerator: FingerprintGenerator,
      idGenerator: IDGenerator,
      configuration: Configuration,
      clock: Clock,
      authenticationService: AuthenticationService
  ): AuthenticatorService[CookieAuthenticator] = {
    // Every setting read here is required, so a misspelled key stops the app at startup.
    val c            = configuration.get[Configuration]("silhouette.authenticator")
    val sameSiteName = c.get[String]("sameSite")
    val sameSite     = Cookie.SameSite
      .parse(sameSiteName)
      .getOrElse(throw c.reportError("sameSite", s"Unknown sameSite value: $sameSiteName"))
    val config = CookieAuthenticatorSettings(
      cookieName = c.get[String]("cookieName"),
      cookiePath = c.get[String]("cookiePath"),
      cookieDomain = c.get[Option[String]]("cookieDomain"),
      secureCookie = c.get[Boolean]("secureCookie"),
      httpOnlyCookie = c.get[Boolean]("httpOnlyCookie"),
      sameSite = Some(sameSite),
      useFingerprinting = c.get[Boolean]("useFingerprinting"),
      cookieMaxAge = None, // A session cookie, unless the user ticks "remember me" (see UserController).
      authenticatorIdleTimeout = Some(c.get[FiniteDuration]("authenticatorIdleTimeout")),
      authenticatorExpiry = c.get[FiniteDuration]("authenticatorExpiry")
    )
    // RevocableCookieAuthenticatorService works out when a cookie was issued from this one lifetime.
    val rememberMeExpiry = c.get[FiniteDuration]("rememberMe.authenticatorExpiry")
    require(
      rememberMeExpiry == config.authenticatorExpiry,
      "silhouette.authenticator.authenticatorExpiry and rememberMe.authenticatorExpiry must be equal"
    )
    val encoder = new CrypterAuthenticatorEncoder(crypter)
    new RevocableCookieAuthenticatorService(config, signer, cookieHeaderEncoding, encoder, fingerprintGenerator,
      idGenerator, clock, authenticationService)
  }

  /**
   * Provides the signer for the authenticator.
   * @param configuration The Play configuration.
   * @return The signer for the authenticator.
   */
  @Provides @Named("authenticator-signer")
  def provideAuthenticatorSigner(configuration: Configuration): Signer = {
    new JcaSigner(JcaSignerSettings(configuration.get[String]("silhouette.authenticator.signer.key")))
  }

  /**
   * Provides the password hasher registry.
   * @return The password hasher registry.
   */
  @Provides
  def providePasswordHasherRegistry(): PasswordHasherRegistry = {
    PasswordHasherRegistry(new BCryptSha256PasswordHasher(), Seq(new BCryptPasswordHasher()))
  }

  /**
   * Provides the credentials provider.
   * @param authInfoRepository The auth info repository implementation.
   * @param passwordHasherRegistry The password hasher registry.
   * @return The credentials provider.
   */
  @Provides
  def provideCredentialsProvider(
      authInfoRepository: AuthInfoRepository,
      passwordHasherRegistry: PasswordHasherRegistry
  ): CredentialsProvider = {
    new CredentialsProvider(authInfoRepository, passwordHasherRegistry)
  }

  /**
   * Provides the auth info repository.
   * @param passwordInfoDAO The implementation of the delegable password auth info DAO.
   * @return The auth info repository instance.
   */
  @Provides
  def provideAuthInfoRepository(passwordInfoDAO: DelegableAuthInfoDAO[PasswordInfo]): AuthInfoRepository = {
    new DelegableAuthInfoRepository(passwordInfoDAO)
  }
}
