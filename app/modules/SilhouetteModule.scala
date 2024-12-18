package modules

import com.google.inject.{AbstractModule, Provides}
import com.mohiva.play.silhouette.api.repositories.AuthInfoRepository
import com.mohiva.play.silhouette.api.services._
import com.mohiva.play.silhouette.api.util._
import com.mohiva.play.silhouette.api.{Environment, EventBus}
import com.mohiva.play.silhouette.impl.authenticators._
import com.mohiva.play.silhouette.impl.daos.DelegableAuthInfoDAO
import com.mohiva.play.silhouette.impl.providers._
import com.mohiva.play.silhouette.impl.repositories.DelegableAuthInfoRepository
import com.mohiva.play.silhouette.impl.util._
import models.user.SidewalkUserWithRole
import service.user.{UserService, UserServiceImpl}
import net.ceedubs.ficus.Ficus._
import net.ceedubs.ficus.readers.ArbitraryTypeReader._
import net.codingwell.scalaguice.ScalaModule
import play.api.Configuration
import play.api.libs.concurrent.Execution.Implicits._
import play.api.libs.ws.WSClient

/**
 * The Guice module which wires all Silhouette dependencies.
 */
class SilhouetteModule extends AbstractModule with ScalaModule {

  /**
   * Configures the module.
   */
  def configure() {
    bind[UserService].to[UserServiceImpl]
//    bind[UserDAO].to[UserDAOImpl]
//    bind[DelegableAuthInfoDAO[PasswordInfo]].to[PasswordInfoDAO]
    bind[CacheLayer].to[PlayCacheLayer]
    bind[IDGenerator].toInstance(new SecureRandomIDGenerator())
    bind[PasswordHasher].toInstance(new BCryptPasswordHasher)
    bind[FingerprintGenerator].toInstance(new DefaultFingerprintGenerator(false))
    bind[EventBus].toInstance(EventBus())
    bind[Clock].toInstance(Clock())
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
   *
   * @param userService The user service implementation.
   * @param authenticatorService The authentication service implementation.
   * @param eventBus The event bus instance.
   * @return The Silhouette environment.
   */
  @Provides
  def provideEnvironment(
                          userService: UserService,
                          authenticatorService: AuthenticatorService[CookieAuthenticator],
                          eventBus: EventBus): Environment[SidewalkUserWithRole, CookieAuthenticator] = {

    Environment[SidewalkUserWithRole, CookieAuthenticator](
      userService,
      authenticatorService,
      Seq(),
      eventBus
    )
  }

  /**
   * Provides the authenticator service.
   *
   * @param fingerprintGenerator The fingerprint generator implementation.
   * @param idGenerator The ID generator implementation.
   * @param configuration The Play configuration.
   * @param clock The clock instance.
   * @return The authenticator service.
   */
  @Provides
  def provideAuthenticatorService(
                                   fingerprintGenerator: FingerprintGenerator,
                                   idGenerator: IDGenerator,
                                   configuration: Configuration,
                                   clock: Clock): AuthenticatorService[CookieAuthenticator] = {

    val config = configuration.underlying.as[CookieAuthenticatorSettings]("silhouette.authenticator")
    new CookieAuthenticatorService(config, None, fingerprintGenerator, idGenerator, clock)
  }

  /**
   * Provides the auth info repository.
   *
   * @param passwordInfoDAO The implementation of the delegable password auth info DAO.
   * @return The auth info repository instance.
   */
//  @Provides
//  def provideAuthInfoRepository(passwordInfoDAO: DelegableAuthInfoDAO[PasswordInfo]): AuthInfoRepository = {
//
//    new DelegableAuthInfoRepository(passwordInfoDAO)
//  }

  /**
   * Provides the credentials provider.
   *
   * @param authInfoRepository The auth info repository implementation.
   * @param passwordHasher The default password hasher implementation.
   * @return The credentials provider.
   */
//  @Provides
//  def provideCredentialsProvider(
//                                  authInfoRepository: AuthInfoRepository,
//                                  passwordHasher: PasswordHasher): CredentialsProvider = {
//
//    new CredentialsProvider(authInfoRepository, passwordHasher, Seq(passwordHasher))
//  }
}