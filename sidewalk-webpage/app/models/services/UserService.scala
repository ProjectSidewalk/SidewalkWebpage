package models.services

import com.mohiva.play.silhouette.api.services.IdentityService
import models.user.User

import scala.concurrent.Future

trait UserService extends IdentityService[User] {
  /**
   * Saves a user.
   *
   * @param user The user to save.
   * @return The saved user.
   */
  def save(user: User): Future[User]

}