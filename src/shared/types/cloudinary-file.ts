/**
 * Extra fields attached to `req.file(s)` by the Cloudinary storage engine
 * in `upload.middleware.ts`.
 *
 * `location` and `key` are kept so existing controllers that read
 * `req.file.location` / `req.file.key` continue to work.
 */
export interface CloudinaryFileFields {
  location: string;
  key: string;
  public_id: string;
  secure_url: string;
}

export type CloudinaryFile = Express.Multer.File & CloudinaryFileFields;

export type CloudinaryFilesMap = {
  [fieldname: string]: CloudinaryFile[];
};
