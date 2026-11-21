// L'implementazione vive nell'API (come gli altri contratti condivisi) per non
// trascinare libs/ nella compilazione Nest e alterare il layout di dist/apps/api.
export {
  normalizeBarcode,
  validateBarcode,
  barcodeMatches,
  type BarcodeValidation,
} from "../../../../apps/api/src/common/barcode-validation";
