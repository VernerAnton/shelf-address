/**
 * Browser libraries served from this site (scripts/copy-vendor.mjs puts them
 * there). Versions are in the names so they can be cached for good; bump these
 * together with the package versions in package.json.
 */
export const OPENCV_URL = "/vendor/" + "opencv-4.12.0.js";

/** Tesseract (reading a printed ISBN from a photo): worker, engine directory and language data. */
export const TESSERACT_DIR = "/vendor/" + "tesseract-7.0.0";
