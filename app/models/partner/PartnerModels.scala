package models.partner

import java.io.File

/** A logo file uploaded through a partner create/update form, before validation and re-encoding. */
case class PartnerLogoUpload(tempFile: File)

/** Why a partner create/update/delete/reorder was refused; the controller maps each to an HTTP response. */
sealed trait PartnerRejection

object PartnerRejection {

  case object LogoRequired extends PartnerRejection

  /** The uploaded file exceeds the pre-transcode wire cap (`partners.logo-upload-max-bytes`). */
  case object LogoTooLarge extends PartnerRejection

  /** The re-encoded logo still exceeds the stored-bytes cap (`MAX_LOGO_BYTES` / the table's octet_length CHECK). */
  case object LogoEncodedTooLarge extends PartnerRejection

  /** The upload isn't a decodable PNG/JPEG, or its declared dimensions trip the decompression-bomb guards. */
  case object LogoInvalid extends PartnerRejection

  case object NameInvalid extends PartnerRejection

  case object UrlInvalid extends PartnerRejection

  case object AltTextInvalid extends PartnerRejection

  /** No such partner — including partners outside the caller's allowed scopes, which must look identical. */
  case object NotFound extends PartnerRejection

  /** A reorder's id list isn't exactly the scope's current id set. */
  case object BadOrder extends PartnerRejection
}
