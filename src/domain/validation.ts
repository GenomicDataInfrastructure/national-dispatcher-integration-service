// SPDX-FileCopyrightText: 2026 PNED G.I.E.
// SPDX-License-Identifier: Apache-2.0

export const VALIDATION_TYPES = [
  "auto",
  "public",
  "non-public",
  "restricted",
] as const;
export type ValidationType = (typeof VALIDATION_TYPES)[number];
