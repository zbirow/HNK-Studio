import { RECORD_TYPES } from "../core/recordTypes.js";

const PC_TEXTURE_RECORDS = {
  textureLayout: "pc-standard",
  textureHeaderRecords: ["TSE_TEXTURE_HEADER"],
  textureDataRecords: ["TSE_TEXTURE_DATA", "TSE_TEXTURE_DATA_2"]
};

const WII_TEXTURE_RECORDS = {
  textureLayout: "wii-standard",
  textureHeaderRecords: ["TSE_TEXTURE_HEADER"],
  textureDataRecords: ["TSE_TEXTURE_DATA", "TSE_TEXTURE_DATA_2"]
};

/*
Provider record schema:

baseRecordSet: "pc-standard" | "wii-standard" | "scooby-pc" | "scooby-wii"

recordOverrides replaces one logical record from the base set. If a key is
overridden, the base type for that key is not used by this provider.

recordOverrides: {
  // HUNKFILE_HEADER: RECORD_TYPES.HUNKFILE_HEADER,
  // FILENAME_HEADER: RECORD_TYPES.FILENAME_HEADER,
  // EMPTY: RECORD_TYPES.EMPTY,
  // ABSTRACT_HASH_IDENTIFIER: RECORD_TYPES.ABSTRACT_HASH_IDENTIFIER,
  // TSE_STRING_TABLE_MAIN: RECORD_TYPES.TSE_STRING_TABLE_MAIN,
  // CLANK_BODY_TEMPLATE_MAIN: RECORD_TYPES.CLANK_BODY_TEMPLATE_MAIN,
  // CLANK_BODY_TEMPLATE_SECONDARY: RECORD_TYPES.CLANK_BODY_TEMPLATE_SECONDARY,
  // CLANK_BODY_TEMPLATE_NAME: RECORD_TYPES.CLANK_BODY_TEMPLATE_NAME,
  // CLANK_BODY_TEMPLATE_DATA: RECORD_TYPES.CLANK_BODY_TEMPLATE_DATA,
  // CLANK_BODY_TEMPLATE_DATA_2: RECORD_TYPES.CLANK_BODY_TEMPLATE_DATA_2,
  // LITE_SCRIPT_MAIN: RECORD_TYPES.LITE_SCRIPT_MAIN,
  // LITE_SCRIPT_DATA: RECORD_TYPES.LITE_SCRIPT_DATA,
  // LITE_SCRIPT_DATA_2: RECORD_TYPES.LITE_SCRIPT_DATA_2,
  // SQUEAK_SAMPLE_DATA: RECORD_TYPES.BARBIE_SQUEAK_SAMPLE_DATA,
  // TSE_TEXTURE_HEADER: RECORD_TYPES.TSE_TEXTURE_HEADER,
  // TSE_TEXTURE_DATA: RECORD_TYPES.TSE_TEXTURE_DATA,
  // TSE_TEXTURE_DATA_2: RECORD_TYPES.TSE_TEXTURE_DATA_2,
  // RENDER_MODEL_TEMPLATE_HEADER: RECORD_TYPES.RENDER_MODEL_TEMPLATE_HEADER,
  // RENDER_MODEL_TEMPLATE_DATA: RECORD_TYPES.RENDER_MODEL_TEMPLATE_DATA,
  // RENDER_MODEL_TEMPLATE_DATA_TABLE: RECORD_TYPES.RENDER_MODEL_TEMPLATE_DATA_TABLE,
  // ANIMATION_DATA: RECORD_TYPES.ANIMATION_DATA,
  // ANIMATION_DATA_2: RECORD_TYPES.ANIMATION_DATA_2,
  // RENDER_SPRITE_DATA: RECORD_TYPES.RENDER_SPRITE_DATA,
  // EFFECTS_PARAMS_DATA: RECORD_TYPES.BARBIE_EFFECTS_PARAMS_DATA,
  // TSE_FONT_DESCRIPTOR_DATA: RECORD_TYPES.TSE_FONT_DESCRIPTOR_DATA,
  // TSE_DATA_TABLE_DATA_1: RECORD_TYPES.TSE_DATA_TABLE_DATA_1,
  // TSE_DATA_TABLE_DATA_2: RECORD_TYPES.TSE_DATA_TABLE_DATA_2,
  // STATE_FLOW_TEMPLATE_DATA: RECORD_TYPES.STATE_FLOW_TEMPLATE_DATA,
  // STATE_FLOW_TEMPLATE_DATA_2: RECORD_TYPES.STATE_FLOW_TEMPLATE_DATA_2,
  // SQUEAK_STREAM_DATA: RECORD_TYPES.SQUEAK_STREAM_DATA,
  // SQUEAK_STREAM_DATA_2: RECORD_TYPES.SQUEAK_STREAM_DATA_2,
  // ENTITY_PLACEMENT_DATA: RECORD_TYPES.ENTITY_PLACEMENT_DATA,
  // ENTITY_PLACEMENT_DATA_2: RECORD_TYPES.ENTITY_PLACEMENT_DATA_2,
  // ENTITY_PLACEMENT_BCC_DATA: RECORD_TYPES.ENTITY_PLACEMENT_BCC_DATA,
  // ENTITY_PLACEMENT_LEVEL_DATA: RECORD_TYPES.ENTITY_PLACEMENT_LEVEL_DATA,
  // ENTITY_TEMPLATE_DATA: RECORD_TYPES.ENTITY_TEMPLATE_DATA
}

recordAdditions adds a new logical record that is not present in the base set.
The key needs a category in RECORD_KEY_TO_CATEGORY and a label in
RECORD_KEY_LABELS.

recordAdditions: {
  // NAVMESH_DATA: RECORD_TYPES.BARBIE_NAVMESH_DATA
}
*/

export const providers = [
  {
    id: "monster-high-pc",
    name: "Monster High NGIS",
    family: "Torus PC",
    platform: "PC",
    baseRecordSet: "pc-standard",
    configAliases: ["mh-barbie-falling-skies-pc"],
    ...PC_TEXTURE_RECORDS
  },
  {
    id: "barbie-dreamhouse-party-pc",
    name: "Barbie Dreamhouse Party",
    family: "Torus PC",
    platform: "PC",
    baseRecordSet: "pc-standard",
    configAliases: ["mh-barbie-falling-skies-pc"],
    recordOverrides: {
      SQUEAK_SAMPLE_DATA: RECORD_TYPES.BARBIE_SQUEAK_SAMPLE_DATA,
      SQUEAK_STREAM_DATA: RECORD_TYPES.BARBIE_SQUEAK_STREAM_DATA,
      SQUEAK_STREAM_DATA_2: RECORD_TYPES.BARBIE_SQUEAK_STREAM_DATA_2,
      EFFECTS_PARAMS_DATA: RECORD_TYPES.BARBIE_EFFECTS_PARAMS_DATA
    },
    recordAdditions: {
      NAVMESH_DATA: RECORD_TYPES.BARBIE_NAVMESH_DATA
    },
    ...PC_TEXTURE_RECORDS
  },
    {
    id: "barbie-her-sisters-pc",
    name: "Barbie Her Sisters",
    family: "Torus PC",
    platform: "PC",
    baseRecordSet: "pc-standard",
    configAliases: ["mh-barbie-falling-skies-pc"],
    recordOverrides: {
      SQUEAK_SAMPLE_DATA: RECORD_TYPES.BARBIE_SQUEAK_SAMPLE_DATA,
      SQUEAK_STREAM_DATA: RECORD_TYPES.BARBIE_SQUEAK_STREAM_DATA,
      SQUEAK_STREAM_DATA_2: RECORD_TYPES.BARBIE_SQUEAK_STREAM_DATA_2,
      EFFECTS_PARAMS_DATA: RECORD_TYPES.BARBIE_EFFECTS_PARAMS_DATA
    },
    recordAdditions: {
      NAVMESH_DATA: RECORD_TYPES.BARBIE_NAVMESH_DATA
    },
    ...PC_TEXTURE_RECORDS
  },
  {
    id: "falling-skies-pc",
    name: "Falling Skies",
    family: "Torus PC",
    platform: "PC",
    baseRecordSet: "pc-standard",
    configAliases: ["mh-barbie-falling-skies-pc"],
    ...PC_TEXTURE_RECORDS
  },
  {
    id: "scooby-doo-and-the-spooky-swamp-pc",
    name: "Scooby-Doo and the Spooky Swamp",
    family: "Scooby-Doo PC",
    platform: "PC",
    baseRecordSet: "scooby-pc",
    textureLayout: "scooby-pc",
    textureHeaderRecords: ["TSE_TEXTURE_HEADER"],
    textureDataRecords: ["TSE_TEXTURE_DATA"]
  },
    {
    id: "scooby-doo-first-frights-pc",
    name: "Scooby-Doo First Frights",
    family: "Scooby-Doo PC",
    platform: "PC",
    baseRecordSet: "scooby-pc",
    textureLayout: "scooby-pc",
    textureHeaderRecords: ["TSE_TEXTURE_HEADER"],
    textureDataRecords: ["TSE_TEXTURE_DATA"]
  },
  {
    id: "monster-high-wii",
    name: "Monster High NGIS",
    family: "Torus Wii",
    platform: "Wii",
    baseRecordSet: "wii-standard",
    configAliases: ["mh-barbie-falling-skies-wii"],
    ...WII_TEXTURE_RECORDS
  },
  {
    id: "barbie-dreamhouse-party-wii",
    name: "Barbie Dreamhouse Party",
    family: "Torus Wii",
    platform: "Wii",
    baseRecordSet: "wii-standard",
    configAliases: ["mh-barbie-falling-skies-wii"],
    ...WII_TEXTURE_RECORDS
  },
    {
    id: "barbie-her-sisters-wii",
    name: "Barbie Her Sisters",
    family: "Torus Wii",
    platform: "Wii",
    baseRecordSet: "wii-standard",
    configAliases: ["mh-barbie-falling-skies-wii"],
    ...WII_TEXTURE_RECORDS
  },
  {
    id: "falling-skies-wii",
    name: "Falling Skies",
    family: "Torus Wii",
    platform: "Wii",
    baseRecordSet: "wii-standard",
    configAliases: ["mh-barbie-falling-skies-wii"],
    ...WII_TEXTURE_RECORDS
  },
  {
    id: "scooby-doo-and-the-spooky-swamp-wii",
    name: "Scooby-Doo and the Spooky Swamp",
    family: "Scooby-Doo Wii",
    platform: "Wii",
    baseRecordSet: "scooby-wii",
    textureLayout: "scooby-wii",
    textureHeaderRecords: ["TSE_TEXTURE_HEADER"],
    textureDataRecords: ["TSE_TEXTURE_DATA", "SCOOBY_TEXTURE_DATA_ALT"]
  },
  {
    id: "scooby-doo-first-frights-wii",
    name: "Scooby-Doo First Frights",
    family: "Scooby-Doo Wii",
    platform: "Wii",
    baseRecordSet: "scooby-wii",
    textureLayout: "scooby-wii",
    textureHeaderRecords: ["TSE_TEXTURE_HEADER"],
    textureDataRecords: ["TSE_TEXTURE_DATA", "SCOOBY_TEXTURE_DATA_ALT"]
  }
];
