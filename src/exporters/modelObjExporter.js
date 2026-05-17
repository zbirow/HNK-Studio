import { buildObjFromGeometry, extractModelGeometry } from "../decoders/modelGeometry.js";

export function createObjFromModelRecords(records, modelName = "model", options = {}) {
  return buildObjFromGeometry(extractModelGeometry(records), modelName, options);
}
