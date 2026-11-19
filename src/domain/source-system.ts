// SPDX-FileCopyrightText: 2026 PNED G.I.E.
// SPDX-License-Identifier: Apache-2.0

export const CATALOGUE_SOURCE = "catalogue" as const;
export const CATALOGUE_PERSISTENCE_NAMESPACE = "userportal" as const;
export const ADAPTER_SOURCE = "adapter" as const;
export const LEGACY_HEALTHDATA_SOURCE = "healthdata" as const;
export const SOURCE_SYSTEMS = [
  ADAPTER_SOURCE,
  CATALOGUE_SOURCE,
  LEGACY_HEALTHDATA_SOURCE,
] as const;

export function displaySourceSystem(source: string | undefined): string {
  return source === CATALOGUE_PERSISTENCE_NAMESPACE || source === undefined
    ? CATALOGUE_SOURCE
    : source;
}

export function persistenceSourceSystem(
  source: string | undefined,
): string | undefined {
  return source === CATALOGUE_SOURCE ? CATALOGUE_PERSISTENCE_NAMESPACE : source;
}
