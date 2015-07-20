package models

import java.util.UUID
import com.mohiva.play.silhouette.api.{ Identity, LoginInfo }

/**
 * The user object.
 *
 * @param userId The unique ID of the user.
 * @param loginInfo The linked login info.
 * @param username Maybe the full name of the authenticated user.
 * @param email Maybe the email of the authenticated provider.
 */
case class User (
                userId: UUID,
                loginInfo: LoginInfo,
                username: String,
                email: String) extends Identity

