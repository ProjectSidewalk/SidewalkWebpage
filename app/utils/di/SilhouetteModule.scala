package utils.di

import com.google.inject.{ AbstractModule, Provides }
import com.mohiva.play.silhouette.api.services._
import com.mohiva.play.silhouette.api.util._
import com.mohiva.play.silhouette.api.{ Environment, EventBus }
import com.mohiva.play.silhouette.impl.authenticators._
import com.mohiva.play.silhouette.impl.daos.DelegableAuthInfoDAO
import com.mohiva.play.silhouette.impl.providers._
import com.mohiva.play.silhouette.impl.providers.oauth1.secrets.{ CookieSecretSettings, CookieSecretProvider }
import com.mohiva.play.silhouette.impl.providers.oauth1.services.PlayOAuth1Service
import com.mohiva.play.silhouette.impl.providers.oauth2._
import com.mohiva.play.silhouette.impl.providers.oauth2.state.{ DummyStateProvider, CookieStateProvider, CookieStateSettings }
import com.mohiva.play.silhouette.impl.services._
import com.mohiva.play.silhouette.impl.util._
import models.daos._
import models.daos.slick._
import models.services.{ UserService, UserServiceImpl, AuthTokenService, AuthTokenServiceImpl }
import models.user.User
import net.codingwell.scalaguice.ScalaModule
import play.api.Play
import play.api.Play.current

import scala.collection.immutable.ListMap

/**
 * The Guice module which wires all Silhouette dependencies.
 */
class SilhouetteModule extends AbstractModule with ScalaModule {

  /**
   * Configures the module.
   */
  def configure() {
    bind[UserService].to[UserServiceImpl]
    //bind[UserDAO].to[UserDAOImpl]
    bind[UserDAO].to[UserDAOSlick]
    bind[AuthTokenService].to[AuthTokenServiceImpl]
    //bind[AuthTokenDAO].to[AuthTokenDAOImpl]
    bind[AuthTokenDAO].to[AuthTokenDAOSlick]
    bind[DelegableAuthInfoDAO[PasswordInfo]].to[PasswordInfoDAOSlick]
    bind[CacheLayer].to[PlayCacheLayer]
    bind[HTTPLayer].to[PlayHTTPLayer]
    bind[IDGenerator].toInstance(new SecureRandomIDGenerator())
    bind[PasswordHasher].toInstance(new BCryptPasswordHasher)
    bind[FingerprintGenerator].toInstance(new DefaultFingerprintGenerator(false))
    bind[EventBus].toInstance(EventBus())
    bind[Clock].toInstance(Clock())
  }

  /**
   * Provides the Silhouette environment.
   *
   * @param userService The user service implementation.
   * @param authenticatorService The authentication service implementation.
   * @param eventBus The event bus instance.
   * @param credentialsProvider The credentials provider implementation.
   * @return The Silhouette environment.
   */
  @Provides
  def provideEnvironment(
                          userService: UserService,
                          authenticatorService: AuthenticatorService[SessionAuthenticator],
                          eventBus: EventBus,
                          credentialsProvider: CredentialsProvider): Environment[User, SessionAuthenticator] = {

    Environment[User, SessionAuthenticator](
      userService,
      authenticatorService,
      ListMap(
        credentialsProvider.id -> credentialsProvider
      ),
      eventBus
    )
  }

  /**
   * Provides the authenticator service.
   *
   * @param fingerprintGenerator The fingerprint generator implementation.
   * @return The authenticator service.
   */
  @Provides
  def provideAuthenticatorService(fingerprintGenerator: FingerprintGenerator): AuthenticatorService[SessionAuthenticator] = {
    new SessionAuthenticatorService(SessionAuthenticatorSettings(
      sessionKey = Play.configuration.getString("silhouette.authenticator.sessionKey").get,
      encryptAuthenticator = Play.configuration.getBoolean("silhouette.authenticator.encryptAuthenticator").get,
      useFingerprinting = Play.configuration.getBoolean("silhouette.authenticator.useFingerprinting").get,
      authenticatorIdleTimeout = Play.configuration.getInt("silhouette.authenticator.authenticatorIdleTimeout"),
      authenticatorExpiry = Play.configuration.getInt("silhouette.authenticator.authenticatorExpiry").get
    ), fingerprintGenerator, Clock())
  }

  /**
   * Provides the auth info service.
   *
   * @param passwordInfoDAO The implementation of the delegable password auth info DAO.
   * @return The auth info service instance.
   */
  @Provides
  def provideAuthInfoService(
                              passwordInfoDAO: DelegableAuthInfoDAO[PasswordInfo]
                              ): AuthInfoService = {

    new DelegableAuthInfoService(passwordInfoDAO)
  }
  /**
   * Provides the avatar service.
   *
   * @param httpLayer The HTTP layer implementation.
   * @return The avatar service implementation.
   */
  @Provides
  def provideAvatarService(httpLayer: HTTPLayer): AvatarService = new GravatarService(httpLayer)

  /**
   * Provides the OAuth1 token secret provider.
   *
   * @return The OAuth1 token secret provider implementation.
   */
  @Provides
  def provideOAuth1TokenSecretProvider: OAuth1TokenSecretProvider = {
    new CookieSecretProvider(CookieSecretSettings(
      cookieName = Play.configuration.getString("silhouette.oauth1TokenSecretProvider.cookieName").get,
      cookiePath = Play.configuration.getString("silhouette.oauth1TokenSecretProvider.cookiePath").get,
      cookieDomain = Play.configuration.getString("silhouette.oauth1TokenSecretProvider.cookieDomain"),
      secureCookie = Play.configuration.getBoolean("silhouette.oauth1TokenSecretProvider.secureCookie").get,
      httpOnlyCookie = Play.configuration.getBoolean("silhouette.oauth1TokenSecretProvider.httpOnlyCookie").get,
      expirationTime = Play.configuration.getInt("silhouette.oauth1TokenSecretProvider.expirationTime").get
    ), Clock())
  }

  /**
   * Provides the OAuth2 state provider.
   *
   * @param idGenerator The ID generator implementation.
   * @return The OAuth2 state provider implementation.
   */
  @Provides
  def provideOAuth2StateProvider(idGenerator: IDGenerator): OAuth2StateProvider = {
    new CookieStateProvider(CookieStateSettings(
      cookieName = Play.configuration.getString("silhouette.oauth2StateProvider.cookieName").get,
      cookiePath = Play.configuration.getString("silhouette.oauth2StateProvider.cookiePath").get,
      cookieDomain = Play.configuration.getString("silhouette.oauth2StateProvider.cookieDomain"),
      secureCookie = Play.configuration.getBoolean("silhouette.oauth2StateProvider.secureCookie").get,
      httpOnlyCookie = Play.configuration.getBoolean("silhouette.oauth2StateProvider.httpOnlyCookie").get,
      expirationTime = Play.configuration.getInt("silhouette.oauth2StateProvider.expirationTime").get
    ), idGenerator, Clock())
  }

  /**
   * Provides the credentials provider.
   *
   * @param authInfoService The auth info service implemenetation.
   * @param passwordHasher The default password hasher implementation.
   * @return The credentials provider.
   */
  @Provides
  def provideCredentialsProvider(
                                  authInfoService: AuthInfoService,
                                  passwordHasher: PasswordHasher): CredentialsProvider = {

    new CredentialsProvider(authInfoService, passwordHasher, Seq(passwordHasher))
  }
}
