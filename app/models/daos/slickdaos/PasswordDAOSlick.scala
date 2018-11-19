package models.daos.slickdaos

import com.mohiva.play.silhouette.api.LoginInfo
import com.mohiva.play.silhouette.api.util.PasswordInfo
import com.mohiva.play.silhouette.impl.daos.DelegableAuthInfoDAO
import play.api.db.slick._

import scala.concurrent.Future
import models.daos.slickdaos.DBTableDefinitions._
import models.utils.MyPostgresDriver.api._
import play.api.Play
import slick.driver.JdbcProfile

import scala.concurrent.ExecutionContext.Implicits.global

/**
 * The DAO to store the password information.
 */
class PasswordInfoDAOSlick extends DelegableAuthInfoDAO[PasswordInfo] {
  val dbConfig = DatabaseConfigProvider.get[JdbcProfile](Play.current)
  val db = dbConfig.db

  /**
   * Saves the password info.
   *
   * @param loginInfo The login info for which the auth info should be saved.
   * @param authInfo The password info to save.
   * @return The saved password info or None if the password info couldn't be saved.
   */
  def save(loginInfo: LoginInfo, authInfo: PasswordInfo): Future[PasswordInfo] = {
    db.run(
      slickLoginInfos.filter(
        x => x.providerID === loginInfo.providerID && x.providerKey === loginInfo.providerKey
      ).result.head
    ).flatMap { info =>
      db.run(
        slickPasswordInfos += DBPasswordInfo(authInfo.hasher, authInfo.password, authInfo.salt, info.id.get)
      ).map(_ => authInfo)
    }
  }

  /**
   * Finds the password info which is linked with the specified login info.
   *
   * @param loginInfo The linked login info.
   * @return The retrieved password info or None if no password info could be retrieved for the given login info.
   */
  def find(loginInfo: LoginInfo): Future[Option[PasswordInfo]] = {
    db.run(
      slickLoginInfos.filter(
        info => info.providerID === loginInfo.providerID && info.providerKey === loginInfo.providerKey
      ).result.headOption
    ).flatMap {
      case Some(info) => db.run(
          slickPasswordInfos.filter(_.loginInfoId === info.id).result.head
        ).map(p => Some(PasswordInfo(p.hasher, p.password, p.salt)))
      case None => Future.successful(None)
    }
  }

  //FIXME
  override def add(loginInfo: LoginInfo, authInfo: PasswordInfo): Future[PasswordInfo] = ???

  //FIXME
  override def update(loginInfo: LoginInfo, authInfo: PasswordInfo): Future[PasswordInfo] = ???

  //FIXME
  override def remove(loginInfo: LoginInfo): Future[Unit] = ???
}
