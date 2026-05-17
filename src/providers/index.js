import { RECORD_KEY_LABELS, RECORD_SETS, SHARED_RECORD_NAMES } from "../core/recordTypes.js";
import { CATEGORY_LABELS, RECORD_KEY_TO_CATEGORY, SHARED_TYPE_TO_CATEGORY } from "./categories.js";
import { providers } from "./providers.js";

const providersById = new Map(providers.map((provider) => [provider.id, prepareProvider(provider)]));

export function getGameOptions() {
  return Array.from(providersById.values()).map((provider) => ({
    id: provider.id,
    name: provider.name,
    platform: provider.platform,
    family: provider.family
  }));
}

export function getProvider(id) {
  return providersById.get(id) ?? null;
}

function prepareProvider(provider) {
  const recordsByKey = resolveProviderRecords(provider);
  const typeToCategory = provider.baseRecordSet ? new Map() : new Map(SHARED_TYPE_TO_CATEGORY);
  const recordNames = provider.baseRecordSet ? new Map() : new Map(SHARED_RECORD_NAMES);

  for (const [key, type] of recordsByKey) {
    const category = provider.recordCategories?.[key] ?? RECORD_KEY_TO_CATEGORY.get(key);
    const label = provider.recordLabels?.[key] ?? RECORD_KEY_LABELS[key] ?? SHARED_RECORD_NAMES.get(type) ?? keyToLabel(key);

    if (category) {
      typeToCategory.set(type, category);
    }

    recordNames.set(type, label);
  }

  for (const [type, category] of provider.typeCategories ?? []) {
    typeToCategory.set(type, category);
  }

  for (const [type, name] of provider.recordNames ?? []) {
    recordNames.set(type, name);
  }

  return {
    ...provider,
    recordsByKey,
    textureHeaderTypes: resolveRecordTypeList(provider.textureHeaderRecords, recordsByKey, provider.textureHeaderTypes),
    textureDataTypes: resolveRecordTypeList(provider.textureDataRecords, recordsByKey, provider.textureDataTypes),
    categoryLabel(category) {
      return CATEGORY_LABELS.get(category) ?? category;
    },
    categoryForType(type) {
      return typeToCategory.get(type) ?? "Unknown";
    },
    recordName(type) {
      return recordNames.get(type) ?? null;
    },
    recordType(key) {
      return recordsByKey.get(key) ?? null;
    }
  };
}

function resolveProviderRecords(provider) {
  const baseRecords = RECORD_SETS[provider.baseRecordSet] ?? {};
  const records = Object.entries({
    ...baseRecords,
    ...(provider.recordOverrides ?? {}),
    ...(provider.recordAdditions ?? {})
  }).filter(([, type]) => Number.isInteger(type));

  return new Map(records);
}

function resolveRecordTypeList(recordKeys, recordsByKey, fallback = []) {
  if (!recordKeys) {
    return fallback;
  }

  return recordKeys
    .map((key) => recordsByKey.get(key))
    .filter((type) => type != null);
}

function keyToLabel(key) {
  return String(key)
    .toLowerCase()
    .split("_")
    .map((part) => part.charAt(0).toUpperCase() + part.slice(1))
    .join(" ");
}
